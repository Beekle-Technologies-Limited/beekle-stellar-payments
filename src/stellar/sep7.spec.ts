import { CIRCLE_USDC } from './known-assets';
import { STELLAR_NETWORKS } from './networks';
import { buildSep7PayUri } from './sep7';

describe('SEP-7 pay URI', () => {
  it('pins the testnet passphrase, memo, and Circle testnet issuer', () => {
    const uri = buildSep7PayUri({
      destination: 'GD6W4OBUW2VK4C2XRS4AONX6Y4RUHBDI5D2F2N3A2X4N4K5M6P7Q8R9S0T',
      amount: '12.5000000',
      assetCode: 'USDC',
      assetIssuer: CIRCLE_USDC.testnet.issuer,
      memo: 'ABCDEFGHJK',
      memoType: 'MEMO_TEXT',
      networkPassphrase: STELLAR_NETWORKS.testnet.passphrase,
      message: 'Beekle checkout order-9',
    });
    expect(uri.startsWith('web+stellar:pay?')).toBe(true);
    const params = new URLSearchParams(uri.slice('web+stellar:pay?'.length));
    expect(params.get('amount')).toBe('12.5');
    expect(params.get('asset_code')).toBe('USDC');
    expect(params.get('asset_issuer')).toBe(CIRCLE_USDC.testnet.issuer);
    expect(params.get('memo')).toBe('ABCDEFGHJK');
    expect(params.get('memo_type')).toBe('MEMO_TEXT');
    expect(params.get('network_passphrase')).toBe(
      STELLAR_NETWORKS.testnet.passphrase,
    );
    expect(uri.includes('callback=')).toBe(false);
    expect(
      uri.includes(encodeURIComponent(STELLAR_NETWORKS.testnet.passphrase)),
    ).toBe(true);
  });

  it('omits asset parameters for native XLM, and does not label XLM as USDC', () => {
    const uri = buildSep7PayUri({
      destination: CIRCLE_USDC.testnet.issuer,
      amount: '1.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      memo: 'MEMO123',
      memoType: 'MEMO_TEXT',
      networkPassphrase: STELLAR_NETWORKS.testnet.passphrase,
      message: 'xlm smoke',
    });
    expect(uri.includes('asset_code=')).toBe(false);
    expect(uri.includes('USDC')).toBe(false);
  });
});
