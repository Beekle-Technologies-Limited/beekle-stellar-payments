import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { errorMessage } from '../common/errors';
import { ObserverCursor } from '../database/entities';
import { PaymentProcessor } from '../payments/payment-processor.service';
import type { HorizonClient } from '../stellar/horizon-client';
import { HORIZON_CLIENT } from '../stellar/horizon-client';

@Injectable()
export class ObserverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObserverService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HORIZON_CLIENT) private readonly horizon: HorizonClient,
    @InjectRepository(ObserverCursor)
    private readonly cursors: Repository<ObserverCursor>,
    private readonly processor: PaymentProcessor,
  ) {}

  onModuleInit(): void {
    if (!this.config.observer.enabled) return;
    this.timer = setInterval(() => {
      void this.pollOnce().catch((error: unknown) => {
        this.logger.error(errorMessage(error));
      });
    }, this.config.observer.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce(): Promise<{ accounts: number; processed: number }> {
    if (this.running) return { accounts: 0, processed: 0 };
    this.running = true;
    try {
      const root = await this.horizon.getRoot();
      if (root.networkPassphrase !== this.config.stellar.passphrase) {
        throw new Error('refusing to observe: Horizon passphrase mismatch');
      }
      const rows = await this.cursors.find({
        where: { network: this.config.stellar.network },
      });
      let processed = 0;
      for (const row of rows) {
        try {
          const page = await this.horizon.listPayments(
            row.accountId,
            row.cursorToken || null,
            this.config.observer.pageLimit,
          );
          for (const listed of page) {
            if (!listed.transactionHash) {
              throw new Error(
                `payment ${listed.operationId} has no transaction hash`,
              );
            }
            const [transaction, operation] = await Promise.all([
              this.horizon.getTransaction(listed.transactionHash),
              this.horizon.getOperation(listed.operationId),
            ]);
            await this.processor.process({
              watchedAccountId: row.accountId,
              listed,
              operation,
              transaction,
              advanceCursor: true,
            });
            processed += 1;
          }
        } catch (error) {
          this.logger.error(
            `observer paused ${row.accountId}: ${errorMessage(error)}`,
          );
        }
      }
      return { accounts: rows.length, processed };
    } finally {
      this.running = false;
    }
  }
}
