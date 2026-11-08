import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { loadConfig } from '../src/config/app-config';
import { createDataSource } from '../src/database/typeorm-options';
import { CLOCK, Clock } from '../src/common/clock';
import { HORIZON_CLIENT } from '../src/stellar/horizon-client';
import { CIRCLE_USDC } from '../src/stellar/known-assets';
import { randomWatchOnlyPublicKey } from '../src/stellar/strkey';
import {
  NormalizedPayment,
  NormalizedTransaction,
} from '../src/stellar/horizon-types';
import { verifyWebhookSignature } from '../src/webhooks/signature';
import { encryptWebhookSecret } from '../src/webhooks/secret-box';
import { WebhookService } from '../src/webhooks/webhook.service';
import { ObserverService } from '../src/observer/observer.service';
import { ExpiryService } from '../src/observer/expiry.service';
import { ReconciliationService } from '../src/observer/reconciliation.service';
import { FakeHorizon } from './fake-horizon';

const ISSUER = CIRCLE_USDC.testnet.issuer;
const WEBHOOK_SECRET = 'test-webhook-secret-value';

class MutableClock implements Clock {
  current = new Date('2026-06-01T00:00:00.000Z');
  now(): Date {
    return this.current;
  }
}

describe('Stellar checkout (MySQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let horizon: FakeHorizon;
  let clock: MutableClock;
  const payer = randomWatchOnlyPublicKey();

  beforeAll(async () => {
    const setup = createDataSource(loadConfig());
    await setup.initialize();
    await setup.runMigrations();
    await setup.destroy();
    horizon = new FakeHorizon();
    clock = new MutableClock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HORIZON_CLIENT)
      .useValue(horizon)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    horizon.reset();
    clock.current = new Date('2026-06-01T00:00:00.000Z');
    await dataSource.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of [
      'webhook_deliveries',
      'review_cases',
      'ledger_entries',
      'ledger_balances',
      'ledger_accounts',
      'stellar_observations',
      'reconciliation_findings',
      'audit_events',
      'demo_receivers',
      'observer_cursors',
      'payment_intents',
      'merchants',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table}`);
    }
    await dataSource.query('SET FOREIGN_KEY_CHECKS=1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a numeric amount and creates an exact-decimal intent with a testnet SEP-7 URI', async () => {
    const merchant = await createMerchant();
    await request(app.getHttpServer())
      .post('/v1/intents')
      .set('authorization', `Bearer ${merchant.api_key}`)
      .set('idempotency-key', 'order-float')
      .send({ amount: 10.5, asset_code: 'USDC', asset_issuer: ISSUER })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post('/v1/intents')
      .set('authorization', `Bearer ${merchant.api_key}`)
      .set('idempotency-key', 'order-1001')
      .send({
        amount: '10.50',
        asset_code: 'USDC',
        asset_issuer: ISSUER,
        merchant_order_ref: 'order-1001',
      })
      .expect(201);
    expect(created.body.intent.amount).toBe('10.5000000');
    expect(created.body.intent.sep7_uri).toContain('web+stellar:pay?');
    expect(created.body.intent.sep7_uri).toContain(
      encodeURIComponent('Test SDF Network ; September 2015'),
    );
    expect(created.body.intent.sep7_uri).toContain(ISSUER);
    expect(created.body.intent.reference.memo).toHaveLength(20);
    const replay = await request(app.getHttpServer())
      .post('/v1/intents')
      .set('authorization', `Bearer ${merchant.api_key}`)
      .set('idempotency-key', 'order-1001')
      .send({
        amount: '10.50',
        asset_code: 'USDC',
        asset_issuer: ISSUER,
        merchant_order_ref: 'order-1001',
      })
      .expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.intent.id).toBe(created.body.intent.id);
    await request(app.getHttpServer())
      .post('/v1/intents')
      .set('authorization', `Bearer ${merchant.api_key}`)
      .set('idempotency-key', 'order-1001')
      .send({
        amount: '11.00',
        asset_code: 'USDC',
        asset_issuer: ISSUER,
        merchant_order_ref: 'order-1001',
      })
      .expect(409);
    const page = await request(app.getHttpServer())
      .get(`/checkout/${created.body.intent.id as string}`)
      .expect(200);
    expect(page.text).toContain(created.body.intent.reference.memo as string);
    expect(page.text).toContain('Test SDF Network ; September 2015');
    const qr = await request(app.getHttpServer())
      .get(`/v1/checkout/${created.body.intent.id as string}/qr.png`)
      .expect(200);
    expect(qr.headers['content-type']).toContain('image/png');
  });

  it('credits an exact payment once, signs the webhook, and ignores a replay', async () => {
    const hook = await listen((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const merchant = await createMerchant(`http://127.0.0.1:${hook.port}/hook`);
    const intent = await createIntent(
      merchant.api_key,
      '10.0000000',
      'exact-payment-1',
    );
    observe(merchant.destination, intent, '10.0000000', '100', 'a'.repeat(64));
    await app.get(ObserverService).pollOnce();
    let viewed = await request(app.getHttpServer())
      .get(`/v1/intents/${intent.id}`)
      .set('authorization', `Bearer ${merchant.api_key}`)
      .expect(200);
    expect(viewed.body.status).toBe('CREDITED');
    await app.get(WebhookService).processDue();
    expect(hook.bodies).toHaveLength(1);
    const signature = String(hook.headers[0]);
    expect(
      verifyWebhookSignature({
        secret: WEBHOOK_SECRET,
        header: signature,
        body: hook.bodies[0],
        nowSeconds: Math.floor(clock.now().getTime() / 1000),
      }),
    ).toBe(true);
    const event = JSON.parse(hook.bodies[0]) as {
      type: string;
      provider: string;
    };
    expect(event.type).toBe('payment.credited');
    expect(event.provider).toBe('stellar');
    viewed = await request(app.getHttpServer())
      .get(`/v1/intents/${intent.id}`)
      .set('authorization', `Bearer ${merchant.api_key}`)
      .expect(200);
    expect(viewed.body.status).toBe('COMPLETED');
    await app.get(ObserverService).pollOnce();
    const ledger = await merchantLedger(merchant.api_key);
    expect(balance(ledger, 'merchant_available')).toBe('10.0000000');
    expect(balance(ledger, 'review_held')).toBeNull();
    const observations = await dataSource.query(
      'SELECT COUNT(*) AS count FROM stellar_observations',
    );
    expect(Number(observations[0].count)).toBe(1);
    hook.server.close();
  });

  it('holds partial, overpayment, wrong issuer, wrong memo, and late payments', async () => {
    const merchant = await createMerchant();
    const partial = await createIntent(
      merchant.api_key,
      '10.0000000',
      'partial-1',
    );
    observe(merchant.destination, partial, '4.0000000', '200', 'b'.repeat(64));
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, partial.id)).toBe('PARTIAL');
    expect(await available(merchant.api_key)).toBe('0.0000000');
    observe(merchant.destination, partial, '6.0000000', '201', 'c'.repeat(64));
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, partial.id)).toBe('COMPLETED');
    expect(await available(merchant.api_key)).toBe('10.0000000');

    const over = await createIntent(
      merchant.api_key,
      '10.0000000',
      'overpayment-1',
    );
    observe(merchant.destination, over, '12.0000000', '300', 'd'.repeat(64));
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, over.id)).toBe('OVERPAID');
    const recognized = await request(app.getHttpServer())
      .post(`/v1/admin/intents/${over.id}/recognize`)
      .set('x-admin-token', 'test-admin-token')
      .expect(201);
    expect(recognized.body.status).toBe('COMPLETED');
    expect(recognized.body.recognized_amount).toBe('10.0000000');
    const ledger = await merchantLedger(merchant.api_key);
    expect(balance(ledger, 'merchant_available')).toBe('20.0000000');
    expect(balance(ledger, 'review_held')).toBe('2.0000000');

    const wrong = await createIntent(
      merchant.api_key,
      '10.0000000',
      'wrong-asset',
    );
    observe(merchant.destination, wrong, '10.0000000', '400', 'e'.repeat(64), {
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, wrong.id)).toBe('AWAITING_PAYMENT');

    const memo = await createIntent(
      merchant.api_key,
      '10.0000000',
      'wrong-memo',
    );
    observe(merchant.destination, memo, '3.0000000', '500', 'f'.repeat(64), {
      memo: 'NOTTHEMEMO0000000000',
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, memo.id)).toBe('AWAITING_PAYMENT');
    expect(balance(await merchantLedger(merchant.api_key), 'suspense')).toBe(
      '3.0000000',
    );

    const late = await createIntent(
      merchant.api_key,
      '10.0000000',
      'late-payment-1',
    );
    observe(merchant.destination, late, '10.0000000', '600', '1'.repeat(64), {
      createdAt: '2026-06-02T00:00:00.000Z',
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, late.id)).toBe('HELD');
  });

  it('keeps a second operation on the same transaction from double-crediting', async () => {
    const merchant = await createMerchant();
    const intent = await createIntent(
      merchant.api_key,
      '10.0000000',
      'two-operations',
    );
    const hash = '9'.repeat(64);
    observe(merchant.destination, intent, '10.0000000', '700', hash);
    observe(merchant.destination, intent, '1.0000000', '701', hash);
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, intent.id)).toBe('COMPLETED');
    const ledger = await merchantLedger(merchant.api_key);
    expect(balance(ledger, 'merchant_available')).toBe('10.0000000');
    expect(balance(ledger, 'review_held')).toBe('1.0000000');
  });

  it('does not credit inconsistent, failed, or outgoing records', async () => {
    const merchant = await createMerchant();
    const intent = await createIntent(
      merchant.api_key,
      '10.0000000',
      'bad-evidence',
    );
    const payment = observe(
      merchant.destination,
      intent,
      '10.0000000',
      '800',
      '8'.repeat(64),
    );
    horizon.overrideOperation(payment.operationId, {
      ...payment,
      amount: '9.0000000',
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, intent.id)).toBe(
      'AWAITING_PAYMENT',
    );
    expect(await available(merchant.api_key)).toBe('0.0000000');

    observe(merchant.destination, intent, '10.0000000', '801', '7'.repeat(64), {
      transactionSuccessful: false,
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, intent.id)).toBe(
      'AWAITING_PAYMENT',
    );

    const outgoing = paymentRecord(
      merchant.destination,
      intent,
      '10.0000000',
      '802',
      '6'.repeat(64),
    );
    outgoing.to = payer;
    outgoing.from = merchant.destination;
    horizon.add(
      merchant.destination,
      outgoing,
      transactionFor(intent, '6'.repeat(64)),
    );
    await app.get(ObserverService).pollOnce();
    expect(await available(merchant.api_key)).toBe('0.0000000');
  });

  it('expires an unpaid intent and then holds a late arrival', async () => {
    const merchant = await createMerchant();
    const intent = await createIntent(
      merchant.api_key,
      '5.0000000',
      'expire-1',
      60,
    );
    clock.current = new Date('2026-06-01T00:02:00.000Z');
    const expired = await app.get(ExpiryService).expireDue();
    expect(expired).toBe(1);
    expect(await statusOf(merchant.api_key, intent.id)).toBe('EXPIRED');
    observe(merchant.destination, intent, '5.0000000', '900', '5'.repeat(64), {
      createdAt: '2026-06-01T00:03:00.000Z',
    });
    await app.get(ObserverService).pollOnce();
    expect(await statusOf(merchant.api_key, intent.id)).toBe('HELD');
    expect(await available(merchant.api_key)).toBe('0.0000000');
  });

  it('retries a webhook with bounded attempts and rejects non-allowlisted URLs', async () => {
    let failures = 0;
    const hook = await listen((_req, res) => {
      failures += 1;
      if (failures === 1) {
        res.writeHead(500);
        res.end('no');
        return;
      }
      res.writeHead(204);
      res.end();
    });
    const merchant = await createMerchant(`http://127.0.0.1:${hook.port}/hook`);
    const intent = await createIntent(
      merchant.api_key,
      '1.0000000',
      'retry-payment-1',
    );
    observe(merchant.destination, intent, '1.0000000', '910', '4'.repeat(64));
    await app.get(ObserverService).pollOnce();
    await app.get(WebhookService).processDue();
    expect(await statusOf(merchant.api_key, intent.id)).toBe('CREDITED');
    await app.get(WebhookService).processDue();
    expect(await statusOf(merchant.api_key, intent.id)).toBe('COMPLETED');
    hook.server.close();

    await request(app.getHttpServer())
      .post('/v1/merchants')
      .send({
        name: 'Blocked',
        stellar_destination: randomWatchOnlyPublicKey(),
        webhook_url: 'http://169.254.169.254/latest/meta-data',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/merchants')
      .send({
        name: 'Public',
        stellar_destination: randomWatchOnlyPublicKey(),
        webhook_url: 'https://merchant.example/hook',
      })
      .expect(400);
  });

  it('backfills idempotently and pauses settlement when the ledger drifts', async () => {
    const merchant = await createMerchant();
    const intent = await createIntent(
      merchant.api_key,
      '2.0000000',
      'recon-payment-1',
    );
    observe(merchant.destination, intent, '2.0000000', '920', '3'.repeat(64));
    const report = await app.get(ReconciliationService).backfill({
      accountId: merchant.destination,
      maxPages: 2,
      fromCursor: '',
    });
    expect(report.processed).toBe(1);
    expect(report.findings).toHaveLength(0);
    const again = await app.get(ReconciliationService).backfill({
      accountId: merchant.destination,
      maxPages: 2,
      fromCursor: '',
    });
    expect(again.processed).toBe(1);
    expect(await available(merchant.api_key)).toBe('2.0000000');
    await dataSource.query(
      `UPDATE ledger_balances SET balance = balance + 1
       WHERE account_id IN (SELECT id FROM ledger_accounts WHERE bucket = 'merchant_available')`,
    );
    const drifted = await app
      .get(ReconciliationService)
      .compareBooks(merchant.destination);
    expect(
      drifted.some((finding) => finding.code === 'LEDGER_RECOGNIZED_MISMATCH'),
    ).toBe(true);
    const me = await request(app.getHttpServer())
      .get('/v1/merchants/me')
      .set('authorization', `Bearer ${merchant.api_key}`)
      .expect(200);
    expect(me.body.settlement_paused).toBe(true);
  });

  it('records an external refund note without submitting a Stellar transaction', async () => {
    const merchant = await createMerchant();
    const intent = await createIntent(
      merchant.api_key,
      '8.0000000',
      'refund-note',
    );
    observe(merchant.destination, intent, '8.0000000', '930', '2'.repeat(64), {
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    await app.get(ObserverService).pollOnce();
    const reviews = await request(app.getHttpServer())
      .get('/v1/admin/reviews')
      .set('x-admin-token', 'test-admin-token')
      .expect(200);
    const reviewId = reviews.body.reviews[0].id as string;
    const recorded = await request(app.getHttpServer())
      .post(`/v1/admin/reviews/${reviewId}/external-refund`)
      .set('x-admin-token', 'test-admin-token')
      .send({
        note: 'Merchant sent the funds back from their own wallet',
        external_reference: 'bank-wire-42',
      })
      .expect(201);
    expect(recorded.body.resolution).toBe('EXTERNAL_REFUND_RECORDED');
    const audits = await dataSource.query(
      "SELECT metadata_json FROM audit_events WHERE action = 'review.external_refund_recorded'",
    );
    const metadata =
      typeof audits[0].metadata_json === 'string'
        ? JSON.parse(audits[0].metadata_json)
        : audits[0].metadata_json;
    expect(metadata.on_chain_verified).toBe(false);
    expect(metadata.chain_transaction_submitted).toBe(false);
  });

  it('withholds the wallet request when Horizon does not show a receivable account', async () => {
    const merchant = await createMerchant(undefined, { ready: false });
    const intent = await createIntent(
      merchant.api_key,
      '10.0000000',
      'unready-checkout',
    );
    const page = await request(app.getHttpServer())
      .get(`/checkout/${intent.id}`)
      .expect(200);
    expect(page.text).toContain('Payment request withheld');
    expect(page.text).not.toContain('web+stellar:pay');
    await request(app.getHttpServer())
      .get(`/v1/checkout/${intent.id}/qr.png`)
      .expect(409);
    const body = await request(app.getHttpServer())
      .get(`/v1/checkout/${intent.id}`)
      .expect(200);
    expect(body.body.sep7_uri).toBeNull();
    expect(body.body.receiving_account.ready).toBe(false);
    expect(body.body.receiving_account.code).toBe('account_missing');
  });

  it('encrypts the webhook secret and does not deliver when the key is wrong', async () => {
    const hook = await listen((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const merchant = await createMerchant(`http://127.0.0.1:${hook.port}/hook`);
    const stored = await dataSource.query(
      'SELECT webhook_secret_ciphertext FROM merchants WHERE id = ?',
      [merchant.id],
    );
    const ciphertext = String(stored[0].webhook_secret_ciphertext);
    expect(ciphertext.startsWith('v1.')).toBe(true);
    expect(ciphertext.includes(WEBHOOK_SECRET)).toBe(false);
    const audits = await dataSource.query(
      'SELECT metadata_json FROM audit_events WHERE entity_id = ?',
      [merchant.id],
    );
    expect(JSON.stringify(audits).includes(WEBHOOK_SECRET)).toBe(false);
    const wrong = encryptWebhookSecret(
      Buffer.alloc(32, 9),
      merchant.id,
      WEBHOOK_SECRET,
    );
    await dataSource.query(
      'UPDATE merchants SET webhook_secret_ciphertext = ? WHERE id = ?',
      [wrong, merchant.id],
    );
    const intent = await createIntent(
      merchant.api_key,
      '1.0000000',
      'wrong-key-payment',
    );
    observe(
      merchant.destination,
      intent,
      '1.0000000',
      '940',
      'a1'.padEnd(64, 'a'),
    );
    await app.get(ObserverService).pollOnce();
    await app.get(WebhookService).processDue();
    const deliveries = await dataSource.query(
      'SELECT status, last_error FROM webhook_deliveries WHERE merchant_id = ?',
      [merchant.id],
    );
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].last_error).toBe(
      'webhook signing secret could not be decrypted',
    );
    expect(String(deliveries[0].last_error).includes(WEBHOOK_SECRET)).toBe(
      false,
    );
    expect(hook.bodies).toHaveLength(0);
    hook.server.close();
  });

  async function createMerchant(
    webhookUrl?: string,
    options?: { ready?: boolean },
  ): Promise<{
    id: string;
    api_key: string;
    destination: string;
  }> {
    const response = await request(app.getHttpServer())
      .post('/v1/merchants')
      .send({
        name: 'Northwind',
        stellar_destination: randomWatchOnlyPublicKey(),
        webhook_url: webhookUrl,
        webhook_secret: webhookUrl ? WEBHOOK_SECRET : undefined,
      })
      .expect(201);
    const body = response.body as {
      id: string;
      api_key: string;
      stellar_destination: string;
    };
    expect(JSON.stringify(body).includes(WEBHOOK_SECRET)).toBe(false);
    if (options?.ready !== false) {
      horizon.markReady(body.stellar_destination);
    }
    return {
      id: body.id,
      api_key: body.api_key,
      destination: body.stellar_destination,
    };
  }

  async function createIntent(
    apiKey: string,
    amount: string,
    key: string,
    expiresInSeconds?: number,
  ): Promise<{ id: string; memo: string; destination: string }> {
    const response = await request(app.getHttpServer())
      .post('/v1/intents')
      .set('authorization', `Bearer ${apiKey}`)
      .set('idempotency-key', key)
      .send({
        amount,
        asset_code: 'USDC',
        asset_issuer: ISSUER,
        merchant_order_ref: key,
        expires_in_seconds: expiresInSeconds,
      });
    if (response.status !== 201) {
      throw new Error(`${response.status} ${JSON.stringify(response.body)}`);
    }
    return {
      id: response.body.intent.id as string,
      memo: response.body.intent.reference.memo as string,
      destination: response.body.intent.destination as string,
    };
  }

  function observe(
    destination: string,
    intent: { memo: string },
    amount: string,
    operationId: string,
    hash: string,
    overrides: Partial<NormalizedPayment> & { memo?: string } = {},
  ): NormalizedPayment {
    const { memo, ...paymentOverrides } = overrides;
    const payment = paymentRecord(
      destination,
      intent,
      amount,
      operationId,
      hash,
      paymentOverrides,
    );
    const transaction = transactionFor(intent, hash, memo, payment.createdAt);
    if (paymentOverrides.transactionSuccessful === false) {
      transaction.successful = false;
    }
    horizon.add(destination, payment, transaction);
    return payment;
  }

  async function statusOf(apiKey: string, id: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get(`/v1/intents/${id}`)
      .set('authorization', `Bearer ${apiKey}`)
      .expect(200);
    return response.body.status as string;
  }

  async function merchantLedger(apiKey: string): Promise<{
    accounts: Array<{ bucket: string; balance: string }>;
  }> {
    const response = await request(app.getHttpServer())
      .get('/v1/merchants/me/ledger')
      .set('authorization', `Bearer ${apiKey}`)
      .expect(200);
    return response.body as {
      accounts: Array<{ bucket: string; balance: string }>;
    };
  }

  async function available(apiKey: string): Promise<string> {
    return (
      balance(await merchantLedger(apiKey), 'merchant_available') ?? '0.0000000'
    );
  }
});

function balance(
  ledger: { accounts: Array<{ bucket: string; balance: string }> },
  bucket: string,
): string | null {
  const matches = ledger.accounts.filter(
    (account) => account.bucket === bucket,
  );
  if (matches.length === 0) return null;
  return matches
    .map((account) => account.balance)
    .sort()
    .join(',');
}

function paymentRecord(
  destination: string,
  intent: { memo: string },
  amount: string,
  operationId: string,
  hash: string,
  overrides: Partial<NormalizedPayment> = {},
): NormalizedPayment {
  return {
    operationId,
    pagingToken: operationId,
    type: 'payment',
    supported: true,
    transactionHash: hash,
    transactionSuccessful: true,
    createdAt: '2026-06-01T00:05:00.000Z',
    sourceAccount: 'GSOURCE',
    from: 'GSOURCE',
    to: destination,
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: ISSUER,
    amount,
    muxed: false,
    ...overrides,
  };
}

function transactionFor(
  intent: { memo: string },
  hash: string,
  memo = intent.memo,
  createdAt = '2026-06-01T00:05:00.000Z',
): NormalizedTransaction {
  return {
    hash,
    successful: true,
    createdAt,
    memoType: 'text',
    memo,
    sourceAccount: 'GSOURCE',
  };
}

async function listen(
  handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void,
): Promise<{
  server: Server;
  port: number;
  bodies: string[];
  headers: unknown[];
}> {
  const bodies: string[] = [];
  const headers: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      headers.push(req.headers['beekle-signature']);
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: (server.address() as AddressInfo).port,
    bodies,
    headers,
  };
}
