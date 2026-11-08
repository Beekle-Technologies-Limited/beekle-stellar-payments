import { pinWebhookAddress, WebhookUrlError } from './ssrf';

const locked = {
  hostAllowlist: ['localhost', '127.0.0.1'],
  allowPublicHttps: false,
};

const none = (): Promise<string[]> => Promise.resolve([]);

describe('webhook URL policy', () => {
  it('allows the demo localhost allowlist and rejects metadata and private hosts', async () => {
    await expect(
      pinWebhookAddress('http://127.0.0.1:4317/hook', locked, none),
    ).resolves.toMatchObject({ address: '127.0.0.1' });
    await expect(
      pinWebhookAddress('http://localhost:9/hook', locked, () =>
        Promise.resolve(['10.0.0.1']),
      ),
    ).resolves.toMatchObject({ address: '127.0.0.1' });
    await expect(
      pinWebhookAddress('http://169.254.169.254/latest', locked, none),
    ).rejects.toBeInstanceOf(WebhookUrlError);
    await expect(
      pinWebhookAddress('http://10.1.2.3/hook', locked, none),
    ).rejects.toBeInstanceOf(WebhookUrlError);
    await expect(
      pinWebhookAddress('https://merchant.example/hook', locked, () =>
        Promise.resolve(['93.184.216.34']),
      ),
    ).rejects.toThrow(/allowlist/);
    await expect(
      pinWebhookAddress('https://user:pass@127.0.0.1/hook', locked, none),
    ).rejects.toThrow(/credentials/);
  });

  it('refuses a public name that resolves into a private range', async () => {
    await expect(
      pinWebhookAddress(
        'https://merchant.example/hook',
        { hostAllowlist: ['merchant.example'], allowPublicHttps: true },
        () => Promise.resolve(['169.254.169.254']),
      ),
    ).rejects.toThrow(/blocked/);
  });
});
