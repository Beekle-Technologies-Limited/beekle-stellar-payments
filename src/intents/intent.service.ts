import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { findAcceptedAsset } from '../config/app-config';
import { AuditService } from '../audit/audit.service';
import type { Clock } from '../common/clock';
import { CLOCK } from '../common/clock';
import { formatStellarAmount, parseStellarAmount } from '../common/money';
import { isDuplicateKey } from '../common/errors';
import { generateMemo, hashRequest } from '../common/secrets';
import { Merchant, PaymentIntent } from '../database/entities';
import { buildSep7PayUri } from '../stellar/sep7';

const DEFAULT_TTL_SECONDS = 30 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class IntentService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(PaymentIntent)
    private readonly intents: Repository<PaymentIntent>,
  ) {}

  async create(
    merchant: Merchant,
    input: {
      idempotencyKey: string;
      amount: string;
      assetCode: string;
      assetIssuer: string | null;
      merchantOrderRef: string | null;
      expiresInSeconds: number | null;
    },
  ): Promise<{ intent: PaymentIntent; replayed: boolean }> {
    if (!/^[ -~]{8,128}$/.test(input.idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8 to 128 printable ASCII characters',
      );
    }
    let amount: string;
    try {
      amount = formatStellarAmount(parseStellarAmount(input.amount));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'invalid amount',
      );
    }
    const asset = findAcceptedAsset(
      this.config,
      input.assetCode,
      input.assetIssuer,
    );
    if (!asset) {
      throw new BadRequestException(
        `asset ${input.assetCode}:${input.assetIssuer ?? 'native'} is not accepted on ${this.config.stellar.network}`,
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
      throw new BadRequestException(
        `expires_in_seconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`,
      );
    }
    const requestHash = hashRequest({
      amount,
      assetCode: asset.code,
      assetIssuer: asset.issuer,
      merchantOrderRef: input.merchantOrderRef,
    });
    const existing = await this.intents.findOne({
      where: { merchantId: merchant.id, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different request body',
        );
      }
      return { intent: existing, replayed: true };
    }
    const expiresAt = new Date(this.clock.now().getTime() + ttl * 1000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.dataSource.transaction(async (manager) => {
          const intent = manager.create(PaymentIntent, {
            id: randomUUID(),
            merchantId: merchant.id,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            merchantOrderRef: input.merchantOrderRef,
            provider: 'stellar',
            network: this.config.stellar.network,
            amount,
            receivedAmount: '0.0000000',
            recognizedAmount: '0.0000000',
            assetCode: asset.code,
            assetIssuer: asset.issuer,
            destination: merchant.stellarDestination,
            memo: generateMemo(),
            memoType: 'MEMO_TEXT',
            status: 'AWAITING_PAYMENT',
            expiresAt,
            providerReference: null,
            creditedAt: null,
          });
          await manager.save(intent);
          await this.audit.record(manager, {
            actorType: 'merchant',
            actorId: merchant.id,
            action: 'intent.created',
            entityType: 'payment_intent',
            entityId: intent.id,
            toStatus: 'AWAITING_PAYMENT',
            metadata: {
              amount,
              asset_code: asset.code,
              asset_issuer: asset.issuer,
              destination: merchant.stellarDestination,
              memo: intent.memo,
              expires_at: expiresAt.toISOString(),
            },
          });
          return intent;
        });
        return { intent: created, replayed: false };
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const raced = await this.intents.findOne({
          where: {
            merchantId: merchant.id,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (raced) {
          if (raced.requestHash !== requestHash) {
            throw new ConflictException(
              'Idempotency-Key was already used with a different request body',
            );
          }
          return { intent: raced, replayed: true };
        }
      }
    }
    throw new ConflictException('could not allocate a unique memo');
  }

  async getForMerchant(
    merchantId: string,
    intentId: string,
  ): Promise<PaymentIntent> {
    const intent = await this.intents.findOne({
      where: { id: intentId, merchantId },
    });
    if (!intent) throw new NotFoundException('payment intent not found');
    return intent;
  }

  async getPublic(intentId: string): Promise<PaymentIntent> {
    const intent = await this.intents.findOne({ where: { id: intentId } });
    if (!intent) throw new NotFoundException('payment intent not found');
    return intent;
  }

  sep7(intent: PaymentIntent, message: string): string {
    return buildSep7PayUri({
      destination: intent.destination,
      amount: formatStellarAmount(String(intent.amount)),
      assetCode: intent.assetCode,
      assetIssuer: intent.assetIssuer,
      memo: intent.memo,
      memoType: 'MEMO_TEXT',
      networkPassphrase: this.config.stellar.passphrase,
      message,
    });
  }
}
