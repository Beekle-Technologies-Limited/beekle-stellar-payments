import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1735689600000 implements MigrationInterface {
  name = 'InitialSchema1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE merchants (
        id CHAR(36) NOT NULL,
        name VARCHAR(120) NOT NULL,
        api_key_hash CHAR(64) NOT NULL,
        api_key_prefix VARCHAR(24) NOT NULL,
        stellar_destination CHAR(56) NOT NULL,
        webhook_url VARCHAR(500) NULL,
        webhook_secret_ciphertext VARCHAR(512) NULL,
        settlement_paused TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_merchants_api_key_hash (api_key_hash),
        UNIQUE KEY uq_merchants_destination (stellar_destination)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE payment_intents (
        id CHAR(36) NOT NULL,
        merchant_id CHAR(36) NOT NULL,
        idempotency_key VARCHAR(128) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        merchant_order_ref VARCHAR(128) NULL,
        provider VARCHAR(16) NOT NULL DEFAULT 'stellar',
        network VARCHAR(16) NOT NULL,
        amount DECIMAL(20,7) NOT NULL,
        received_amount DECIMAL(20,7) NOT NULL DEFAULT 0,
        recognized_amount DECIMAL(20,7) NOT NULL DEFAULT 0,
        asset_code VARCHAR(12) NOT NULL,
        asset_issuer CHAR(56) NULL,
        destination CHAR(56) NOT NULL,
        memo VARCHAR(28) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        memo_type VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        provider_reference CHAR(64) NULL,
        credited_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_intent_idempotency (merchant_id, idempotency_key),
        UNIQUE KEY uq_intent_memo (network, destination, memo_type, memo),
        KEY ix_intent_status_expiry (status, expires_at),
        CONSTRAINT fk_intent_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE observer_cursors (
        network VARCHAR(16) NOT NULL,
        account_id CHAR(56) NOT NULL,
        cursor_token VARCHAR(64) NOT NULL DEFAULT '',
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (network, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE stellar_observations (
        id BIGINT NOT NULL AUTO_INCREMENT,
        network VARCHAR(16) NOT NULL,
        operation_id VARCHAR(64) NOT NULL,
        paging_token VARCHAR(64) NOT NULL,
        transaction_hash CHAR(64) NOT NULL,
        operation_type VARCHAR(40) NOT NULL,
        source_account VARCHAR(56) NOT NULL,
        destination_account VARCHAR(56) NOT NULL,
        asset_code VARCHAR(12) NULL,
        asset_issuer CHAR(56) NULL,
        amount DECIMAL(20,7) NULL,
        memo VARCHAR(128) NULL,
        memo_type VARCHAR(16) NULL,
        transaction_successful TINYINT(1) NOT NULL,
        ledger_closed_at DATETIME(3) NOT NULL,
        intent_id CHAR(36) NULL,
        merchant_id CHAR(36) NOT NULL,
        disposition VARCHAR(40) NOT NULL,
        raw_json JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_observation_operation (network, operation_id),
        KEY ix_observation_intent (intent_id),
        KEY ix_observation_tx (transaction_hash),
        CONSTRAINT fk_observation_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id),
        CONSTRAINT fk_observation_intent FOREIGN KEY (intent_id) REFERENCES payment_intents (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE ledger_accounts (
        id CHAR(36) NOT NULL,
        code VARCHAR(220) NOT NULL,
        merchant_id CHAR(36) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        bucket VARCHAR(32) NOT NULL,
        network VARCHAR(16) NOT NULL,
        asset_code VARCHAR(12) NOT NULL,
        asset_issuer CHAR(56) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_ledger_account_code (code),
        CONSTRAINT fk_ledger_account_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE ledger_balances (
        account_id CHAR(36) NOT NULL,
        balance DECIMAL(20,7) NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (account_id),
        CONSTRAINT fk_ledger_balance_account FOREIGN KEY (account_id) REFERENCES ledger_accounts (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE ledger_entries (
        id BIGINT NOT NULL AUTO_INCREMENT,
        journal_id CHAR(36) NOT NULL,
        account_id CHAR(36) NOT NULL,
        direction CHAR(2) NOT NULL,
        amount DECIMAL(20,7) NOT NULL,
        intent_id CHAR(36) NULL,
        observation_id BIGINT NULL,
        description VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_ledger_entry_journal (journal_id),
        KEY ix_ledger_entry_intent (intent_id),
        CONSTRAINT fk_ledger_entry_account FOREIGN KEY (account_id) REFERENCES ledger_accounts (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE review_cases (
        id CHAR(36) NOT NULL,
        merchant_id CHAR(36) NOT NULL,
        intent_id CHAR(36) NULL,
        observation_id BIGINT NOT NULL,
        reason VARCHAR(40) NOT NULL,
        status VARCHAR(16) NOT NULL,
        resolution VARCHAR(40) NULL,
        note VARCHAR(500) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        resolved_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_review_observation_reason (observation_id, reason),
        KEY ix_review_intent (intent_id),
        CONSTRAINT fk_review_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id),
        CONSTRAINT fk_review_observation FOREIGN KEY (observation_id) REFERENCES stellar_observations (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE webhook_deliveries (
        id CHAR(36) NOT NULL,
        event_id CHAR(36) NOT NULL,
        dedupe_key VARCHAR(160) NOT NULL,
        merchant_id CHAR(36) NOT NULL,
        intent_id CHAR(36) NULL,
        event_type VARCHAR(64) NOT NULL,
        payload_body MEDIUMTEXT NOT NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL,
        next_attempt_at DATETIME(3) NOT NULL,
        status VARCHAR(16) NOT NULL,
        last_status_code INT NULL,
        last_error VARCHAR(500) NULL,
        delivered_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_webhook_event (event_id),
        UNIQUE KEY uq_webhook_dedupe (dedupe_key),
        KEY ix_webhook_due (status, next_attempt_at),
        CONSTRAINT fk_webhook_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE audit_events (
        id BIGINT NOT NULL AUTO_INCREMENT,
        actor_type VARCHAR(16) NOT NULL,
        actor_id VARCHAR(64) NULL,
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(32) NOT NULL,
        entity_id VARCHAR(64) NOT NULL,
        from_status VARCHAR(32) NULL,
        to_status VARCHAR(32) NULL,
        metadata_json JSON NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_audit_entity (entity_type, entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE reconciliation_findings (
        id CHAR(36) NOT NULL,
        merchant_id CHAR(36) NULL,
        network VARCHAR(16) NOT NULL,
        account_id CHAR(56) NOT NULL,
        severity VARCHAR(16) NOT NULL,
        code VARCHAR(64) NOT NULL,
        detail VARCHAR(1000) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_findings');
    await queryRunner.query('DROP TABLE IF EXISTS audit_events');
    await queryRunner.query('DROP TABLE IF EXISTS webhook_deliveries');
    await queryRunner.query('DROP TABLE IF EXISTS review_cases');
    await queryRunner.query('DROP TABLE IF EXISTS ledger_entries');
    await queryRunner.query('DROP TABLE IF EXISTS ledger_balances');
    await queryRunner.query('DROP TABLE IF EXISTS ledger_accounts');
    await queryRunner.query('DROP TABLE IF EXISTS stellar_observations');
    await queryRunner.query('DROP TABLE IF EXISTS observer_cursors');
    await queryRunner.query('DROP TABLE IF EXISTS payment_intents');
    await queryRunner.query('DROP TABLE IF EXISTS merchants');
  }
}
