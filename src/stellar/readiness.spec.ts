import { assessReceivingReadiness } from './readiness';
import type { AccountReadiness } from './readiness';

const funded: AccountReadiness = {
  exists: true,
  nativeBalance: '10000.0000000',
  trustline: true,
  authorized: true,
};

describe('receiving-account readiness', () => {
  it('refuses to solicit USDC when the account or trustline is missing', () => {
    expect(
      assessReceivingReadiness({
        assetCode: 'USDC',
        assetIssuer: 'GISSUER',
        account: {
          exists: false,
          nativeBalance: null,
          trustline: false,
          authorized: false,
        },
      }).ready,
    ).toBe(false);
    const missingTrust = assessReceivingReadiness({
      assetCode: 'USDC',
      assetIssuer: 'GISSUER',
      account: { ...funded, trustline: false, authorized: false },
    });
    expect(missingTrust.code).toBe('trustline_missing');
    expect(missingTrust.ready).toBe(false);
    expect(
      assessReceivingReadiness({
        assetCode: 'USDC',
        assetIssuer: 'GISSUER',
        account: { ...funded, authorized: false },
      }).code,
    ).toBe('trustline_unauthorized');
  });

  it('allows XLM only when the account exists, and does not call that USDC', () => {
    const ready = assessReceivingReadiness({
      assetCode: 'XLM',
      assetIssuer: null,
      account: { ...funded, trustline: false },
    });
    expect(ready.ready).toBe(true);
    expect(ready.message.includes('not a USDC')).toBe(true);
    expect(
      assessReceivingReadiness({
        assetCode: 'USDC',
        assetIssuer: 'GISSUER',
        account: funded,
      }).ready,
    ).toBe(true);
  });
});
