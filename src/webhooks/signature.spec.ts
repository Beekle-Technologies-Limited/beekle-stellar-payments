import { signWebhookBody, verifyWebhookSignature } from './signature';

describe('webhook signatures', () => {
  it('verifies the exact body and rejects drift, mutation, and a swapped secret', () => {
    const body = '{"id":"evt_1","type":"payment.credited"}';
    const header = signWebhookBody('secret-a', '1700000000', body);
    expect(
      verifyWebhookSignature({
        secret: 'secret-a',
        header,
        body,
        nowSeconds: 1700000100,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: 'secret-a',
        header,
        body: body + ' ',
        nowSeconds: 1700000100,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: 'secret-b',
        header,
        body,
        nowSeconds: 1700000100,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: 'secret-a',
        header,
        body,
        nowSeconds: 1700000501,
      }),
    ).toBe(false);
  });
});
