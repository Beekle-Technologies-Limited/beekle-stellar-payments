import { randomUUID } from 'node:crypto';
import { formatStellarAmount } from '../common/money';
import { PaymentIntent } from '../database/entities';
import type { NormalizedPayment } from '../stellar/horizon-types';

/**
 * Common event shape for a future Bridge adapter.
 * Bridge is not implemented. `provider` is always `stellar` here.
 * Shared fields live under `data`. Chain-specific facts live under `data.stellar`.
 * A Bridge adapter would use `provider: "bridge"` and `data.bridge` instead.
 */
export type NormalizedEventType =
  | 'payment.credited'
  | 'payment.partial'
  | 'payment.overpaid'
  | 'payment.held'
  | 'payment.expired'
  | 'payment.review'
  | 'payment.unmatched';

export function buildNormalizedEvent(input: {
  type: NormalizedEventType;
  createdAt: Date;
  intent: PaymentIntent | null;
  payment: NormalizedPayment | null;
  destination: string;
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
}): { eventId: string; body: string } {
  const eventId = randomUUID();
  const body = JSON.stringify({
    id: eventId,
    type: input.type,
    provider: 'stellar',
    created_at: input.createdAt.toISOString(),
    data: {
      intent_id: input.intent?.id ?? null,
      merchant_order_ref: input.intent?.merchantOrderRef ?? null,
      status: input.intent?.status ?? null,
      amount: input.intent
        ? formatStellarAmount(String(input.intent.amount))
        : null,
      received_amount: input.intent
        ? formatStellarAmount(String(input.intent.receivedAmount))
        : null,
      recognized_amount: input.intent
        ? formatStellarAmount(String(input.intent.recognizedAmount))
        : null,
      asset: {
        code: input.assetCode,
        issuer: input.assetIssuer,
        network: input.network,
      },
      destination: input.destination,
      reference: input.intent
        ? { memo_type: input.intent.memoType, memo: input.intent.memo }
        : null,
      provider_reference:
        input.intent?.providerReference ??
        input.payment?.transactionHash ??
        null,
      stellar: input.payment
        ? {
            operation_id: input.payment.operationId,
            transaction_hash: input.payment.transactionHash,
            paging_token: input.payment.pagingToken,
            operation_type: input.payment.type,
          }
        : null,
    },
  });
  return { eventId, body };
}
