import { mkdirSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { loadEnvFile } from '../config/load-env-file';

loadEnvFile();
process.env.DB_HOST ??= '127.0.0.1';
process.env.DB_PORT ??= '3306';
process.env.DB_USER ??= 'beekle';
process.env.DB_PASSWORD ??= 'beekle_dev_only';
process.env.DB_NAME ??= 'beekle_stellar';
process.env.STELLAR_NETWORK ??= 'testnet';
process.env.OBSERVER_ENABLED ??= 'false';
process.env.WEBHOOK_WORKER_ENABLED ??= 'false';
process.env.EXPIRY_WORKER_ENABLED ??= 'false';
process.env.DEMO_OPEN_REGISTRATION ??= 'true';
process.env.WEBHOOK_SECRETS_DEV_MODE ??= 'local';
process.env.ADMIN_TOKEN ??= 'replace-with-a-long-random-token';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error'],
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Beekle Stellar payments')
      .setDescription(
        'Watch-only Stellar checkout. Testnet by default. Customer wallets sign. ' +
          'This service does not submit customer payments or store Stellar seeds.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-Admin-Token' },
        'admin',
      )
      .build(),
  );
  mkdirSync('openapi', { recursive: true });
  writeFileSync(
    'openapi/openapi.json',
    `${JSON.stringify(document, null, 2)}\n`,
  );
  await app.close();
  console.log('wrote openapi/openapi.json');
}

void main();
