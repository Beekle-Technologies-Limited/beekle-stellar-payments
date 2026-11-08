import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { AuditService } from '../audit/audit.service';
import { formatStellarAmount } from '../common/money';
import {
  Merchant,
  ObserverCursor,
  PaymentIntent,
  ReviewCase,
  StellarObservation,
} from '../database/entities';
import { LedgerService } from '../ledger/ledger.service';
import {
  NormalizedPayment,
  NormalizedTransaction,
} from '../stellar/horizon-types';
import type { NormalizedEventType } from '../providers/normalized-event';
import { WebhookService } from '../webhooks/webhook.service';
import { classifyPayment } from './classify-payment';
import { planLedger } from './plan-ledger';
import { randomUUID } from 'node:crypto';

export type ProcessPaymentInput = {
  watchedAccountId: string;
  listed: NormalizedPayment;
  operation: NormalizedPayment;
  transaction: NormalizedTransaction;
  advanceCursor: boolean;
};

@Injectable()
export class PaymentProcessor {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
  ) {}

  async process(input: ProcessPaymentInput): Promise<{ disposition: string }> {
    return this.dataSource.transaction(async (manager) => {
      const network = this.config.stellar.network;
      const existing = await manager.findOne(StellarObservation, {
        where: { network, operationId: input.operation.operationId },
      });
      if (existing) {
        if (input.advanceCursor) {
          await advanceCursor(
            manager,
            network,
            input.watchedAccountId,
            input.operation.pagingToken,
          );
        }
        return { disposition: 'duplicate' };
      }
      const merchant = await manager.findOne(Merchant, {
        where: { stellarDestination: input.watchedAccountId },
      });
      if (!merchant) {
        throw new Error(`no merchant watches ${input.watchedAccountId}`);
      }
      const intent = await this.lockIntent(manager, input);
      const classification = classifyPayment({
        watchedAccountId: input.watchedAccountId,
        listed: input.listed,
        operation: input.operation,
        transaction: input.transaction,
        intent: intent
          ? {
              id: intent.id,
              status: intent.status,
              amount: String(intent.amount),
              receivedAmount: String(intent.receivedAmount),
              recognizedAmount: String(intent.recognizedAmount),
              assetCode: intent.assetCode,
              assetIssuer: intent.assetIssuer,
              destination: intent.destination,
              memo: intent.memo,
              memoType: intent.memoType,
              expiresAt: new Date(intent.expiresAt),
            }
          : null,
      });
      const plan = planLedger({
        classification,
        paymentAmount: input.operation.amount,
        invoiceAmount: intent ? String(intent.amount) : null,
        recognizedAmount: intent
          ? String(intent.recognizedAmount)
          : '0.0000000',
        transactionHash: input.transaction.hash,
      });
      const closedAt = input.operation.createdAt
        ? new Date(input.operation.createdAt)
        : new Date(input.transaction.createdAt);
      const observation = manager.create(StellarObservation, {
        network,
        operationId: input.operation.operationId,
        pagingToken: input.operation.pagingToken,
        transactionHash:
          input.transaction.hash || input.operation.transactionHash,
        operationType: input.operation.type,
        sourceAccount:
          input.operation.sourceAccount || input.transaction.sourceAccount,
        destinationAccount: input.operation.to ?? input.watchedAccountId,
        assetCode: input.operation.assetCode,
        assetIssuer: input.operation.assetIssuer,
        amount: input.operation.amount
          ? safeAmount(input.operation.amount)
          : null,
        memo: input.transaction.memo,
        memoType: input.transaction.memoType,
        transactionSuccessful: input.transaction.successful,
        ledgerClosedAt: Number.isNaN(closedAt.getTime())
          ? new Date(0)
          : closedAt,
        intentId: intent?.id ?? null,
        merchantId: merchant.id,
        disposition: classification.kind,
        rawJson: {
          listed_operation_id: input.listed.operationId,
          listed_amount: input.listed.amount,
          operation_amount: input.operation.amount,
          transaction_memo: input.transaction.memo,
          transaction_memo_type: input.transaction.memoType,
          transaction_successful: input.transaction.successful,
        },
      });
      const saved = await manager.save(observation);
      const assetCode = input.operation.assetCode;
      const assetIssuer = input.operation.assetIssuer;
      if (plan.journals.length && assetCode) {
        await this.ledger.postJournals(manager, {
          merchantId: merchant.id,
          network,
          assetCode,
          assetIssuer,
          intentId: intent?.id ?? null,
          observationId: String(saved.id),
          journals: plan.journals,
        });
      }
      if (
        intent &&
        (plan.nextStatus || plan.receivedAmount || plan.recognizedAmount)
      ) {
        const from = intent.status;
        if (plan.receivedAmount) intent.receivedAmount = plan.receivedAmount;
        if (plan.recognizedAmount)
          intent.recognizedAmount = plan.recognizedAmount;
        if (plan.providerReference)
          intent.providerReference = plan.providerReference;
        if (plan.nextStatus) {
          intent.status = plan.nextStatus;
          if (plan.nextStatus === 'CREDITED') intent.creditedAt = new Date();
        }
        await manager.save(intent);
        if (intent.status !== from) {
          await this.audit.record(manager, {
            actorType: 'system',
            actorId: null,
            action: `intent.${intent.status.toLowerCase()}`,
            entityType: 'payment_intent',
            entityId: intent.id,
            fromStatus: from,
            toStatus: intent.status,
            metadata: {
              disposition: classification.kind,
              operation_id: input.operation.operationId,
              transaction_hash: input.transaction.hash,
            },
          });
        }
        if (intent.status === 'CREDITED' && !merchant.webhookUrl) {
          intent.status = 'COMPLETED';
          await manager.save(intent);
          await this.audit.record(manager, {
            actorType: 'system',
            actorId: null,
            action: 'intent.completed',
            entityType: 'payment_intent',
            entityId: intent.id,
            fromStatus: 'CREDITED',
            toStatus: 'COMPLETED',
            metadata: { reason: 'no_webhook_configured' },
          });
        }
      }
      if (plan.reviewReason) {
        await manager.insert(ReviewCase, {
          id: randomUUID(),
          merchantId: merchant.id,
          intentId: intent?.id ?? null,
          observationId: String(saved.id),
          reason: plan.reviewReason,
          status: 'OPEN',
        });
      }
      if (plan.eventType) {
        await this.webhooks.enqueue(manager, {
          merchant,
          intent,
          type: plan.eventType as NormalizedEventType,
          dedupeKey: `${saved.id}:${plan.eventType}`,
          payment: input.operation,
          assetCode: assetCode ?? intent?.assetCode ?? null,
          assetIssuer: assetIssuer ?? intent?.assetIssuer ?? null,
        });
      }
      if (input.advanceCursor) {
        await advanceCursor(
          manager,
          network,
          input.watchedAccountId,
          input.operation.pagingToken,
        );
      }
      return { disposition: classification.kind };
    });
  }

  private async lockIntent(
    manager: EntityManager,
    input: ProcessPaymentInput,
  ): Promise<PaymentIntent | null> {
    if (
      (input.transaction.memoType !== 'text' &&
        input.transaction.memoType !== 'id') ||
      !input.transaction.memo
    ) {
      return null;
    }
    const memoType =
      input.transaction.memoType === 'text' ? 'MEMO_TEXT' : 'MEMO_ID';
    return manager.findOne(PaymentIntent, {
      where: {
        network: this.config.stellar.network,
        destination: input.watchedAccountId,
        memo: input.transaction.memo,
        memoType,
      },
      lock: { mode: 'pessimistic_write' },
    });
  }
}

function safeAmount(amount: string): string | null {
  try {
    return formatStellarAmount(amount);
  } catch {
    return null;
  }
}

async function advanceCursor(
  manager: EntityManager,
  network: string,
  accountId: string,
  pagingToken: string,
): Promise<void> {
  const row = await manager.findOne(ObserverCursor, {
    where: { network, accountId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!row) {
    await manager.insert(ObserverCursor, {
      network,
      accountId,
      cursorToken: pagingToken,
    });
    return;
  }
  if (row.cursorToken === '' || BigInt(pagingToken) > BigInt(row.cursorToken)) {
    row.cursorToken = pagingToken;
    await manager.save(row);
  }
}
