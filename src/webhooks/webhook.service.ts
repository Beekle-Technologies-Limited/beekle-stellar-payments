import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { LessThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import type { Clock } from '../common/clock';
import { CLOCK } from '../common/clock';
import { errorMessage, isDuplicateKey } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { Merchant, PaymentIntent, WebhookDelivery } from '../database/entities';
import {
  buildNormalizedEvent,
  NormalizedEventType,
} from '../providers/normalized-event';
import type { NormalizedPayment } from '../stellar/horizon-types';
import { signWebhookBody } from './signature';
import { decryptWebhookSecret, WebhookSecretError } from './secret-box';
import { pinWebhookAddress } from './ssrf';

function postPinned(input: {
  url: URL;
  address: string;
  body: string;
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<{ status: number; text: string }> {
  const library = input.url.protocol === 'https:' ? https : http;
  const family = isIP(input.address) === 6 ? 6 : 4;
  return new Promise((resolve, reject) => {
    const request = library.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port || undefined,
        path: `${input.url.pathname}${input.url.search}`,
        method: 'POST',
        headers: {
          ...input.headers,
          'content-length': Buffer.byteLength(input.body),
        },
        servername: input.url.hostname,
        timeout: input.timeoutMs,
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address, family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          if (chunks.reduce((sum, item) => sum + item.length, 0) < 400) {
            chunks.push(chunk);
          }
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8').slice(0, 300),
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error('webhook timeout'));
    });
    request.on('error', reject);
    request.write(input.body);
    request.end();
  });
}

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(PaymentIntent)
    private readonly intents: Repository<PaymentIntent>,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (!this.config.webhook.workerEnabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.processDue().catch((error: unknown) => {
        this.logger.error(errorMessage(error));
      });
    }, this.config.webhook.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(
    manager: EntityManager,
    input: {
      merchant: Merchant;
      intent: PaymentIntent | null;
      type: NormalizedEventType;
      dedupeKey: string;
      payment: NormalizedPayment | null;
      assetCode: string | null;
      assetIssuer: string | null;
    },
  ): Promise<void> {
    if (!input.merchant.webhookUrl || !input.merchant.webhookSecretCiphertext) {
      return;
    }
    const event = buildNormalizedEvent({
      type: input.type,
      createdAt: this.clock.now(),
      intent: input.intent,
      payment: input.payment,
      destination: input.merchant.stellarDestination,
      network: this.config.stellar.network,
      assetCode: input.assetCode,
      assetIssuer: input.assetIssuer,
    });
    try {
      await manager.insert(WebhookDelivery, {
        id: event.eventId,
        eventId: event.eventId,
        dedupeKey: input.dedupeKey,
        merchantId: input.merchant.id,
        intentId: input.intent?.id ?? null,
        eventType: input.type,
        payloadBody: event.body,
        attemptCount: 0,
        maxAttempts: this.config.webhook.backoffMs.length,
        nextAttemptAt: this.clock.now(),
        status: 'pending',
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  async processDue(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.deliveries.find({
        where: {
          status: 'pending',
          nextAttemptAt: LessThanOrEqual(this.clock.now()),
        },
        order: { nextAttemptAt: 'ASC' },
        take: limit,
      });
      for (const delivery of due) {
        await this.deliverOne(delivery.id);
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  private async deliverOne(id: string): Promise<void> {
    const delivery = await this.deliveries.findOne({ where: { id } });
    if (!delivery || delivery.status !== 'pending') return;
    const merchant = await this.merchants.findOne({
      where: { id: delivery.merchantId },
    });
    if (!merchant?.webhookUrl || !merchant.webhookSecretCiphertext) {
      delivery.status = 'failed';
      delivery.lastError = 'merchant webhook is no longer configured';
      await this.deliveries.save(delivery);
      return;
    }
    let signingSecret: string;
    try {
      signingSecret = decryptWebhookSecret(
        this.config.webhook.encryptionKey,
        merchant.id,
        merchant.webhookSecretCiphertext,
      );
    } catch (error) {
      if (!(error instanceof WebhookSecretError)) {
        this.logger.error('webhook secret decryption failed');
      }
      delivery.status = 'failed';
      delivery.lastError = 'webhook signing secret could not be decrypted';
      await this.deliveries.save(delivery);
      return;
    }
    const timestamp = Math.floor(this.clock.now().getTime() / 1000).toString();
    const signature = signWebhookBody(
      signingSecret,
      timestamp,
      delivery.payloadBody,
    );
    try {
      const pinned = await pinWebhookAddress(merchant.webhookUrl, {
        hostAllowlist: this.config.webhook.hostAllowlist,
        allowPublicHttps: this.config.webhook.allowPublicHttps,
      });
      const response = await postPinned({
        url: pinned.url,
        address: pinned.address,
        body: delivery.payloadBody,
        timeoutMs: this.config.webhook.timeoutMs,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'beekle-stellar-payments/0.1',
          'beekle-signature': signature,
          'beekle-event-id': delivery.eventId,
        },
      });
      if (response.status >= 300 && response.status < 400) {
        await this.markFailure(
          delivery,
          response.status,
          'redirect was not followed',
        );
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        await this.markFailure(
          delivery,
          response.status,
          response.text || 'non-success status',
        );
        return;
      }
      delivery.status = 'delivered';
      delivery.lastStatusCode = response.status;
      delivery.deliveredAt = this.clock.now();
      delivery.attemptCount += 1;
      delivery.lastError = null;
      await this.deliveries.save(delivery);
      await this.markIntentCompleted(delivery.intentId);
    } catch (error) {
      await this.markFailure(delivery, null, errorMessage(error).slice(0, 300));
    }
  }

  private async markFailure(
    delivery: WebhookDelivery,
    statusCode: number | null,
    message: string,
  ): Promise<void> {
    delivery.attemptCount += 1;
    delivery.lastStatusCode = statusCode;
    delivery.lastError = message.slice(0, 500);
    if (delivery.attemptCount >= delivery.maxAttempts) {
      delivery.status = 'failed';
    } else {
      const delay =
        this.config.webhook.backoffMs[
          Math.min(
            delivery.attemptCount - 1,
            this.config.webhook.backoffMs.length - 1,
          )
        ] ?? 0;
      delivery.nextAttemptAt = new Date(this.clock.now().getTime() + delay);
      delivery.status = 'pending';
    }
    await this.deliveries.save(delivery);
  }

  private async markIntentCompleted(intentId: string | null): Promise<void> {
    if (!intentId) return;
    await this.intents.manager.transaction(async (manager) => {
      const intent = await manager.findOne(PaymentIntent, {
        where: { id: intentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intent || intent.status !== 'CREDITED') return;
      const from = intent.status;
      intent.status = 'COMPLETED';
      await manager.save(intent);
      await this.audit.record(manager, {
        actorType: 'system',
        actorId: null,
        action: 'intent.completed',
        entityType: 'payment_intent',
        entityId: intent.id,
        fromStatus: from,
        toStatus: 'COMPLETED',
        metadata: { reason: 'webhook_acknowledged' },
      });
    });
  }
}
