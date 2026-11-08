import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import {
  addAmounts,
  formatStellarAmount,
  stroops,
  subtractAmounts,
} from '../common/money';
import { isDuplicateKey } from '../common/errors';
import {
  LedgerAccount,
  LedgerBalance,
  LedgerEntry,
} from '../database/entities';
import type { JournalPlan, LedgerBucket } from '../payments/plan-ledger';

type AssetScope = {
  merchantId: string;
  network: string;
  assetCode: string;
  assetIssuer: string | null;
};

@Injectable()
export class LedgerService {
  async postJournals(
    manager: EntityManager,
    input: AssetScope & {
      intentId: string | null;
      observationId: string | null;
      journals: JournalPlan[];
    },
  ): Promise<void> {
    for (const journal of input.journals) {
      assertBalanced(journal);
      const journalId = randomUUID();
      const lines = [...journal.lines].sort((left, right) =>
        left.bucket.localeCompare(right.bucket),
      );
      for (const line of lines) {
        const locked = await this.lockAccount(manager, {
          ...input,
          bucket: line.bucket,
        });
        const next = increases(locked.kind, line.direction)
          ? addAmounts(formatStellarAmount(locked.balance), line.amount)
          : subtractAmounts(formatStellarAmount(locked.balance), line.amount);
        locked.balanceRow.balance = next;
        await manager.save(locked.balanceRow);
        await manager.insert(LedgerEntry, {
          journalId,
          accountId: locked.accountId,
          direction: line.direction,
          amount: formatStellarAmount(line.amount),
          intentId: input.intentId,
          observationId: input.observationId,
          description: journal.description,
        });
      }
    }
  }

  private async lockAccount(
    manager: EntityManager,
    input: AssetScope & { bucket: LedgerBucket },
  ): Promise<{
    accountId: string;
    kind: 'asset' | 'liability';
    balance: string;
    balanceRow: LedgerBalance;
  }> {
    const kind: 'asset' | 'liability' =
      input.bucket === 'stellar_observed' ? 'asset' : 'liability';
    const code = accountCode({ ...input, kind });
    let account = await manager.findOne(LedgerAccount, { where: { code } });
    if (!account) {
      account = manager.create(LedgerAccount, {
        id: randomUUID(),
        code,
        merchantId: input.merchantId,
        kind,
        bucket: input.bucket,
        network: input.network,
        assetCode: input.assetCode,
        assetIssuer: input.assetIssuer,
      });
      try {
        await manager.save(account);
        await manager.insert(LedgerBalance, {
          accountId: account.id,
          balance: '0.0000000',
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        account = await manager.findOneOrFail(LedgerAccount, {
          where: { code },
        });
      }
    }
    const balanceRow = await manager.findOne(LedgerBalance, {
      where: { accountId: account.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!balanceRow) {
      throw new Error(`missing ledger balance for ${code}`);
    }
    return {
      accountId: account.id,
      kind,
      balance: String(balanceRow.balance),
      balanceRow,
    };
  }
}

function accountCode(
  input: AssetScope & { bucket: string; kind: string },
): string {
  return [
    input.kind,
    input.bucket,
    input.merchantId,
    input.network,
    input.assetCode,
    input.assetIssuer ?? 'native',
  ].join(':');
}

function increases(
  kind: 'asset' | 'liability',
  direction: 'DR' | 'CR',
): boolean {
  return kind === 'asset' ? direction === 'DR' : direction === 'CR';
}

function assertBalanced(journal: JournalPlan): void {
  let debit = 0n;
  let credit = 0n;
  for (const line of journal.lines) {
    const value = stroops(line.amount);
    if (line.direction === 'DR') debit += value;
    else credit += value;
  }
  if (debit !== credit) {
    throw new Error(`unbalanced journal: ${journal.description}`);
  }
}
