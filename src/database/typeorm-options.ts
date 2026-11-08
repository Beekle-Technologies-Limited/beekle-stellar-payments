import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import { ENTITIES } from './entities';
import { EncryptWebhookSecrets1735690000000 } from './migrations/1735690000000-EncryptWebhookSecrets';
import { InitialSchema1735689600000 } from './migrations/1735689600000-InitialSchema';

export function dataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'mysql',
    host: config.db.host,
    port: config.db.port,
    username: config.db.user,
    password: config.db.password,
    database: config.db.name,
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: ENTITIES,
    migrations: [
      InitialSchema1735689600000,
      EncryptWebhookSecrets1735690000000,
    ],
    synchronize: false,
    logging: false,
    extra: {
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
  };
}

export function nestTypeOrmOptions(config: AppConfig): TypeOrmModuleOptions {
  return dataSourceOptions(config);
}

export function createDataSource(config: AppConfig): DataSource {
  return new DataSource(dataSourceOptions(config));
}
