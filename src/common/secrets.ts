import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MEMO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMemo(length = 20): string {
  const bytes = randomBytes(length);
  let memo = '';
  for (const byte of bytes) {
    memo += MEMO_ALPHABET[byte % MEMO_ALPHABET.length];
  }
  if (Buffer.byteLength(memo, 'utf8') > 28) {
    throw new Error('generated memo exceeds the MEMO_TEXT limit');
  }
  return memo;
}

export function generateApiKey(): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = `bk_test_${randomBytes(32).toString('base64url')}`;
  return {
    raw,
    hash: hashSecret(raw),
    prefix: raw.slice(0, 16),
  };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashRequest(parts: {
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  merchantOrderRef: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        amount: parts.amount,
        asset_code: parts.assetCode,
        asset_issuer: parts.assetIssuer,
        merchant_order_ref: parts.merchantOrderRef,
      }),
    )
    .digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
