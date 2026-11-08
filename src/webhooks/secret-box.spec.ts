import { randomBytes } from 'node:crypto';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  WebhookSecretError,
} from './secret-box';

const secret = 'merchant-webhook-secret-value';
const merchantId = '11111111-1111-1111-1111-111111111111';

describe('webhook secret encryption', () => {
  it('round-trips with the configured key and fails closed on the wrong key or merchant', () => {
    const key = randomBytes(32);
    const stored = encryptWebhookSecret(key, merchantId, secret);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored.includes(secret)).toBe(false);
    expect(decryptWebhookSecret(key, merchantId, stored)).toBe(secret);
    expect(() =>
      decryptWebhookSecret(randomBytes(32), merchantId, stored),
    ).toThrow(WebhookSecretError);
    expect(() =>
      decryptWebhookSecret(key, '22222222-2222-2222-2222-222222222222', stored),
    ).toThrow(WebhookSecretError);
    expect(() => decryptWebhookSecret(key, merchantId, secret)).toThrow(
      WebhookSecretError,
    );
    try {
      decryptWebhookSecret(randomBytes(32), merchantId, stored);
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookSecretError);
      expect((error as Error).message.includes(secret)).toBe(false);
      expect((error as Error).message.includes(key.toString('base64'))).toBe(
        false,
      );
    }
  });
});
