import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { findAcceptedAsset } from '../config/app-config';
import { DemoReceiver } from '../database/entities';
import type { HorizonClient } from '../stellar/horizon-client';
import { HORIZON_CLIENT } from '../stellar/horizon-client';
import {
  assessReceivingReadiness,
  type ReceivingAssessment,
} from '../stellar/readiness';
import {
  RECEIVER_PREPARER,
  type PreparedReceiver,
  type ReceiverPreparer,
} from './friendbot-receiver';

export type PayableReceiver = PreparedReceiver & {
  readiness: ReceivingAssessment;
};

@Injectable()
export class DemoReceiverService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HORIZON_CLIENT) private readonly horizon: HorizonClient,
    @Inject(RECEIVER_PREPARER) private readonly preparer: ReceiverPreparer,
    @InjectRepository(DemoReceiver)
    private readonly receivers: Repository<DemoReceiver>,
  ) {}

  async payableDestination(
    requestedAccount: string | null,
  ): Promise<PayableReceiver> {
    if (requestedAccount) {
      const asset =
        findAcceptedAsset(
          this.config,
          'USDC',
          this.config.stellar.acceptedAssets.find(
            (item) => item.code === 'USDC',
          )?.issuer ?? null,
        ) ?? this.config.stellar.acceptedAssets[0];
      if (!asset) {
        throw new ServiceUnavailableException(
          'no accepted asset is configured',
        );
      }
      const readiness = await this.assess(requestedAccount, asset);
      if (!readiness.ready) {
        throw new ConflictException(readiness.message);
      }
      return {
        accountId: requestedAccount,
        assetCode: asset.code,
        assetIssuer: asset.issuer,
        mode: asset.issuer ? 'usdc_trustline' : 'xlm_funded',
        friendbotTx: null,
        trustlineTx: null,
        note: readiness.message,
        readiness,
      };
    }
    const saved = await this.receivers.findOne({
      where: { network: this.config.stellar.network },
    });
    if (saved) {
      const reusable = await this.reuse(saved);
      if (reusable) return reusable;
    }
    const prepared = await this.preparer.prepare();
    const readiness = await this.assess(prepared.accountId, {
      code: prepared.assetCode,
      issuer: prepared.assetIssuer,
    });
    if (!readiness.ready) {
      throw new ServiceUnavailableException(
        `${prepared.note} Horizon still does not show the account ready: ${readiness.message}`,
      );
    }
    const row =
      saved ?? this.receivers.create({ network: this.config.stellar.network });
    row.accountId = prepared.accountId;
    row.assetCode = prepared.assetCode;
    row.assetIssuer = prepared.assetIssuer;
    row.mode = prepared.mode;
    row.friendbotTx = prepared.friendbotTx;
    row.trustlineTx = prepared.trustlineTx;
    await this.receivers.save(row);
    return { ...prepared, readiness };
  }

  private async reuse(saved: DemoReceiver): Promise<PayableReceiver | null> {
    const asset = { code: saved.assetCode, issuer: saved.assetIssuer };
    const readiness = await this.assess(saved.accountId, asset);
    if (
      readiness.ready &&
      findAcceptedAsset(this.config, asset.code, asset.issuer)
    ) {
      return {
        accountId: saved.accountId,
        assetCode: saved.assetCode,
        assetIssuer: saved.assetIssuer,
        mode: saved.mode === 'usdc_trustline' ? 'usdc_trustline' : 'xlm_funded',
        friendbotTx: saved.friendbotTx,
        trustlineTx: saved.trustlineTx,
        note:
          saved.mode === 'usdc_trustline'
            ? 'Reusing the Friendbot-funded testnet account whose Circle USDC trustline Horizon still confirms.'
            : 'Reusing the Friendbot-funded testnet account for native XLM. This is not a USDC payment.',
        readiness,
      };
    }
    if (saved.mode === 'usdc_trustline') {
      const xlm = findAcceptedAsset(this.config, 'XLM', null);
      if (!xlm) return null;
      const xlmReadiness = await this.assess(saved.accountId, xlm);
      if (!xlmReadiness.ready) return null;
      saved.assetCode = 'XLM';
      saved.assetIssuer = null;
      saved.mode = 'xlm_funded';
      await this.receivers.save(saved);
      return {
        accountId: saved.accountId,
        assetCode: 'XLM',
        assetIssuer: null,
        mode: 'xlm_funded',
        friendbotTx: saved.friendbotTx,
        trustlineTx: saved.trustlineTx,
        note: 'The saved account no longer shows a USDC trustline. This checkout requests native XLM instead, which Horizon says the account can receive.',
        readiness: xlmReadiness,
      };
    }
    return null;
  }

  private async assess(
    accountId: string,
    asset: { code: string; issuer: string | null },
  ): Promise<ReceivingAssessment> {
    const account = await this.horizon.getAccountReadiness(accountId, asset);
    return assessReceivingReadiness({
      assetCode: asset.code,
      assetIssuer: asset.issuer,
      account,
    });
  }
}
