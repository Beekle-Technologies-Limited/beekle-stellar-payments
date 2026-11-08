import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { stroops } from '../common/money';
import { AuditService } from '../audit/audit.service';
import {
  LedgerAccount,
  LedgerBalance,
  ReconciliationFinding,
} from '../database/entities';
import { PaymentProcessor } from '../payments/payment-processor.service';
import type { HorizonClient } from '../stellar/horizon-client';
import { HORIZON_CLIENT } from '../stellar/horizon-client';

export type ReconciliationReport = {
  pages: number;
  processed: number;
  findings: Array<{ code: string; detail: string; merchantId: string | null }>;
};

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HORIZON_CLIENT) private readonly horizon: HorizonClient,
    private readonly dataSource: DataSource,
    private readonly processor: PaymentProcessor,
    private readonly audit: AuditService,
  ) {}

  async backfill(input: {
    accountId: string;
    maxPages: number;
    fromCursor?: string;
  }): Promise<ReconciliationReport> {
    let cursor = input.fromCursor ?? '';
    let pages = 0;
    let processed = 0;
    while (pages < input.maxPages) {
      const payments = await this.horizon.listPayments(
        input.accountId,
        cursor || null,
        this.config.observer.pageLimit,
      );
      if (payments.length === 0) break;
      for (const listed of payments) {
        const [transaction, operation] = await Promise.all([
          this.horizon.getTransaction(listed.transactionHash),
          this.horizon.getOperation(listed.operationId),
        ]);
        await this.processor.process({
          watchedAccountId: input.accountId,
          listed,
          operation,
          transaction,
          advanceCursor: false,
        });
        cursor = listed.pagingToken;
        processed += 1;
      }
      pages += 1;
      if (payments.length < this.config.observer.pageLimit) break;
    }
    const findings = await this.compareBooks(input.accountId);
    return { pages, processed, findings };
  }

  async compareBooks(
    accountId: string,
  ): Promise<
    Array<{ code: string; detail: string; merchantId: string | null }>
  > {
    return this.dataSource.transaction(async (manager) => {
      const findings: Array<{
        code: string;
        detail: string;
        merchantId: string | null;
      }> = [];
      const unbalanced: Array<{ journal_id: string }> = await manager.query(
        `SELECT journal_id FROM (
           SELECT journal_id,
                  SUM(CASE WHEN direction = 'DR' THEN amount ELSE 0 END) AS dr,
                  SUM(CASE WHEN direction = 'CR' THEN amount ELSE 0 END) AS cr
           FROM ledger_entries
           GROUP BY journal_id
         ) journals
         WHERE dr <> cr`,
      );
      for (const row of unbalanced) {
        findings.push({
          code: 'UNBALANCED_JOURNAL',
          detail: `journal ${row.journal_id} debits do not equal credits`,
          merchantId: null,
        });
      }
      const recognized: Array<{
        merchant_id: string;
        asset_code: string;
        asset_issuer: string | null;
        recognized: string;
      }> = await manager.query(
        `SELECT merchant_id, asset_code, asset_issuer,
                SUM(recognized_amount) AS recognized
         FROM payment_intents
         WHERE network = ?
         GROUP BY merchant_id, asset_code, asset_issuer`,
        [this.config.stellar.network],
      );
      const availableAccounts = await manager.find(LedgerAccount, {
        where: {
          bucket: 'merchant_available',
          network: this.config.stellar.network,
        },
      });
      for (const group of recognized) {
        const account = availableAccounts.find(
          (candidate) =>
            candidate.merchantId === group.merchant_id &&
            candidate.assetCode === group.asset_code &&
            candidate.assetIssuer === group.asset_issuer,
        );
        const balance = account
          ? await manager.findOne(LedgerBalance, {
              where: { accountId: account.id },
            })
          : null;
        const available = balance ? String(balance.balance) : '0.0000000';
        if (stroops(available) !== stroops(String(group.recognized))) {
          findings.push({
            code: 'LEDGER_RECOGNIZED_MISMATCH',
            merchantId: group.merchant_id,
            detail: `recognized ${group.recognized} ${group.asset_code} but available balance is ${available}`,
          });
        }
      }
      for (const finding of findings) {
        await manager.insert(ReconciliationFinding, {
          id: randomUUID(),
          merchantId: finding.merchantId,
          network: this.config.stellar.network,
          accountId,
          severity: 'high',
          code: finding.code,
          detail: finding.detail,
        });
        if (finding.merchantId) {
          await manager.query(
            'UPDATE merchants SET settlement_paused = 1 WHERE id = ?',
            [finding.merchantId],
          );
          await this.audit.record(manager, {
            actorType: 'system',
            actorId: null,
            action: 'merchant.settlement_paused',
            entityType: 'merchant',
            entityId: finding.merchantId,
            toStatus: 'settlement_paused',
            metadata: { code: finding.code, detail: finding.detail },
          });
        }
      }
      return findings;
    });
  }
}
