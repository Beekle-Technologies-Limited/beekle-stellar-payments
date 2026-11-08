import { mapHorizonOperation, samePaymentEvidence } from './horizon-types';
import type { NormalizedPayment, NormalizedTransaction } from './horizon-types';

describe('Horizon payment mapping', () => {
  it('reads path_payment_strict_send amount as the destination asset received', () => {
    const mapped = mapHorizonOperation({
      id: '124624072438579201',
      paging_token: '124624072438579201',
      type: 'path_payment_strict_send',
      transaction_successful: true,
      source_account:
        'GBZH7S5NC57XNHKHJ75C5DGMI3SP6ZFJLIKW74K6OSMA5E5DFMYBDD2Z',
      created_at: '2020-04-04T13:47:50Z',
      transaction_hash: 'a'.repeat(64),
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      from: 'GBZH7S5NC57XNHKHJ75C5DGMI3SP6ZFJLIKW74K6OSMA5E5DFMYBDD2Z',
      to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amount: '26.5544244',
    });
    expect(mapped.supported).toBe(true);
    expect(mapped.amount).toBe('26.5544244');
    expect(mapped.assetCode).toBe('USDC');
    expect(mapped.assetIssuer).toBe(
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
  });

  it('does not treat create_account as a USDC payment', () => {
    const mapped = mapHorizonOperation({
      id: '1',
      paging_token: '1',
      type: 'create_account',
      transaction_successful: true,
      transaction_hash: 'b'.repeat(64),
      amount: '10.0000000',
      asset_code: 'USDC',
    });
    expect(mapped.supported).toBe(false);
    expect(mapped.amount).toBeNull();
  });

  it('rejects a list record that disagrees with the re-fetched operation', () => {
    const listed = payment({ amount: '10.0000000' });
    const operation = payment({ amount: '9.0000000' });
    const tx = transaction();
    expect(samePaymentEvidence(listed, operation, tx)).toBe(false);
  });
});

function payment(overrides: Partial<NormalizedPayment>): NormalizedPayment {
  return {
    operationId: '10',
    pagingToken: '10',
    type: 'payment',
    supported: true,
    transactionHash: 'c'.repeat(64),
    transactionSuccessful: true,
    createdAt: '2026-01-01T00:00:00Z',
    sourceAccount: 'GSOURCE',
    from: 'GSOURCE',
    to: 'GDEST',
    assetType: 'credit_alphanum4',
    assetCode: 'USDC',
    assetIssuer: 'GISSUER',
    amount: '10.0000000',
    muxed: false,
    ...overrides,
  };
}

function transaction(): NormalizedTransaction {
  return {
    hash: 'c'.repeat(64),
    successful: true,
    createdAt: '2026-01-01T00:00:00Z',
    memoType: 'text',
    memo: 'ABCDEFGH',
    sourceAccount: 'GSOURCE',
  };
}
