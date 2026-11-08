import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import QRCode from 'qrcode';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { AdminService } from '../admin/admin.service';
import { renderCheckoutPage, renderHomePage } from '../checkout/pages';
import {
  LedgerAccount,
  LedgerBalance,
  Merchant,
  PaymentIntent,
  ReviewCase,
} from '../database/entities';
import { DemoReceiverService } from '../demo/demo-receiver.service';
import { IntentService } from '../intents/intent.service';
import { MerchantService } from '../merchants/merchant.service';
import type { HorizonClient } from '../stellar/horizon-client';
import { HORIZON_CLIENT } from '../stellar/horizon-client';
import { assessReceivingReadiness } from '../stellar/readiness';
import type { ReceivingAssessment } from '../stellar/readiness';
import { ExpiryService } from '../observer/expiry.service';
import { ObserverService } from '../observer/observer.service';
import { ReconciliationService } from '../observer/reconciliation.service';
import { formatStellarAmount, parseStellarAmount } from '../common/money';
import { DataSource } from 'typeorm';
import {
  BackfillDto,
  CreateIntentDto,
  CreateMerchantDto,
  CursorDto,
  DemoCheckoutDto,
  ExternalRefundDto,
} from './dto';
import type { MerchantRequest } from './guards';
import { AdminGuard, MerchantAuthGuard } from './guards';
import { presentIntent } from './present';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
  ) {}

  @Get('health')
  async health() {
    await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      database: 'up',
      stellar: {
        network: this.config.stellar.network,
        horizon: this.config.stellar.horizonUrl,
        mainnet_enabled: this.config.stellar.allowMainnet,
        signs_transactions: false,
      },
    };
  }
}

@ApiTags('demo')
@Controller()
export class DemoPageController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly merchants: MerchantService,
    private readonly intents: IntentService,
    private readonly demoReceivers: DemoReceiverService,
  ) {}

  @Get()
  home(@Res() response: Response): void {
    const usdc = this.config.stellar.acceptedAssets.find(
      (asset) => asset.code === 'USDC' && asset.issuer,
    );
    response.type('html').send(
      renderHomePage({
        network: this.config.stellar.network,
        assetLabel: usdc ? 'USDC' : 'XLM',
        openRegistration: this.config.demoOpenRegistration,
        usdcConfigured: Boolean(usdc),
      }),
    );
  }

  @Post('v1/demo/checkout')
  async demoCheckout(@Body() body: DemoCheckoutDto) {
    if (!this.config.demoOpenRegistration) {
      throw new BadRequestException('demo registration is disabled');
    }
    const amount = body.amount?.trim() || '10.0000000';
    try {
      formatStellarAmount(parseStellarAmount(amount));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'invalid amount',
      );
    }
    const receiver = await this.demoReceivers.payableDestination(
      body.stellar_destination?.trim() || null,
    );
    let merchant = await this.merchants.findByDestination(receiver.accountId);
    let apiKey: string | null = null;
    if (!merchant) {
      const created = await this.merchants.create({
        name: 'Demo merchant',
        stellarDestination: receiver.accountId,
        webhookUrl: null,
        openRegistration: true,
      });
      merchant = created.merchant;
      apiKey = created.apiKey;
    }
    const intent = await this.intents.create(merchant, {
      idempotencyKey: `demo-${randomUUID()}`,
      amount,
      assetCode: receiver.assetCode,
      assetIssuer: receiver.assetIssuer,
      merchantOrderRef: 'demo-checkout',
      expiresInSeconds: 1800,
    });
    return {
      checkout_path: `/checkout/${intent.intent.id}`,
      intent_id: intent.intent.id,
      destination: receiver.accountId,
      api_key: apiKey,
      asset: {
        code: receiver.assetCode,
        issuer: receiver.assetIssuer,
        label:
          receiver.mode === 'usdc_trustline'
            ? 'Circle testnet USDC'
            : 'native testnet XLM, not USDC',
      },
      readiness: receiver.readiness,
      mode: receiver.mode,
      friendbot_tx: receiver.friendbotTx,
      trustline_tx: receiver.trustlineTx,
      note: receiver.note,
    };
  }
}

