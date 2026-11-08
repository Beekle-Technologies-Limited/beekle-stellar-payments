import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { CIRCLE_USDC } from '../stellar/known-assets';

export type PreparedReceiver = {
  accountId: string;
  assetCode: string;
  assetIssuer: string | null;
  mode: 'usdc_trustline' | 'xlm_funded';
  friendbotTx: string | null;
  trustlineTx: string | null;
  note: string;
};

export interface ReceiverPreparer {
  prepare(): Promise<PreparedReceiver>;
}

export const RECEIVER_PREPARER = Symbol('RECEIVER_PREPARER');

/**
 * Creates a testnet account with Friendbot, opens a Circle USDC trustline when
 * that issuer is reachable, then drops the keypair. Only the public account id
 * and transaction hashes leave this function. The seed is never stored or logged.
 * If the USDC trustline cannot be submitted, the funded account is returned as
 * an XLM receiver and is not described as USDC.
 */
@Injectable()
export class FriendbotReceiverPreparer implements ReceiverPreparer {
  private readonly logger = new Logger(FriendbotReceiverPreparer.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async prepare(): Promise<PreparedReceiver> {
    if (
      this.config.stellar.network !== 'testnet' ||
      this.config.stellar.passphrase !== 'Test SDF Network ; September 2015'
    ) {
      throw new ServiceUnavailableException(
        'A demo receiving account can only be initialized on Stellar testnet.',
      );
    }
    const sdk = await import('@stellar/stellar-sdk');
    if (String(sdk.Networks.TESTNET) !== this.config.stellar.passphrase) {
      throw new ServiceUnavailableException(
        'Refusing to initialize a receiver because the SDK testnet passphrase does not match configuration.',
      );
    }
    const server = new sdk.Horizon.Server(this.config.stellar.horizonUrl);
    const keypair = sdk.Keypair.random();
    const accountId = keypair.publicKey();
    try {
      const funded: unknown = await server.friendbot(accountId).call();
      const friendbotTx = readHash(funded);
      this.logger.log(
        `friendbot funded demo receiver ${accountId} tx ${friendbotTx ?? 'unknown'}`,
      );
      const usdc = this.config.stellar.acceptedAssets.find(
        (asset) =>
          asset.code === 'USDC' && asset.issuer === CIRCLE_USDC.testnet.issuer,
      );
      if (usdc?.issuer) {
        try {
          await server.loadAccount(usdc.issuer);
          const account = await server.loadAccount(accountId);
          const trust = new sdk.TransactionBuilder(account, {
            fee: sdk.BASE_FEE,
            networkPassphrase: sdk.Networks.TESTNET,
          })
            .addOperation(
              sdk.Operation.changeTrust({
                asset: new sdk.Asset(usdc.code, usdc.issuer),
              }),
            )
            .setTimeout(90)
            .build();
          trust.sign(keypair);
          const submitted = await server.submitTransaction(trust);
          const trustlineTx = submitted.hash;
          this.logger.log(
            `Circle testnet USDC trustline ${trustlineTx} on ${accountId}`,
          );
          return {
            accountId,
            assetCode: 'USDC',
            assetIssuer: usdc.issuer,
            mode: 'usdc_trustline',
            friendbotTx,
            trustlineTx,
            note: 'Friendbot funded this testnet account and a changeTrust for Circle testnet USDC was submitted. The seed was discarded.',
          };
        } catch (error) {
          this.logger.warn(
            `Circle testnet USDC trustline was not submitted for ${accountId}: ${redact(errorMessage(error))}. The demo will request native XLM instead.`,
          );
        }
      }
      const xlmAccepted = this.config.stellar.acceptedAssets.some(
        (asset) => asset.code === 'XLM' && asset.issuer === null,
      );
      if (!xlmAccepted) {
        throw new ServiceUnavailableException(
          'Circle testnet USDC trustline was not established, and native XLM is not an accepted asset, so no payable demo checkout was created.',
        );
      }
      return {
        accountId,
        assetCode: 'XLM',
        assetIssuer: null,
        mode: 'xlm_funded',
        friendbotTx,
        trustlineTx: null,
        note: 'Friendbot funded this testnet account. Circle USDC trustline was not confirmed, so this checkout requests native XLM, not USDC. The seed was not stored.',
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        `Demo receiver initialization failed: ${redact(errorMessage(error))}`,
      );
    }
  }
}

function readHash(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('hash' in value)) {
    return null;
  }
  const hash = (value as { hash?: unknown }).hash;
  return typeof hash === 'string' ? hash : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'initialization failed';
}

function redact(message: string): string {
  return message.replace(/S[A-Z2-7]{55}/g, '[redacted-seed]');
}
