import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors';
import { loadConfig } from './config/app-config';
import { APP_CONFIG } from './config/app-config-token';
import { loadEnvFile } from './config/load-env-file';

loadEnvFile();

export function configureApp(app: INestApplication): void {
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(json({ limit: '32kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  const swagger = new DocumentBuilder()
    .setTitle('Beekle Stellar payments')
    .setDescription(
      'Watch-only Stellar checkout for a merchant self-custody account. ' +
        'Testnet by default. This service does not sign or submit customer payments.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Admin-Token' }, 'admin')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const config = app.get<ReturnType<typeof loadConfig>>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    `beekle-stellar-payments listening on :${config.port} network=${config.stellar.network} mainnet=${config.stellar.allowMainnet} signer=none webhook_key=${config.webhook.encryptionKeySource}`,
  );
}

if (require.main === module) {
  void bootstrap();
}