@ApiTags('merchants')
@Controller('v1/merchants')
export class MerchantsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly merchants: MerchantService,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerBalance)
    private readonly balances: Repository<LedgerBalance>,
  ) {}

  @Post()
  @ApiOkResponse({
    description:
      'Merchant created. The API key is returned once. A webhook HMAC secret is encrypted at rest and is not returned.',
  })
  async create(@Body() body: CreateMerchantDto) {
    const created = await this.merchants.create({
      name: body.name,
      stellarDestination: body.stellar_destination,
      webhookUrl: body.webhook_url ?? null,
      webhookSecret: body.webhook_secret ?? null,
      openRegistration: this.config.demoOpenRegistration,
    });
    return {
      id: created.merchant.id,
      name: created.merchant.name,
      stellar_destination: created.merchant.stellarDestination,
      api_key: created.apiKey,
      api_key_prefix: created.merchant.apiKeyPrefix,
      webhook_configured: Boolean(created.merchant.webhookUrl),
      webhook_secret_stored: created.merchant.webhookSecretCiphertext
        ? 'aes-256-gcm'
        : 'none',
      settlement_paused: created.merchant.settlementPaused,
    };
  }

  @Get('me')
  @UseGuards(MerchantAuthGuard)
  @ApiBearerAuth()
  me(@Req() request: MerchantRequest) {
    return publicMerchant(request.merchant);
  }

  @Get('me/ledger')
  @UseGuards(MerchantAuthGuard)
  @ApiBearerAuth()
  async ledger(@Req() request: MerchantRequest) {
    const accounts = await this.accounts.find({
      where: { merchantId: request.merchant.id },
    });
    const rows = [];
    for (const account of accounts) {
      const balance = await this.balances.findOne({
        where: { accountId: account.id },
      });
      rows.push({
        bucket: account.bucket,
        kind: account.kind,
        asset_code: account.assetCode,
        asset_issuer: account.assetIssuer,
        network: account.network,
        balance: balance ? String(balance.balance) : '0.0000000',
      });
    }
    return {
      model: 'self_custody_recognition',
      note: 'Balances record recognized payments to the merchant Stellar account. They are not custodial funds held by Beekle.',
      settlement_paused: request.merchant.settlementPaused,
      accounts: rows,
    };
  }
}

