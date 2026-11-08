import { stroops } from '../common/money';
import { classifyPayment } from './classify-payment';
import type { IntentSnapshot } from './classify-payment';
import { planLedger } from './plan-ledger';
import type { JournalPlan } from './plan-ledger';
import type {
  NormalizedPayment,
  NormalizedTransaction,
} from '../stellar/horizon-types';

const dest = 'GDEST';
const issuer = 'GISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUE';

function intent(overrides: Partial<IntentSnapshot> = {}): IntentSnapshot {
  return {
    id: 'intent-1',
    status: 'AWAITING_PAYMENT',
    amount: '10.0000000',
    receivedAmount: '0.0000000',
    recognizedAmount: '0.0000000',
    assetCode: 'USDC',
    assetIssuer: issuer,
    destination: dest,
    memo: 'MEMO1234',
    memoType: 'MEMO_TEXT',
    expiresAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function payment(
  amount: string,
  overrides: Partial<NormalizedPayment> = {},
): NormalizedPayment {
  return {
    operationId: '55',
    pagingToken: '55',
    type: 'payment',
    supported: true,
    transactionHash: 'd'.repeat(64),
    transactionSuccessful: true,
    createdAt: '2026-01-01T00:00:00Z',
    sourceAccount: 'GSOURCE',
    from: 'GSOURCE',
    to: dest,
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: issuer,
    amount,
    muxed: false,
    ...overrides,
  };
}

function tx(
  overrides: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  return {
    hash: 'd'.repeat(64),
    successful: true,
    createdAt: '2026-01-01T00:00:00Z',
    memoType: 'text',
    memo: 'MEMO1234',
    sourceAccount: 'GSOURCE',
    ...overrides,
  };
}

function nets(journals: JournalPlan[]): Record<string, bigint> {
  const totals: Record<string, bigint> = {};
  for (const journal of journals) {
    let debit = 0n;
    let credit = 0n;
    for (const line of journal.lines) {
      const value = stroops(line.amount);
      if (line.direction === 'DR') debit += value;
      else credit += value;
      const sign = bucketSign(line.bucket, line.direction);
      totals[line.bucket] = (totals[line.bucket] ?? 0n) + sign * value;
    }
    expect(debit).toBe(credit);
  }
  return totals;
}

function bucketSign(bucket: string, direction: 'DR' | 'CR'): bigint {
  const asset = bucket === 'stellar_observed';
  if (asset) return direction === 'DR' ? 1n : -1n;
  return direction === 'CR' ? 1n : -1n;
}

describe('payment classification and ledger plan', () => {
  it('recognizes an exact USDC payment through pending then available', () => {
    const listed = payment('10.0000000');
    const classification = classifyPayment({
      watchedAccountId: dest,
      listed,
      operation: listed,
      transaction: tx(),
      intent: intent(),
    });
    expect(classification.kind).toBe('exact');
    const plan = planLedger({
      classification,
      paymentAmount: '10.0000000',
      invoiceAmount: '10.0000000',
      recognizedAmount: '0.0000000',
      transactionHash: listed.transactionHash,
    });
    expect(plan.nextStatus).toBe('CREDITED');
    expect(plan.eventType).toBe('payment.credited');
    const total = nets(plan.journals);
    expect(total.stellar_observed).toBe(stroops('10.0000000'));
    expect(total.merchant_available).toBe(stroops('10.0000000'));
    expect(total.merchant_pending ?? 0n).toBe(0n);
    expect(total.review_held ?? 0n).toBe(0n);
  });

  it('holds an underpayment and does not recognize it', () => {
    const listed = payment('4.0000000');
    const classification = classifyPayment({
      watchedAccountId: dest,
      listed,
      operation: listed,
      transaction: tx(),
      intent: intent(),
    });
    const plan = planLedger({
      classification,
      paymentAmount: '4.0000000',
      invoiceAmount: '10.0000000',
      recognizedAmount: '0.0000000',
      transactionHash: listed.transactionHash,
    });
    expect(plan.nextStatus).toBe('PARTIAL');
    const total = nets(plan.journals);
    expect(total.merchant_available ?? 0n).toBe(0n);
    expect(total.review_held).toBe(stroops('4.0000000'));
  });

  it('moves a completing partial from review into available for the invoice only', () => {
    const listed = payment('6.0000000');
    const classification = classifyPayment({
      watchedAccountId: dest,
      listed,
      operation: listed,
      transaction: tx(),
      intent: intent({ status: 'PARTIAL', receivedAmount: '4.0000000' }),
    });
    expect(classification).toMatchObject({
      kind: 'exact',
      completesFromPartial: true,
    });
    const plan = planLedger({
      classification,
      paymentAmount: '6.0000000',
      invoiceAmount: '10.0000000',
      recognizedAmount: '0.0000000',
      transactionHash: listed.transactionHash,
    });
    const total = nets(plan.journals);
    expect(total.merchant_available).toBe(stroops('10.0000000'));
    expect(total.review_held).toBe(-stroops('4.0000000'));
    expect(plan.recognizedAmount).toBe('10.0000000');
  });

  it('holds an overpayment, a late payment, and a wrong issuer without crediting', () => {
    const over = classifyPayment({
      watchedAccountId: dest,
      listed: payment('12.0000000'),
      operation: payment('12.0000000'),
      transaction: tx(),
      intent: intent(),
    });
    expect(over.kind).toBe('overpaid');
    const late = classifyPayment({
      watchedAccountId: dest,
      listed: payment('10.0000000', { createdAt: '2026-01-03T00:00:00Z' }),
      operation: payment('10.0000000', { createdAt: '2026-01-03T00:00:00Z' }),
      transaction: tx(),
      intent: intent(),
    });
    expect(late.kind).toBe('late');
    const wrong = classifyPayment({
      watchedAccountId: dest,
      listed: payment('10.0000000', { assetIssuer: 'GOTHER' }),
      operation: payment('10.0000000', { assetIssuer: 'GOTHER' }),
      transaction: tx(),
      intent: intent(),
    });
    expect(wrong.kind).toBe('wrong_asset');
    for (const item of [over, late, wrong]) {
      const plan = planLedger({
        classification: item,
        paymentAmount: '10.0000000',
        invoiceAmount: '10.0000000',
        recognizedAmount: '0.0000000',
        transactionHash: 'd'.repeat(64),
      });
      expect(plan.nextStatus === 'CREDITED').toBe(false);
      expect(plan.recognizedAmount === '10.0000000').toBe(false);
      nets(plan.journals);
    }
  });

  it('ignores outgoing payments and failed transactions', () => {
    expect(
      classifyPayment({
        watchedAccountId: dest,
        listed: payment('10.0000000', { to: 'GOTHER', from: dest }),
        operation: payment('10.0000000', { to: 'GOTHER', from: dest }),
        transaction: tx(),
        intent: intent(),
      }).kind,
    ).toBe('outgoing');
    expect(
      classifyPayment({
        watchedAccountId: dest,
        listed: payment('10.0000000', { transactionSuccessful: false }),
        operation: payment('10.0000000', { transactionSuccessful: false }),
        transaction: tx({ successful: false }),
        intent: intent(),
      }).kind,
    ).toBe('failed');
  });

  it('keeps a credited intent credited when a second operation in the same memo arrives', () => {
    const extra = payment('1.0000000', {
      operationId: '56',
      pagingToken: '56',
    });
    const classification = classifyPayment({
      watchedAccountId: dest,
      listed: extra,
      operation: extra,
      transaction: tx(),
      intent: intent({
        status: 'CREDITED',
        receivedAmount: '10.0000000',
        recognizedAmount: '10.0000000',
      }),
    });
    expect(classification.kind).toBe('excess_after_credit');
    const plan = planLedger({
      classification,
      paymentAmount: '1.0000000',
      invoiceAmount: '10.0000000',
      recognizedAmount: '10.0000000',
      transactionHash: extra.transactionHash,
    });
    expect(plan.nextStatus).toBeNull();
    const total = nets(plan.journals);
    expect(total.merchant_available ?? 0n).toBe(0n);
    expect(total.review_held).toBe(stroops('1.0000000'));
  });

  it('sends an unmatched memo to suspense', () => {
    const listed = payment('3.0000000');
    const classification = classifyPayment({
      watchedAccountId: dest,
      listed,
      operation: listed,
      transaction: tx({ memo: 'OTHER' }),
      intent: intent(),
    });
    expect(classification.kind).toBe('unmatched');
    const plan = planLedger({
      classification,
      paymentAmount: '3.0000000',
      invoiceAmount: null,
      recognizedAmount: '0.0000000',
      transactionHash: listed.transactionHash,
    });
    expect(nets(plan.journals).suspense).toBe(stroops('3.0000000'));
  });
});
