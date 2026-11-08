import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ED25519_PUBLIC_VERSION = 6 << 3;

/** Ed25519 account id (G...) check, without loading the Stellar SDK. */
export function isValidEd25519PublicKey(value: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(value)) return false;
  const decoded = decodeBase32(value);
  if (!decoded || decoded.length !== 35) return false;
  if (decoded[0] !== ED25519_PUBLIC_VERSION) return false;
  const payload = decoded.subarray(0, 33);
  const checksum = decoded.readUInt16LE(33);
  return crc16xmodem(payload) === checksum;
}

/**
 * A syntactically valid account id with a discarded random payload.
 * No seed is created or returned. The address is not funded and is not spendable.
 */
export function randomWatchOnlyPublicKey(): string {
  return encodePublicKey(randomBytes(32));
}

function encodePublicKey(raw: Buffer): string {
  const versioned = Buffer.concat([Buffer.from([ED25519_PUBLIC_VERSION]), raw]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc16xmodem(versioned), 0);
  return encodeBase32(Buffer.concat([versioned, checksum]));
}

function crc16xmodem(buffer: Buffer): number {
  let crc = 0x0000;
  for (const byte of buffer) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer | null {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
