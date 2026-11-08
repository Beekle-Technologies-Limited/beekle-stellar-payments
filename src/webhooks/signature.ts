import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhookBody(
  secret: string,
  timestampSeconds: string,
  body: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  header: string;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  const timestamp = /(?:^|,)t=(\d+)/.exec(input.header)?.[1];
  const presented = /(?:^|,)v1=([a-f0-9]+)/.exec(input.header)?.[1];
  if (!timestamp || !presented) return false;
  const tolerance = input.toleranceSeconds ?? 300;
  const drift = Math.abs(input.nowSeconds - Number(timestamp));
  if (!Number.isFinite(drift) || drift > tolerance) return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.body}`)
    .digest('hex');
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(presented, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
