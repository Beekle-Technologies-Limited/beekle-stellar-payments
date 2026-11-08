export type NormalizedPayment = {
  operationId: string;
  pagingToken: string;
  type: string;
  supported: boolean;
  transactionHash: string;
  transactionSuccessful: boolean;
  createdAt: string;
  sourceAccount: string;
  from: string | null;
  to: string | null;
  assetType: string | null;
  assetCode: string | null;
  assetIssuer: string | null;
  amount: string | null;
  muxed: boolean;
};

export type NormalizedTransaction = {
  hash: string;
  successful: boolean;
  createdAt: string;
  memoType: 'none' | 'text' | 'id' | 'hash' | 'return';
  memo: string | null;
  sourceAccount: string;
};

export type HorizonRoot = {
  networkPassphrase: string;
  horizonVersion: string;
  historyLatestLedger: number;
};

export type AccountAssetReadiness = {
  exists: boolean;
  nativeBalance: string | null;
  trustline: boolean;
  authorized: boolean;
};

export interface HorizonClient {
  getRoot(): Promise<HorizonRoot>;
  latestPaymentCursor(accountId: string): Promise<string | null>;
  listPayments(
    accountId: string,
    afterCursor: string | null,
    limit: number,
  ): Promise<NormalizedPayment[]>;
  getTransaction(hash: string): Promise<NormalizedTransaction>;
  getOperation(operationId: string): Promise<NormalizedPayment>;
  getAccountReadiness(
    accountId: string,
    asset: { code: string; issuer: string | null },
  ): Promise<AccountAssetReadiness>;
}

const RECEIVED_PAYMENT_TYPES = new Set([
  'payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

type HorizonOperationFields = {
  id: string | number;
  paging_token: string | number;
  type: string;
  transaction_hash?: string;
  transaction_successful?: boolean;
  created_at?: string;
  source_account?: string;
  from?: string;
  to?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  to_muxed?: string;
  to_muxed_id?: string | number;
};

/**
 * Horizon's `amount` on payment and both path-payment operation types is the
 * amount of the destination asset that `to` received. Source amounts are
 * separate fields and are intentionally ignored.
 * https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/operations/object/path-payment-strict-send
 */
export function mapHorizonOperation(
  record: HorizonOperationFields,
): NormalizedPayment {
  const supported = RECEIVED_PAYMENT_TYPES.has(record.type);
  const native = record.asset_type === 'native';
  return {
    operationId: String(record.id),
    pagingToken: String(record.paging_token),
    type: record.type,
    supported,
    transactionHash: record.transaction_hash ?? '',
    transactionSuccessful: record.transaction_successful === true,
    createdAt: record.created_at ?? '',
    sourceAccount: record.source_account ?? '',
    from: supported ? (record.from ?? null) : null,
    to: supported ? (record.to ?? null) : null,
    assetType: supported ? (record.asset_type ?? null) : null,
    assetCode: supported
      ? native
        ? 'XLM'
        : (record.asset_code ?? null)
      : null,
    assetIssuer: supported
      ? native
        ? null
        : (record.asset_issuer ?? null)
      : null,
    amount: supported ? (record.amount ?? null) : null,
    muxed: supported ? Boolean(record.to_muxed || record.to_muxed_id) : false,
  };
}

export function memoTypeToIntent(
  memoType: NormalizedTransaction['memoType'],
): 'MEMO_TEXT' | 'MEMO_ID' | null {
  if (memoType === 'text') return 'MEMO_TEXT';
  if (memoType === 'id') return 'MEMO_ID';
  return null;
}

export function samePaymentEvidence(
  listed: NormalizedPayment,
  operation: NormalizedPayment,
  transaction: NormalizedTransaction,
): boolean {
  if (!listed.supported || !operation.supported) return false;
  return (
    listed.operationId === operation.operationId &&
    listed.transactionHash === operation.transactionHash &&
    listed.transactionHash === transaction.hash &&
    listed.to === operation.to &&
    listed.from === operation.from &&
    listed.amount === operation.amount &&
    listed.assetCode === operation.assetCode &&
    listed.assetIssuer === operation.assetIssuer &&
    listed.assetType === operation.assetType &&
    listed.type === operation.type &&
    listed.transactionSuccessful === operation.transactionSuccessful &&
    listed.transactionSuccessful === transaction.successful
  );
}
