import { formatStellarAmount } from '../common/money';
import type { PaymentClass } from './classify-payment';

export type LedgerBucket =
  | 'stellar_observed'
  | 'merchant_pending'
  | 'merchant_available'
  | 'review_held'
  | 'suspense';

export type JournalLine = {
  bucket: LedgerBucket;
  direction: 'DR' | 'CR';
  amount: string;
};

export type JournalPlan = {
  description: string;
  lines: JournalLine[];
};

export type AppliedPlan = {
  journals: JournalPlan[];
  nextStatus: string | null;
  receivedAmount: string | null;
  recognizedAmount: string | null;
  providerReference: string | null;
  eventType: string | null;
  reviewReason: string | null;
};

const ZERO = '0.0000000';

function pair(
  description: string,
  debit: LedgerBucket,
  credit: LedgerBucket,
  amount: string,
): JournalPlan {
  const canonical = formatStellarAmount(amount);
  return {
    description,
    lines: [
      { bucket: debit, direction: 'DR', amount: canonical },
      { bucket: credit, direction: 'CR', amount: canonical },
    ],
  };
}

/**
 * Self-custody recognition journals.
 * `merchant_available` means the invoice is recognized. It is not a balance
 * Beekle can pay out. Refunds are not journals that move chain funds.
 */
export function planLedger(input: {
  classification: PaymentClass;
  paymentAmount: string | null;
  invoiceAmount: string | null;
  recognizedAmount: string;
  transactionHash: string;
}): AppliedPlan {
  const amount = input.paymentAmount
    ? formatStellarAmount(input.paymentAmount)
    : null;
  const none: AppliedPlan = {
    journals: [],
    nextStatus: null,
    receivedAmount: null,
    recognizedAmount: null,
    providerReference: null,
    eventType: null,
    reviewReason: null,
  };
  const classification = input.classification;
  switch (classification.kind) {
    case 'ignored_operation':
    case 'failed':
    case 'outgoing':
      return none;
    case 'inconsistent':
      return {
        ...none,
        reviewReason: 'INCONSISTENT_EVIDENCE',
        eventType: 'payment.review',
      };
    case 'unmatched':
      if (!amount) return none;
      return {
        ...none,
        journals: [
          pair(
            'unmatched inbound to suspense',
            'stellar_observed',
            'suspense',
            amount,
          ),
        ],
        eventType: 'payment.unmatched',
        reviewReason: 'UNMATCHED_MEMO',
      };
    case 'muxed':
      if (!amount) return none;
      return {
        ...none,
        journals: [
          pair('muxed payment held', 'stellar_observed', 'review_held', amount),
        ],
        eventType: 'payment.review',
        reviewReason: 'MUXED_DESTINATION',
      };
    case 'wrong_asset':
      if (!amount) return none;
      return {
        ...none,
        journals: [
          pair('wrong asset held', 'stellar_observed', 'review_held', amount),
        ],
        eventType: 'payment.review',
        reviewReason: 'WRONG_ASSET',
        providerReference: input.transactionHash,
      };
    case 'late':
      if (!amount) return none;
      return {
        journals: [
          pair('late payment held', 'stellar_observed', 'review_held', amount),
        ],
        nextStatus: 'HELD',
        receivedAmount: classification.receivedAfter,
        recognizedAmount: input.recognizedAmount,
        providerReference: input.transactionHash,
        eventType: 'payment.held',
        reviewReason: 'LATE_PAYMENT',
      };
    case 'partial':
      if (!amount) return none;
      return {
        journals: [
          pair(
            'partial payment held',
            'stellar_observed',
            'review_held',
            amount,
          ),
        ],
        nextStatus: 'PARTIAL',
        receivedAmount: classification.receivedAfter,
        recognizedAmount: input.recognizedAmount,
        providerReference: input.transactionHash,
        eventType: 'payment.partial',
        reviewReason: 'PARTIAL',
      };
    case 'overpaid':
      if (!amount) return none;
      return {
        journals: [
          pair('overpayment held', 'stellar_observed', 'review_held', amount),
        ],
        nextStatus: 'OVERPAID',
        receivedAmount: classification.receivedAfter,
        recognizedAmount: input.recognizedAmount,
        providerReference: input.transactionHash,
        eventType: 'payment.overpaid',
        reviewReason: 'OVERPAID',
      };
    case 'excess_after_credit':
      if (!amount) return none;
      return {
        journals: [
          pair(
            'excess after credit held',
            'stellar_observed',
            'review_held',
            amount,
          ),
        ],
        nextStatus: null,
        receivedAmount: classification.receivedAfter,
        recognizedAmount: null,
        providerReference: null,
        eventType: 'payment.review',
        reviewReason: 'EXCESS_AFTER_CREDIT',
      };
    case 'exact': {
      if (!amount || !input.invoiceAmount) return none;
      const invoice = formatStellarAmount(input.invoiceAmount);
      const journals = classification.completesFromPartial
        ? [
            pair(
              'completing payment held',
              'stellar_observed',
              'review_held',
              amount,
            ),
            pair(
              'release held invoice to pending',
              'review_held',
              'merchant_pending',
              invoice,
            ),
            pair(
              'recognize pending invoice',
              'merchant_pending',
              'merchant_available',
              invoice,
            ),
          ]
        : [
            pair(
              'observe exact payment',
              'stellar_observed',
              'merchant_pending',
              amount,
            ),
            pair(
              'recognize exact payment',
              'merchant_pending',
              'merchant_available',
              amount,
            ),
          ];
      return {
        journals,
        nextStatus: 'CREDITED',
        receivedAmount: classification.receivedAfter,
        recognizedAmount: invoice,
        providerReference: input.transactionHash,
        eventType: 'payment.credited',
        reviewReason: null,
      };
    }
    default: {
      const unreachable: never = classification;
      return unreachable;
    }
  }
}

export function planRecognizeInvoice(invoiceAmount: string): JournalPlan[] {
  const invoice = formatStellarAmount(invoiceAmount);
  return [
    pair(
      'operator recognize held invoice',
      'review_held',
      'merchant_pending',
      invoice,
    ),
    pair(
      'operator release pending invoice',
      'merchant_pending',
      'merchant_available',
      invoice,
    ),
  ];
}

export const ZERO_AMOUNT = ZERO;
