import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const VERSION = 'v1';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

export class WebhookSecretError extends Error {
  constructor() {
    super('webhook signing secret could not be decrypted');
    this.name = 'WebhookSecretError';
  }
}

/** AES-256-GCM. The merchant id is authenticated data, so a row cannot be copied onto another merchant. */
export function encryptWebhookSecret(
  key: Buffer,
  merchantId: string,
  plaintext: string,
): string {
  assertKey(key);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(merchantId));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptWebhookSecret(
  key: Buffer,
  merchantId: string,
  stored: string,
): string {
  assertKey(key);
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new WebhookSecretError();
  }
  try {
    const nonce = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (nonce.length !== NONCE_LENGTH || tag.length !== TAG_LENGTH) {
      throw new WebhookSecretError();
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(merchantId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    if (plaintext.length === 0) throw new WebhookSecretError();
    return plaintext;
  } catch (error) {
    if (error instanceof WebhookSecretError) throw error;
    throw new WebhookSecretError();
  }
}

export function ciphertextLooksEncrypted(stored: string | null): boolean {
  return Boolean(stored?.startsWith(`${VERSION}.`));
}

function aad(merchantId: string): Buffer {
  return Buffer.from(`beekle-webhook-secret:${VERSION}:${merchantId}`, 'utf8');
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new WebhookSecretError();
  // Touch the key so a length check cannot be optimized into a branch that skips it.
  timingSafeEqual(key, key);
}
