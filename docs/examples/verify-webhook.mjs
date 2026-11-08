import { createHmac, timingSafeEqual } from 'node:crypto';

// Merchant-side check for Beekle-Signature: t=<unix>,v1=<hex>.
// Signed payload is `${t}.${rawBody}` using the webhook secret shown once at registration.
export function verifyBeekleWebhook({ secret, header, rawBody, nowSeconds, toleranceSeconds = 300 }) {
  const timestamp = /(?:^|,)t=(\d+)/.exec(header)?.[1];
  const presented = /(?:^|,)v1=([a-f0-9]+)/.exec(header)?.[1];
  if (!timestamp || !presented) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
