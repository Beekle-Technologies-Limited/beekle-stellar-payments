import {
  addAmounts,
  compareAmounts,
  formatStellarAmount,
} from '../common/money';
import {
  memoTypeToIntent,
  samePaymentEvidence,
} from '../stellar/horizon-types';
import type {
  NormalizedPayment,
  NormalizedTransaction,
} from '../stellar/horizon-types';

export type IntentSnapshot = {
  id: string;
  status: string;
  amount: string;
  receivedAmount: string;
  recognizedAmount: string;
  assetCode: string;
  assetIssuer: string | null;
  destination: string;
  memo: string;
  memoType: string;
  expiresAt: Date;
};

export type PaymentClass =
  | { kind: 'ignored_operation' }
  | { kind: 'inconsistent' }
  | { kind: 'failed' }
  | { kind: 'outgoing' }
  | { kind: 'muxed'; intentId: string | null }
  | { kind: 'unmatched' }
  | { kind: 'wrong_asset'; intentId: string }
  | { kind: 'late'; intentId: string; receivedAfter: string }
  | {
      kind: 'partial';
      intentId: string;
      receivedAfter: string;
    }
  | {
      kind: 'overpaid';
      intentId: string;
      receivedAfter: string;
    }
  | {
      kind: 'exact';
      intentId: string;
      receivedAfter: string;
      completesFromPartial: boolean;
    }
  | {
      kind: 'excess_after_credit';
      intentId: string;
      receivedAfter: string;
    };

const TERMINAL_CREDIT = new Set(['CREDITED', 'COMPLETED']);

export function classifyPayment(input: {
  watchedAccountId: string;
  listed: NormalizedPayment;
  operation: NormalizedPayment;
  transaction: NormalizedTransaction;
  intent: IntentSnapshot | null;
}): PaymentClass {
  const payment = input.operation;
  if (!payment.supported || !input.listed.supported) {
    return { kind: 'ignored_operation' };
  }
  if (!samePaymentEvidence(input.listed, payment, input.transaction)) {
    return { kind: 'inconsistent' };
  }
  if (!payment.transactionSuccessful || !input.transaction.successful) {
    return { kind: 'failed' };
  }
  if (!payment.to || !payment.amount || !payment.assetCode) {
    return { kind: 'inconsistent' };
  }
  try {
    formatStellarAmount(payment.amount);
  } catch {
    return { kind: 'inconsistent' };
  }
  if (payment.to !== input.watchedAccountId) {
    return { kind: 'outgoing' };
  }
  const intentMemoType = memoTypeToIntent(input.transaction.memoType);
  const intent =
    input.intent &&
    intentMemoType &&
    input.transaction.memo &&
    input.intent.memo === input.transaction.memo &&
    input.intent.memoType === intentMemoType &&
    input.intent.destination === input.watchedAccountId
      ? input.intent
      : null;
  if (payment.muxed) {
    return { kind: 'muxed', intentId: intent?.id ?? null };
  }
  if (!intent) {
    return { kind: 'unmatched' };
  }
  const assetMatches =
    intent.assetCode === payment.assetCode &&
    intent.assetIssuer === payment.assetIssuer;
  if (!assetMatches) {
    return { kind: 'wrong_asset', intentId: intent.id };
  }
  const receivedAfter = formatStellarAmount(
    addAmounts(formatStellarAmount(intent.receivedAmount), payment.amount),
  );
  if (TERMINAL_CREDIT.has(intent.status)) {
    return {
      kind: 'excess_after_credit',
      intentId: intent.id,
      receivedAfter,
    };
  }
  const closedAt = new Date(payment.createdAt);
  const late =
    intent.status === 'EXPIRED' ||
    intent.status === 'HELD' ||
    closedAt.getTime() >= intent.expiresAt.getTime();
  if (late) {
    return { kind: 'late', intentId: intent.id, receivedAfter };
  }
  const compared = compareAmounts(
    receivedAfter,
    formatStellarAmount(intent.amount),
  );
  if (compared === 0) {
    return {
      kind: 'exact',
      intentId: intent.id,
      receivedAfter,
      completesFromPartial:
        compareAmounts(intent.receivedAmount, '0.0000000') > 0,
    };
  }
  if (compared < 0) {
    return { kind: 'partial', intentId: intent.id, receivedAfter };
  }
  return { kind: 'overpaid', intentId: intent.id, receivedAfter };
}
