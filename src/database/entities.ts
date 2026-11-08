import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'merchants' })
export class Merchant {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'api_key_hash', type: 'char', length: 64 })
  apiKeyHash!: string;

  @Column({ name: 'api_key_prefix', type: 'varchar', length: 24 })
  apiKeyPrefix!: string;

  @Column({ name: 'stellar_destination', type: 'char', length: 56 })
  stellarDestination!: string;

  @Column({ name: 'webhook_url', type: 'varchar', length: 500, nullable: true })
  webhookUrl!: string | null;

  @Column({
    name: 'webhook_secret_ciphertext',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  webhookSecretCiphertext!: string | null;

  @Column({ name: 'settlement_paused', type: 'boolean', default: false })
  settlementPaused!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity({ name: 'payment_intents' })
export class PaymentIntent {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'merchant_id', type: 'char', length: 36 })
  merchantId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({
    name: 'merchant_order_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  merchantOrderRef!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'stellar' })
  provider!: string;

  @Column({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount!: string;

  @Column({
    name: 'received_amount',
    type: 'decimal',
    precision: 20,
    scale: 7,
    default: '0.0000000',
  })
  receivedAmount!: string;

  @Column({
    name: 'recognized_amount',
    type: 'decimal',
    precision: 20,
    scale: 7,
    default: '0.0000000',
  })
  recognizedAmount!: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 12 })
  assetCode!: string;

  @Column({ name: 'asset_issuer', type: 'char', length: 56, nullable: true })
  assetIssuer!: string | null;

  @Column({ type: 'char', length: 56 })
  destination!: string;

  @Column({ type: 'varchar', length: 28, collation: 'utf8mb4_bin' })
  memo!: string;

  @Column({ name: 'memo_type', type: 'varchar', length: 16 })
  memoType!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'expires_at', type: 'datetime', precision: 3 })
  expiresAt!: Date;

  @Column({
    name: 'provider_reference',
    type: 'char',
    length: 64,
    nullable: true,
  })
  providerReference!: string | null;

  @Column({
    name: 'credited_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  creditedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity({ name: 'observer_cursors' })
export class ObserverCursor {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  network!: string;

  @PrimaryColumn({ name: 'account_id', type: 'char', length: 56 })
  accountId!: string;

  @Column({ name: 'cursor_token', type: 'varchar', length: 64, default: '' })
  cursorToken!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity({ name: 'stellar_observations' })
export class StellarObservation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ name: 'operation_id', type: 'varchar', length: 64 })
  operationId!: string;

  @Column({ name: 'paging_token', type: 'varchar', length: 64 })
  pagingToken!: string;

  @Column({ name: 'transaction_hash', type: 'char', length: 64 })
  transactionHash!: string;

  @Column({ name: 'operation_type', type: 'varchar', length: 40 })
  operationType!: string;

  @Column({ name: 'source_account', type: 'varchar', length: 56 })
  sourceAccount!: string;

  @Column({ name: 'destination_account', type: 'varchar', length: 56 })
  destinationAccount!: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 12, nullable: true })
  assetCode!: string | null;

  @Column({ name: 'asset_issuer', type: 'char', length: 56, nullable: true })
  assetIssuer!: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7, nullable: true })
  amount!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  memo!: string | null;

  @Column({ name: 'memo_type', type: 'varchar', length: 16, nullable: true })
  memoType!: string | null;

  @Column({ name: 'transaction_successful', type: 'boolean' })
  transactionSuccessful!: boolean;

  @Column({ name: 'ledger_closed_at', type: 'datetime', precision: 3 })
  ledgerClosedAt!: Date;

  @Column({ name: 'intent_id', type: 'char', length: 36, nullable: true })
  intentId!: string | null;

  @Column({ name: 'merchant_id', type: 'char', length: 36 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 40 })
  disposition!: string;

  @Column({ name: 'raw_json', type: 'json' })
  rawJson!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'ledger_accounts' })
