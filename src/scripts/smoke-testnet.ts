import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { loadEnvFile } from '../config/load-env-file';
import { CIRCLE_USDC } from '../stellar/known-assets';
import { STELLAR_NETWORKS } from '../stellar/networks';
import { IntentService } from '../intents/intent.service';
import { MerchantService } from '../merchants/merchant.service';
import { ObserverService } from '../observer/observer.service';

loadEnvFile();
process.env.DB_HOST ??= '127.0.0.1';
process.env.DB_PORT ??= '3306';
process.env.DB_USER ??= 'beekle';
process.env.DB_PASSWORD ??= 'beekle_dev_only';
process.env.STELLAR_NETWORK = 'testnet';
process.env.STELLAR_ALLOW_MAINNET = 'false';
process.env.STELLAR_NETWORK_PASSPHRASE = STELLAR_NETWORKS.testnet.passphrase;
process.env.STELLAR_HORIZON_URL = STELLAR_NETWORKS.testnet.horizonUrl;
process.env.STELLAR_HORIZON_ALLOW_UNOFFICIAL = 'false';
process.env.DB_NAME = 'beekle_stellar_smoke';
process.env.ACCEPTED_ASSETS = `XLM:native,USDC:${CIRCLE_USDC.testnet.issuer}`;
process.env.OBSERVER_ENABLED = 'false';
process.env.WEBHOOK_WORKER_ENABLED = 'false';
process.env.EXPIRY_WORKER_ENABLED = 'false';
process.env.DEMO_OPEN_REGISTRATION = 'true';
process.env.NODE_ENV = 'development';
process.env.WEBHOOK_SECRETS_DEV_MODE = 'local';
delete process.env.WEBHOOK_ENCRYPTION_KEY;

const XLM_AMOUNT = '2.5000000';

function refuseSecrets(message: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret && message.includes(secret)) {
      throw new Error('refusing to print a Stellar secret');
    }
  }
  if (/S[A-Z2-7]{55}/.test(message)) {
    throw new Error('refusing to print a Stellar secret');
  }
}

