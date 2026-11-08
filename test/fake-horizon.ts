import {
  AccountAssetReadiness,
  HorizonClient,
  HorizonRoot,
  NormalizedPayment,
  NormalizedTransaction,
} from '../src/stellar/horizon-types';

export class FakeHorizon implements HorizonClient {
  passphrase = 'Test SDF Network ; September 2015';
  private readonly payments = new Map<string, NormalizedPayment[]>();
  private readonly transactions = new Map<string, NormalizedTransaction>();
  private readonly operationOverrides = new Map<string, NormalizedPayment>();
  private readonly readiness = new Map<string, AccountAssetReadiness>();

  reset(): void {
    this.payments.clear();
    this.transactions.clear();
    this.operationOverrides.clear();
    this.readiness.clear();
    this.passphrase = 'Test SDF Network ; September 2015';
  }

  markReady(
    accountId: string,
    readiness: Partial<AccountAssetReadiness> = {},
  ): void {
    this.readiness.set(accountId, {
      exists: true,
      nativeBalance: '10000.0000000',
      trustline: true,
      authorized: true,
      ...readiness,
    });
  }

  add(
    accountId: string,
    payment: NormalizedPayment,
    transaction: NormalizedTransaction,
  ): void {
    const rows = this.payments.get(accountId) ?? [];
    rows.push(payment);
    this.payments.set(accountId, rows);
    this.transactions.set(transaction.hash, transaction);
  }

  overrideOperation(operationId: string, payment: NormalizedPayment): void {
    this.operationOverrides.set(operationId, payment);
  }

  getRoot(): Promise<HorizonRoot> {
    return Promise.resolve({
      networkPassphrase: this.passphrase,
      horizonVersion: 'fake',
      historyLatestLedger: 1,
    });
  }

  latestPaymentCursor(accountId: string): Promise<string | null> {
    const rows = this.payments.get(accountId) ?? [];
    return Promise.resolve(
      rows.length > 0 ? rows[rows.length - 1].pagingToken : null,
    );
  }

  listPayments(
    accountId: string,
    afterCursor: string | null,
    limit: number,
  ): Promise<NormalizedPayment[]> {
    const rows = this.payments.get(accountId) ?? [];
    const filtered = afterCursor
      ? rows.filter((row) => BigInt(row.pagingToken) > BigInt(afterCursor))
      : rows;
    return Promise.resolve(filtered.slice(0, limit));
  }

  getTransaction(hash: string): Promise<NormalizedTransaction> {
    const transaction = this.transactions.get(hash);
    if (!transaction) throw new Error(`missing transaction ${hash}`);
    return Promise.resolve(transaction);
  }

  getOperation(operationId: string): Promise<NormalizedPayment> {
    const override = this.operationOverrides.get(operationId);
    if (override) return Promise.resolve(override);
    for (const rows of this.payments.values()) {
      const found = rows.find((row) => row.operationId === operationId);
      if (found) return Promise.resolve(found);
    }
    throw new Error(`missing operation ${operationId}`);
  }

  getAccountReadiness(accountId: string): Promise<AccountAssetReadiness> {
    return Promise.resolve(
      this.readiness.get(accountId) ?? {
        exists: false,
        nativeBalance: null,
        trustline: false,
        authorized: false,
      },
    );
  }
}