@ApiTags('intents')
@Controller('v1/intents')
@UseGuards(MerchantAuthGuard)
@ApiBearerAuth()
export class IntentsController {
  constructor(
    private readonly intents: IntentService,
    @InjectRepository(PaymentIntent)
    private readonly records: Repository<PaymentIntent>,
  ) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @Req() request: MerchantRequest,
    @Body() body: CreateIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.intents.create(request.merchant, {
      idempotencyKey,
      amount: body.amount,
      assetCode: body.asset_code,
      assetIssuer: body.asset_issuer?.trim() ? body.asset_issuer.trim() : null,
      merchantOrderRef: body.merchant_order_ref ?? null,
      expiresInSeconds: body.expires_in_seconds ?? null,
    });
    return {
      replayed: result.replayed,
      intent: presentIntent(
        result.intent,
        this.intents.sep7(result.intent, messageFor(result.intent)),
      ),
    };
  }

  @Get()
  async list(@Req() request: MerchantRequest) {
    const rows = await this.records.find({
      where: { merchantId: request.merchant.id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { intents: rows.map((intent) => presentIntent(intent, null)) };
  }

  @Get(':id')
  async get(@Req() request: MerchantRequest, @Param('id') id: string) {
    const intent = await this.intents.getForMerchant(request.merchant.id, id);
    return presentIntent(intent, this.intents.sep7(intent, messageFor(intent)));
  }
}

@ApiTags('checkout')
@Controller()
export class CheckoutController {
  constructor(
    private readonly intents: IntentService,
    @Inject(HORIZON_CLIENT) private readonly horizon: HorizonClient,
  ) {}

  @Get('checkout/:id')
  async page(@Param('id') id: string, @Res() response: Response) {
    const intent = await this.intents.getPublic(id);
    const readiness = await this.readiness(intent);
    const sep7 = readiness.ready
      ? this.intents.sep7(intent, messageFor(intent))
      : null;
    response.type('html').send(
      renderCheckoutPage({
        id: intent.id,
        status: intent.status,
        amount: formatStellarAmount(String(intent.amount)),
        assetCode: intent.assetCode,
        assetIssuer: intent.assetIssuer,
        network: intent.network,
        destination: intent.destination,
        memo: intent.memo,
        memoType: intent.memoType,
        expiresAt: new Date(intent.expiresAt).toISOString(),
        sep7,
        providerReference: intent.providerReference,
        receivedAmount: formatStellarAmount(String(intent.receivedAmount)),
        passphrase: this.passphrase(intent.network),
        readiness,
      }),
    );
  }

  @Get('v1/checkout/:id')
  async json(@Param('id') id: string) {
    const intent = await this.intents.getPublic(id);
    const readiness = await this.readiness(intent);
    return {
      ...presentIntent(
        intent,
        readiness.ready ? this.intents.sep7(intent, messageFor(intent)) : null,
      ),
      receiving_account: readiness,
    };
  }

  @Get('v1/checkout/:id/qr.png')
  async qr(@Param('id') id: string, @Res() response: Response) {
    const intent = await this.intents.getPublic(id);
    const readiness = await this.readiness(intent);
    if (!readiness.ready) {
      response.status(409).json({
        error: { code: 'receiver_not_ready', message: readiness.message },
      });
      return;
    }
    const png = await QRCode.toBuffer(
      this.intents.sep7(intent, messageFor(intent)),
      {
        type: 'png',
        width: 420,
        margin: 1,
        errorCorrectionLevel: 'M',
      },
    );
    response.setHeader('content-type', 'image/png');
    response.setHeader('cache-control', 'no-store');
    response.send(png);
  }

  private async readiness(intent: PaymentIntent): Promise<ReceivingAssessment> {
    const account = await this.horizon.getAccountReadiness(intent.destination, {
      code: intent.assetCode,
      issuer: intent.assetIssuer,
    });
    return assessReceivingReadiness({
      assetCode: intent.assetCode,
      assetIssuer: intent.assetIssuer,
      account,
    });
  }

  private passphrase(network: string): string {
    return network === 'mainnet'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';
  }
}

@ApiTags('admin')
@ApiSecurity('admin')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly observer: ObserverService,
    private readonly expiry: ExpiryService,
    private readonly reconciliation: ReconciliationService,
    @InjectRepository(ReviewCase)
    private readonly reviews: Repository<ReviewCase>,
  ) {}

  @Post('observer/poll')
  poll() {
    return this.observer.pollOnce();
  }

  @Post('observer/cursor')
  async cursor(@Body() body: CursorDto) {
    await this.admin.setCursor(body.account_id, body.cursor);
    return { account_id: body.account_id, cursor: body.cursor };
  }

  @Post('expiry/run')
  expire() {
    return this.expiry.expireDue().then((expired) => ({ expired }));
  }

  @Post('reconciliation/run')
  backfill(@Body() body: BackfillDto) {
    return this.reconciliation.backfill({
      accountId: body.account_id,
      maxPages: body.max_pages ?? 3,
      fromCursor: body.from_cursor,
    });
  }

  @Get('reviews')
  async reviewsList() {
    const rows = await this.reviews.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return { reviews: rows };
  }

  @Post('intents/:id/recognize')
  recognize(@Param('id') id: string) {
    return this.admin
      .recognize(id)
      .then((intent) => presentIntent(intent, null));
  }

  @Post('reviews/:id/external-refund')
  refund(@Param('id') id: string, @Body() body: ExternalRefundDto) {
    return this.admin.recordExternalRefund(
      id,
      body.note,
      body.external_reference,
    );
  }
}

function publicMerchant(merchant: Merchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    stellar_destination: merchant.stellarDestination,
    api_key_prefix: merchant.apiKeyPrefix,
    webhook_configured: Boolean(merchant.webhookUrl),
    settlement_paused: merchant.settlementPaused,
  };
}

function messageFor(intent: PaymentIntent): string {
  const ref = intent.merchantOrderRef ?? intent.id;
  return `Beekle checkout ${ref}`.slice(0, 300);
}

export function assertFound<T>(value: T | null, message: string): T {
  if (!value) throw new NotFoundException(message);
  return value;
}
