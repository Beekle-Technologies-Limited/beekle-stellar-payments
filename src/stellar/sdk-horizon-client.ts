import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import {
  AccountAssetReadiness,
  HorizonClient,
  HorizonRoot,
  NormalizedPayment,
  NormalizedTransaction,
  mapHorizonOperation,
} from './horizon-types';

type StellarSdk = typeof import('@stellar/stellar-sdk');

@Injectable()
export class SdkHorizonClient implements HorizonClient {
  private sdkPromise: Promise<StellarSdk> | undefined;
  private server: InstanceType<StellarSdk['Horizon']['Server']> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private async sdk(): Promise<StellarSdk> {
    this.sdkPromise ??= import('@stellar/stellar-sdk');
    return this.sdkPromise;
  }

  private async horizon(): Promise<
    InstanceType<StellarSdk['Horizon']['Server']>
  > {
    if (!this.server) {
      const { Horizon } = await this.sdk();
      this.server = new Horizon.Server(this.config.stellar.horizonUrl, {
        allowHttp: this.config.stellar.horizonUrl.startsWith('http://'),
      });
    }
    return this.server;
  }

  async getRoot(): Promise<HorizonRoot> {
    const root = await (await this.horizon()).root();
    if (root.network_passphrase !== this.config.stellar.passphrase) {
      throw new Error(
        'Horizon network passphrase does not match the configured network',
      );
    }
    return {
      networkPassphrase: root.network_passphrase,
      horizonVersion: root.horizon_version,
      historyLatestLedger: root.history_latest_ledger,
    };
  }

  async latestPaymentCursor(accountId: string): Promise<string | null> {
    const { NotFoundError } = await this.sdk();
    try {
      const page = await (
        await this.horizon()
      )
        .payments()
        .forAccount(accountId)
        .order('desc')
        .limit(1)
        .call();
      const first = page.records[0];
      return first ? String(first.paging_token) : null;
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  async listPayments(
    accountId: string,
    afterCursor: string | null,
    limit: number,
  ): Promise<NormalizedPayment[]> {
    let builder = (await this.horizon())
      .payments()
      .forAccount(accountId)
      .order('asc')
      .limit(limit);
    if (afterCursor) builder = builder.cursor(afterCursor);
    const page = await builder.call();
    return page.records.map((record) =>
      mapHorizonOperation(
        record as unknown as Parameters<typeof mapHorizonOperation>[0],
      ),
    );
  }

  async getTransaction(hash: string): Promise<NormalizedTransaction> {
    const tx = await (
      await this.horizon()
    )
      .transactions()
      .transaction(hash)
      .call();
    return {
      hash: tx.hash,
      successful: tx.successful,
      createdAt: tx.created_at,
      memoType: tx.memo_type,
      memo: tx.memo ?? null,
      sourceAccount: tx.source_account,
    };
  }

  async getAccountReadiness(
    accountId: string,
    asset: { code: string; issuer: string | null },
  ): Promise<AccountAssetReadiness> {
    const { NotFoundError } = await this.sdk();
    try {
      const account = await (await this.horizon()).loadAccount(accountId);
      return readinessFromBalances(account.balances, asset);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          exists: false,
          nativeBalance: null,
          trustline: false,
          authorized: false,
        };
      }
      throw error;
    }
  }

  async getOperation(operationId: string): Promise<NormalizedPayment> {
    const operation = await (
      await this.horizon()
    )
      .operations()
      .operation(operationId)
      .call();
    return mapHorizonOperation(operation);
  }
}

function readinessFromBalances(
  balances: ReadonlyArray<{
    asset_type: string;
    balance: string;
    asset_code?: string;
    asset_issuer?: string;
    is_authorized?: boolean;
  }>,
  asset: { code: string; issuer: string | null },
): AccountAssetReadiness {
  const native = balances.find((line) => line.asset_type === 'native');
  if (asset.issuer === null) {
    return {
      exists: true,
      nativeBalance: native?.balance ?? null,
      trustline: false,
      authorized: false,
    };
  }
  const line = balances.find(
    (candidate) =>
      candidate.asset_code === asset.code &&
      candidate.asset_issuer === asset.issuer,
  );
  return {
    exists: true,
    nativeBalance: native?.balance ?? null,
    trustline: Boolean(line),
    authorized: line?.is_authorized !== false && Boolean(line),
  };
}
