import { Global, Module, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminService } from './admin/admin.service';
import {
  AdminController,
  CheckoutController,
  DemoPageController,
  HealthController,
  IntentsController,
  MerchantsController,
} from './api/controllers';
import { AdminGuard, MerchantAuthGuard } from './api/guards';
import { AuditService } from './audit/audit.service';
import { CLOCK, SystemClock } from './common/clock';
import type { AppConfig } from './config/app-config';
import { APP_CONFIG } from './config/app-config-token';
import { loadConfig } from './config/app-config';
import { ENTITIES } from './database/entities';
import { nestTypeOrmOptions } from './database/typeorm-options';
import { DemoReceiverService } from './demo/demo-receiver.service';
import {
  FriendbotReceiverPreparer,
  RECEIVER_PREPARER,
} from './demo/friendbot-receiver';
import { IntentService } from './intents/intent.service';
import { LedgerService } from './ledger/ledger.service';
import { MerchantService } from './merchants/merchant.service';
import { ExpiryService } from './observer/expiry.service';
import { ObserverService } from './observer/observer.service';
import { ReconciliationService } from './observer/reconciliation.service';
import { PaymentProcessor } from './payments/payment-processor.service';
import { HORIZON_CLIENT } from './stellar/horizon-client';
import { SdkHorizonClient } from './stellar/sdk-horizon-client';
import { WebhookService } from './webhooks/webhook.service';

class DatabaseInit implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.migrateOnBoot) {
      await this.dataSource.runMigrations();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => nestTypeOrmOptions(config),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  controllers: [
    HealthController,
    DemoPageController,
    MerchantsController,
    IntentsController,
    CheckoutController,
    AdminController,
  ],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: HORIZON_CLIENT, useClass: SdkHorizonClient },
    DatabaseInit,
    LedgerService,
    AuditService,
    WebhookService,
    PaymentProcessor,
    MerchantService,
    IntentService,
    DemoReceiverService,
    { provide: RECEIVER_PREPARER, useClass: FriendbotReceiverPreparer },
    ObserverService,
    ExpiryService,
    ReconciliationService,
    AdminService,
    MerchantAuthGuard,
    AdminGuard,
  ],
})
export class AppModule {}
