import { CIRCLE_USDC } from './known-assets';
import { isValidEd25519PublicKey, randomWatchOnlyPublicKey } from './strkey';

describe('account ids', () => {
  it('accepts Circle issuers and a generated watch-only key', () => {
    expect(isValidEd25519PublicKey(CIRCLE_USDC.testnet.issuer)).toBe(true);
    expect(isValidEd25519PublicKey(CIRCLE_USDC.mainnet.issuer)).toBe(true);
    const generated = randomWatchOnlyPublicKey();
    expect(isValidEd25519PublicKey(generated)).toBe(true);
    const broken =
      generated.slice(0, -1) + (generated.endsWith('A') ? 'B' : 'A');
    expect(isValidEd25519PublicKey(broken)).toBe(false);
    expect(isValidEd25519PublicKey('not-a-key')).toBe(false);
  });
});
