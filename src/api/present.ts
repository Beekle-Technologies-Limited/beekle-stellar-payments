import { formatStellarAmount } from '../common/money';
import { PaymentIntent } from '../database/entities';

export function presentIntent(intent: PaymentIntent, sep7Uri: string | null) {
  return {
    id: intent.id,
    provider: 'stellar' as const,
    merchant_order_ref: intent.merchantOrderRef,
    status: intent.status,
    amount: formatStellarAmount(String(intent.amount)),
    received_amount: formatStellarAmount(String(intent.receivedAmount)),
    recognized_amount: formatStellarAmount(String(intent.recognizedAmount)),
    asset: {
      code: intent.assetCode,
      issuer: intent.assetIssuer,
      network: intent.network,
    },
    destination: intent.destination,
    reference: {
      memo_type: intent.memoType,
      memo: intent.memo,
    },
    expires_at: new Date(intent.expiresAt).toISOString(),
    provider_reference: intent.providerReference,
    sep7_uri: sep7Uri,
    created_at: intent.createdAt
      ? new Date(intent.createdAt).toISOString()
      : null,
    model: 'self_custody_recognition' as const,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
