import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { AuditService } from '../audit/audit.service';
import {
  amountsEqual,
  compareAmounts,
  formatStellarAmount,
} from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import {
  ObserverCursor,
  PaymentIntent,
  ReviewCase,
} from '../database/entities';
import { planRecognizeInvoice } from '../payments/plan-ledger';
import { Merchant } from '../database/entities';
import { WebhookService } from '../webhooks/webhook.service';
import { assertAccountId } from '../merchants/merchant.service';

@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
  ) {}

  async setCursor(accountId: string, cursor: string): Promise<void> {
    const destination = assertAccountId(accountId);
    if (cursor !== '' && !/^\d+$/.test(cursor)) {
      throw new BadRequestException('cursor must be empty or a paging token');
    }
    await this.dataSource.transaction(async (manager) => {
      const merchant = await manager.findOne(Merchant, {
        where: { stellarDestination: destination },
      });
      if (!merchant)
        throw new NotFoundException('no merchant watches that account');
      const existing = await manager.findOne(ObserverCursor, {
        where: { network: this.config.stellar.network, accountId: destination },
        lock: { mode: 'pessimistic_write' },
      });
      const previous = existing?.cursorToken ?? null;
      if (!existing) {
        await manager.insert(ObserverCursor, {
          network: this.config.stellar.network,
          accountId: destination,
          cursorToken: cursor,
        });
      } else {
        existing.cursorToken = cursor;
        await manager.save(existing);
      }
      await this.audit.record(manager, {
        actorType: 'operator',
        actorId: 'admin',
        action: 'observer.cursor_set',
        entityType: 'observer_cursor',
        entityId: destination,
        metadata: { previous, cursor },
      });
    });
  }

  async recognize(intentId: string): Promise<PaymentIntent> {
    return this.dataSource.transaction(async (manager) => {
      const intent = await manager.findOne(PaymentIntent, {
        where: { id: intentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intent) throw new NotFoundException('payment intent not found');
      if (intent.status !== 'OVERPAID' && intent.status !== 'HELD') {
        throw new BadRequestException(
          'operator recognition is only for OVERPAID or HELD invoices',
        );
      }
      if (
        compareAmounts(String(intent.receivedAmount), String(intent.amount)) < 0
      ) {
        throw new BadRequestException(
          'received amount is still below the invoice',
        );
      }
      if (compareAmounts(String(intent.recognizedAmount), '0.0000000') !== 0) {
        throw new BadRequestException(
          'invoice already has a recognized amount',
        );
      }
      const invoice = formatStellarAmount(String(intent.amount));
      await this.ledger.postJournals(manager, {
        merchantId: intent.merchantId,
        network: intent.network,
        assetCode: intent.assetCode,
        assetIssuer: intent.assetIssuer,
        intentId: intent.id,
        observationId: null,
        journals: planRecognizeInvoice(invoice),
      });
      const from = intent.status;
      intent.recognizedAmount = invoice;
      intent.status = 'CREDITED';
      intent.creditedAt = new Date();
      await manager.save(intent);
      await this.audit.record(manager, {
        actorType: 'operator',
        actorId: 'admin',
        action: 'intent.recognized',
        entityType: 'payment_intent',
        entityId: intent.id,
        fromStatus: from,
        toStatus: 'CREDITED',
        metadata: { invoice },
      });
      if (amountsEqual(String(intent.receivedAmount), invoice)) {
        await manager
          .createQueryBuilder()
          .update(ReviewCase)
          .set({
            status: 'RESOLVED',
            resolution: 'RECOGNIZED',
            resolvedAt: new Date(),
          })
          .where('intent_id = :intentId AND status = :status', {
            intentId: intent.id,
            status: 'OPEN',
          })
          .execute();
      }
      const merchant = await manager.findOne(Merchant, {
        where: { id: intent.merchantId },
      });
      if (merchant) {
        await this.webhooks.enqueue(manager, {
          merchant,
          intent,
          type: 'payment.credited',
          dedupeKey: `intent:${intent.id}:operator-recognize`,
          payment: null,
          assetCode: intent.assetCode,
          assetIssuer: intent.assetIssuer,
        });
        if (!merchant.webhookUrl) {
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
      return intent;
    });
  }

  async recordExternalRefund(
    reviewId: string,
    note: string,
    externalReference: string,
  ): Promise<ReviewCase> {
    if (note.trim().length < 3 || externalReference.trim().length < 3) {
      throw new BadRequestException('note and external_reference are required');
    }
    return this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(ReviewCase, {
        where: { id: reviewId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!review) throw new NotFoundException('review case not found');
      if (review.status !== 'OPEN') {
        throw new BadRequestException('review case is not open');
      }
      review.status = 'RESOLVED';
      review.resolution = 'EXTERNAL_REFUND_RECORDED';
      review.note = note.trim().slice(0, 500);
      review.resolvedAt = new Date();
      await manager.save(review);
      await this.audit.record(manager, {
        actorType: 'operator',
        actorId: 'admin',
        action: 'review.external_refund_recorded',
        entityType: 'review_case',
        entityId: review.id,
        fromStatus: 'OPEN',
        toStatus: 'RESOLVED',
        metadata: {
          on_chain_verified: false,
          external_reference: externalReference.trim().slice(0, 200),
          note: review.note,
          chain_transaction_submitted: false,
        },
      });
      return review;
    });
  }
}