export class LedgerAccount {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 220 })
  code!: string;

  @Column({ name: 'merchant_id', type: 'char', length: 36 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  @Column({ type: 'varchar', length: 32 })
  bucket!: string;

  @Column({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 12 })
  assetCode!: string;

  @Column({ name: 'asset_issuer', type: 'char', length: 56, nullable: true })
  assetIssuer!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'ledger_balances' })
export class LedgerBalance {
  @PrimaryColumn({ name: 'account_id', type: 'char', length: 36 })
  accountId!: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  balance!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity({ name: 'ledger_entries' })
export class LedgerEntry {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'journal_id', type: 'char', length: 36 })
  journalId!: string;

  @Column({ name: 'account_id', type: 'char', length: 36 })
  accountId!: string;

  @Column({ type: 'char', length: 2 })
  direction!: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount!: string;

  @Column({ name: 'intent_id', type: 'char', length: 36, nullable: true })
  intentId!: string | null;

  @Column({ name: 'observation_id', type: 'bigint', nullable: true })
  observationId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'review_cases' })
export class ReviewCase {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'merchant_id', type: 'char', length: 36 })
  merchantId!: string;

  @Column({ name: 'intent_id', type: 'char', length: 36, nullable: true })
  intentId!: string | null;

  @Column({ name: 'observation_id', type: 'bigint' })
  observationId!: string;

  @Column({ type: 'varchar', length: 40 })
  reason!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  resolution!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({
    name: 'resolved_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  resolvedAt!: Date | null;
}

@Entity({ name: 'webhook_deliveries' })
export class WebhookDelivery {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'event_id', type: 'char', length: 36 })
  eventId!: string;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 160 })
  dedupeKey!: string;

  @Column({ name: 'merchant_id', type: 'char', length: 36 })
  merchantId!: string;

  @Column({ name: 'intent_id', type: 'char', length: 36, nullable: true })
  intentId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ name: 'payload_body', type: 'mediumtext' })
  payloadBody!: string;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'int' })
  maxAttempts!: number;

  @Column({ name: 'next_attempt_at', type: 'datetime', precision: 3 })
  nextAttemptAt!: Date;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ name: 'last_status_code', type: 'int', nullable: true })
  lastStatusCode!: number | null;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError!: string | null;

  @Column({
    name: 'delivered_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  deliveredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}

@Entity({ name: 'audit_events' })
export class AuditEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 32 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 64 })
  entityId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 32, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 32, nullable: true })
  toStatus!: string | null;

  @Column({ name: 'metadata_json', type: 'json', nullable: true })
  metadataJson!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'reconciliation_findings' })
export class ReconciliationFinding {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'merchant_id', type: 'char', length: 36, nullable: true })
  merchantId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ name: 'account_id', type: 'char', length: 56 })
  accountId!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 1000 })
  detail!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'demo_receivers' })
export class DemoReceiver {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ name: 'account_id', type: 'char', length: 56 })
  accountId!: string;

  @Column({ name: 'asset_code', type: 'varchar', length: 12 })
  assetCode!: string;

  @Column({ name: 'asset_issuer', type: 'char', length: 56, nullable: true })
  assetIssuer!: string | null;

  @Column({ type: 'varchar', length: 32 })
  mode!: string;

  @Column({ name: 'friendbot_tx', type: 'char', length: 64, nullable: true })
  friendbotTx!: string | null;

  @Column({ name: 'trustline_tx', type: 'char', length: 64, nullable: true })
  trustlineTx!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

export const ENTITIES = [
  Merchant,
  PaymentIntent,
  ObserverCursor,
  StellarObservation,
  LedgerAccount,
  LedgerBalance,
  LedgerEntry,
  ReviewCase,
  WebhookDelivery,
  AuditEvent,
  ReconciliationFinding,
  DemoReceiver,
];
