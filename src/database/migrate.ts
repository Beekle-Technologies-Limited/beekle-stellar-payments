import { loadConfig } from '../config/app-config';
import { loadEnvFile } from '../config/load-env-file';
import { createDataSource } from './typeorm-options';

loadEnvFile();

async function main(): Promise<void> {
  const dataSource = createDataSource(loadConfig());
  await dataSource.initialize();
  const applied = await dataSource.runMigrations();
  if (applied.length === 0) {
    console.log('no pending migrations');
  } else {
    for (const migration of applied) {
      console.log(`applied ${migration.name}`);
    }
  }
  await dataSource.destroy();
}

void main();
