import { MigrationInterface, QueryRunner } from 'typeorm';

export class EncryptWebhookSecrets1735690000000 implements MigrationInterface {
  name = 'EncryptWebhookSecrets1735690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // QueryRunner.query is typed as any in this TypeORM version.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const columns: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchants'
         AND COLUMN_NAME IN ('webhook_secret', 'webhook_secret_ciphertext')`,
    );
    const names = new Set(columns.map((column) => column.COLUMN_NAME));
    if (names.has('webhook_secret')) {
      await queryRunner.query(
        'ALTER TABLE merchants MODIFY webhook_secret VARCHAR(512) NULL',
      );
      await queryRunner.query(
        `UPDATE merchants SET webhook_secret = NULL
         WHERE webhook_secret IS NOT NULL AND webhook_secret NOT LIKE 'v1.%'`,
      );
      await queryRunner.query(
        'ALTER TABLE merchants CHANGE webhook_secret webhook_secret_ciphertext VARCHAR(512) NULL',
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const tables: Array<{ TABLE_NAME: string }> = await queryRunner.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_receivers'`,
    );
    if (tables.length === 0) {
      await queryRunner.query(`
        CREATE TABLE demo_receivers (
          network VARCHAR(16) NOT NULL,
          account_id CHAR(56) NOT NULL,
          asset_code VARCHAR(12) NOT NULL,
          asset_issuer CHAR(56) NULL,
          mode VARCHAR(32) NOT NULL,
          friendbot_tx CHAR(64) NULL,
          trustline_tx CHAR(64) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (network)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS demo_receivers');
  }
}
