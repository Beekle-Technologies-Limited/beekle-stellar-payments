import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import type { Clock } from '../common/clock';
import { CLOCK } from '../common/clock';
import { errorMessage } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { Merchant, PaymentIntent } from '../database/entities';
import { WebhookService } from '../webhooks/webhook.service';

@Injectable()
export class ExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
    @InjectRepository(PaymentIntent)
    private readonly intents: Repository<PaymentIntent>,
  ) {}

  onModuleInit(): void {
    if (!this.config.expiry.enabled) return;
    this.timer = setInterval(() => {
      void this.expireDue().catch((error: unknown) => {
        this.logger.error(errorMessage(error));
      });
    }, this.config.expiry.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async expireDue(): Promise<number> {
    const due = await this.intents.find({
      where: {
        status: 'AWAITING_PAYMENT',
        expiresAt: LessThanOrEqual(this.clock.now()),
      },
      take: 100,
    });
    let expired = 0;
    for (const candidate of due) {
      const did = await this.dataSource.transaction(async (manager) => {
        const intent = await manager.findOne(PaymentIntent, {
          where: { id: candidate.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!intent || intent.status !== 'AWAITING_PAYMENT') return false;
        if (intent.expiresAt.getTime() > this.clock.now().getTime())
          return false;
        intent.status = 'EXPIRED';
        await manager.save(intent);
        await this.audit.record(manager, {
          actorType: 'system',
          actorId: null,
          action: 'intent.expired',
          entityType: 'payment_intent',
          entityId: intent.id,
          fromStatus: 'AWAITING_PAYMENT',
          toStatus: 'EXPIRED',
        });
        const merchant = await manager.findOne(Merchant, {
          where: { id: intent.merchantId },
        });
        if (merchant) {
          await this.webhooks.enqueue(manager, {
            merchant,
            intent,
            type: 'payment.expired',
            dedupeKey: `intent:${intent.id}:payment.expired`,
            payment: null,
            assetCode: intent.assetCode,
            assetIssuer: intent.assetIssuer,
          });
        }
        return true;
      });
      if (did) expired += 1;
    }
    return expired;
  }
}