async function main(): Promise<void> {
  const sdk = await import('@stellar/stellar-sdk');
  if (sdk.Networks.TESTNET !== STELLAR_NETWORKS.testnet.passphrase) {
    throw new Error(
      'SDK testnet passphrase does not match the pinned SDF passphrase',
    );
  }
  const server = new sdk.Horizon.Server(STELLAR_NETWORKS.testnet.horizonUrl);
  const root = await server.root();
  if (root.network_passphrase !== STELLAR_NETWORKS.testnet.passphrase) {
    throw new Error(
      `Horizon is not testnet (${root.network_passphrase}). Aborting.`,
    );
  }

  const destination = sdk.Keypair.random();
  const payer = sdk.Keypair.random();
  const secrets = [destination.secret(), payer.secret()];
  const log = (message: string) => {
    refuseSecrets(message, secrets);
    console.log(message);
  };

  log(`horizon testnet ledger ${root.history_latest_ledger}`);
  let issuerLoaded = false;
  try {
    await server.loadAccount(CIRCLE_USDC.testnet.issuer);
    issuerLoaded = true;
    log(`loaded Circle testnet USDC issuer ${CIRCLE_USDC.testnet.issuer}`);
  } catch (error) {
    log(
      `Circle testnet USDC issuer was not loaded: ${error instanceof Error ? error.message : 'error'}`,
    );
  }

  const fund = async (publicKey: string) => {
    const result = await server.friendbot(publicKey).call();
    log(`friendbot funded ${publicKey} tx ${result.hash ?? 'unknown'}`);
    return result.hash ?? null;
  };

  try {
    await fund(destination.publicKey());
    await fund(payer.publicKey());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'friendbot failed';
    refuseSecrets(message, secrets);
    log(`BLOCKER friendbot did not fund the smoke accounts: ${message}`);
    log('No Stellar observation was completed. No mainnet account was used.');
    process.exitCode = 2;
    return;
  }

  let trustlineHash: string | null = null;
  let trustlineError: string | null = null;
  try {
    const funded = await server.loadAccount(destination.publicKey());
    const usdc = new sdk.Asset('USDC', CIRCLE_USDC.testnet.issuer);
    const trust = new sdk.TransactionBuilder(funded, {
      fee: sdk.BASE_FEE,
      networkPassphrase: sdk.Networks.TESTNET,
    })
      .addOperation(sdk.Operation.changeTrust({ asset: usdc }))
      .setTimeout(90)
      .build();
    trust.sign(destination);
    const submitted = await server.submitTransaction(trust);
    trustlineHash = submitted.hash;
    log(`changeTrust USDC tx ${trustlineHash}`);
    log(`https://stellar.expert/explorer/testnet/tx/${trustlineHash}`);
  } catch (error) {
    trustlineError =
      error instanceof Error ? error.message : 'changeTrust failed';
    refuseSecrets(trustlineError, secrets);
    log(`changeTrust for Circle testnet USDC failed: ${trustlineError}`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const dataSource = app.get(DataSource);
    await dataSource.runMigrations();
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

    const merchants = app.get(MerchantService);
    const intents = app.get(IntentService);
    const observer = app.get(ObserverService);
    const created = await merchants.create({
      name: 'Smoke watch account',
      stellarDestination: destination.publicKey(),
      webhookUrl: null,
      openRegistration: true,
    });
    const intent = (
      await intents.create(created.merchant, {
        idempotencyKey: `smoke-${Date.now()}`,
        amount: XLM_AMOUNT,
        assetCode: 'XLM',
        assetIssuer: null,
        merchantOrderRef: 'smoke-xlm-not-usdc',
        expiresInSeconds: 1800,
      })
    ).intent;

    const payerAccount = await server.loadAccount(payer.publicKey());
    const payment = new sdk.TransactionBuilder(payerAccount, {
      fee: sdk.BASE_FEE,
      networkPassphrase: sdk.Networks.TESTNET,
    })
      .addOperation(
        sdk.Operation.payment({
          destination: destination.publicKey(),
          asset: sdk.Asset.native(),
          amount: XLM_AMOUNT,
        }),
      )
      .addMemo(sdk.Memo.text(intent.memo))
      .setTimeout(90)
      .build();
    payment.sign(payer);
    const submitted = await server.submitTransaction(payment);
    log(`native XLM payment tx ${submitted.hash}`);
    log(`https://stellar.expert/explorer/testnet/tx/${submitted.hash}`);
    log(
      'This payment is testnet XLM from Friendbot. It is not Circle USDC and it is not mainnet.',
    );

    let status = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await observer.pollOnce();
      const fresh = await intents.getPublic(intent.id);
      status = fresh.status;
      if (status === 'COMPLETED' || status === 'CREDITED') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const finalIntent = await intents.getPublic(intent.id);
    const observations = await dataSource.query(
      'SELECT COUNT(*) AS count FROM stellar_observations WHERE disposition = ?',
      ['exact'],
    );
    await observer.pollOnce();
    const afterReplay = await intents.getPublic(intent.id);
    const recognized = String(afterReplay.recognizedAmount);
    const summary = {
      network: 'testnet',
      horizon_passphrase_checked: true,
      circle_testnet_usdc_issuer: CIRCLE_USDC.testnet.issuer,
      circle_issuer_account_loaded: issuerLoaded,
      usdc_trustline_tx: trustlineHash,
      usdc_trustline_error: trustlineError,
      observed_asset: 'XLM',
      observed_amount: XLM_AMOUNT,
      xlm_payment_tx: submitted.hash,
      xlm_explorer: `https://stellar.expert/explorer/testnet/tx/${submitted.hash}`,
      intent_status: afterReplay.status,
      recognized_amount: recognized,
      exact_observations: Number(observations[0].count),
      replay_changed_recognized_amount:
        recognized !== String(finalIntent.recognizedAmount),
      secrets_printed: false,
      mainnet: false,
    };
    log(JSON.stringify(summary, null, 2));
    if (
      !issuerLoaded ||
      !trustlineHash ||
      afterReplay.status !== 'COMPLETED' ||
      recognized !== XLM_AMOUNT
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'smoke failed';
    if (/S[A-Z2-7]{55}/.test(message)) {
      console.error(
        'smoke failed and the error text looked like a seed, so it was not printed',
      );
    } else {
      console.error(message);
    }
    process.exitCode =
      process.exitCode && process.exitCode !== 0 ? process.exitCode : 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
