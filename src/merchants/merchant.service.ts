import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { AuditService } from '../audit/audit.service';
import { isDuplicateKey } from '../common/errors';
import { generateApiKey } from '../common/secrets';
import { encryptWebhookSecret } from '../webhooks/secret-box';
import { Merchant, ObserverCursor } from '../database/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { HorizonClient } from '../stellar/horizon-client';
import { HORIZON_CLIENT } from '../stellar/horizon-client';
import { isValidEd25519PublicKey } from '../stellar/strkey';
import { pinWebhookAddress, WebhookUrlError } from '../webhooks/ssrf';

export type CreatedMerchant = {
  merchant: Merchant;
  apiKey: string;
};

@Injectable()
export class MerchantService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HORIZON_CLIENT) private readonly horizon: HorizonClient,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
  ) {}

  findByDestination(accountId: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { stellarDestination: accountId } });
  }

  async create(input: {
    name: string;
    stellarDestination: string;
    webhookUrl?: string | null;
    webhookSecret?: string | null;
    openRegistration: boolean;
  }): Promise<CreatedMerchant> {
    if (!input.openRegistration) {
      throw new ForbiddenException('merchant registration is disabled');
    }
    const destination = assertAccountId(input.stellarDestination);
    const webhookUrl = await this.normalizeWebhook(input.webhookUrl);
    const webhookSecret = input.webhookSecret?.trim() ?? '';
    if (webhookUrl && webhookSecret.length < 16) {
      throw new BadRequestException(
        'webhook_secret is required when webhook_url is set, and it must be at least 16 characters',
      );
    }
    if (!webhookUrl && webhookSecret.length > 0) {
      throw new BadRequestException(
        'webhook_secret was provided without webhook_url',
      );
    }
    const apiKey = generateApiKey();
    const cursor = await this.tipCursor(destination);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const merchantId = randomUUID();
        const merchant = manager.create(Merchant, {
          id: merchantId,
          name: input.name.trim(),
          apiKeyHash: apiKey.hash,
          apiKeyPrefix: apiKey.prefix,
          stellarDestination: destination,
          webhookUrl,
          webhookSecretCiphertext: webhookUrl
            ? encryptWebhookSecret(
                this.config.webhook.encryptionKey,
                merchantId,
                webhookSecret,
              )
            : null,
          settlementPaused: false,
        });
        await manager.save(merchant);
        await manager.insert(ObserverCursor, {
          network: this.config.stellar.network,
          accountId: destination,
          cursorToken: cursor,
        });
        await this.audit.record(manager, {
          actorType: 'merchant',
          actorId: merchant.id,
          action: 'merchant.created',
          entityType: 'merchant',
          entityId: merchant.id,
          toStatus: 'active',
          metadata: {
            destination,
            cursor_initialized_to: cursor === '' ? 'genesis' : 'horizon_tip',
            webhook_configured: Boolean(webhookUrl),
            webhook_secret_stored: webhookUrl ? 'aes-256-gcm' : 'none',
          },
        });
        return { merchant, apiKey: apiKey.raw };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(
          'that Stellar destination or API key is already registered',
        );
      }
      throw error;
    }
  }

  private async normalizeWebhook(
    webhookUrl?: string | null,
  ): Promise<string | null> {
    if (!webhookUrl) return null;
    try {
      const pinned = await pinWebhookAddress(webhookUrl, {
        hostAllowlist: this.config.webhook.hostAllowlist,
        allowPublicHttps: this.config.webhook.allowPublicHttps,
      });
      return pinned.url.toString();
    } catch (error) {
      if (error instanceof WebhookUrlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async tipCursor(accountId: string): Promise<string> {
    try {
      const tip = await this.horizon.latestPaymentCursor(accountId);
      return tip ?? '';
    } catch (error) {
      throw new ServiceUnavailableException(
        `Horizon did not return a cursor for ${accountId}: ${error instanceof Error ? error.message : 'unavailable'}`,
      );
    }
  }
}

export function assertAccountId(value: string): string {
  if (!isValidEd25519PublicKey(value)) {
    throw new BadRequestException(
      'stellar destination must be a G... ed25519 account id',
    );
  }
  return value;
}
