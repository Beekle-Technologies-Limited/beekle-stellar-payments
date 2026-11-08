import { CIRCLE_USDC } from '../stellar/known-assets';
import { STELLAR_NETWORKS } from '../stellar/networks';
import { ConfigError, loadConfig } from './app-config';

const TEST_WEBHOOK_KEY = Buffer.alloc(32, 7).toString('base64');

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'beekle',
    DB_PASSWORD: 'beekle_dev_only',
    DB_NAME: 'beekle_stellar',
    STELLAR_NETWORK: 'testnet',
    WEBHOOK_ENCRYPTION_KEY: TEST_WEBHOOK_KEY,
    ...overrides,
  };
}

describe('loadConfig network guards', () => {
  it('defaults to testnet Circle USDC and the official passphrase', () => {
    const config = loadConfig(env());
    expect(config.stellar.passphrase).toBe(STELLAR_NETWORKS.testnet.passphrase);
    expect(config.stellar.horizonUrl).toBe(STELLAR_NETWORKS.testnet.horizonUrl);
    expect(config.stellar.acceptedAssets).toEqual([
      { code: 'USDC', issuer: CIRCLE_USDC.testnet.issuer },
    ]);
    expect(config.stellar.allowMainnet).toBe(false);
  });

  it('refuses mainnet unless explicitly allowed, and then pins Circle mainnet USDC', () => {
    expect(() =>
      loadConfig(
        env({
          STELLAR_NETWORK: 'mainnet',
          STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORKS.mainnet.passphrase,
        }),
      ),
    ).toThrow(ConfigError);
    const config = loadConfig(
      env({
        STELLAR_NETWORK: 'mainnet',
        STELLAR_ALLOW_MAINNET: 'true',
        STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORKS.mainnet.passphrase,
        STELLAR_HORIZON_URL: STELLAR_NETWORKS.mainnet.horizonUrl,
      }),
    );
    expect(config.stellar.acceptedAssets).toEqual([
      { code: 'USDC', issuer: CIRCLE_USDC.mainnet.issuer },
    ]);
    expect(config.stellar.acceptedAssets[0].issuer).not.toBe(
      CIRCLE_USDC.testnet.issuer,
    );
  });

  it('refuses a passphrase or Horizon host that does not match the named network', () => {
    expect(() =>
      loadConfig(
        env({
          STELLAR_NETWORK_PASSPHRASE: STELLAR_NETWORKS.mainnet.passphrase,
        }),
      ),
    ).toThrow(/passphrase/);
    expect(() =>
      loadConfig(
        env({
          STELLAR_HORIZON_URL: 'https://example.invalid',
        }),
      ),
    ).toThrow(/HORIZON/);
    expect(() =>
      loadConfig(
        env({
          STELLAR_HORIZON_URL: 'https://user:pass@horizon-testnet.stellar.org',
        }),
      ),
    ).toThrow(/credentials/);
  });

  it('requires a webhook encryption key and refuses local dev mode in production', () => {
    expect(() =>
      loadConfig(
        env({
          NODE_ENV: 'production',
          WEBHOOK_ENCRYPTION_KEY: '',
        }),
      ),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);
    expect(() =>
      loadConfig(
        env({
          NODE_ENV: 'production',
          WEBHOOK_SECRETS_DEV_MODE: 'local',
        }),
      ),
    ).toThrow(/refused/);
    expect(() =>
      loadConfig(
        env({
          NODE_ENV: 'development',
          WEBHOOK_ENCRYPTION_KEY: '',
        }),
      ),
    ).toThrow(/WEBHOOK_ENCRYPTION_KEY/);
    const local = loadConfig(
      env({
        NODE_ENV: 'development',
        WEBHOOK_ENCRYPTION_KEY: '',
        WEBHOOK_SECRETS_DEV_MODE: 'local',
      }),
    );
    expect(local.webhook.encryptionKeySource).toBe('ephemeral-local');
    expect(local.webhook.encryptionKey.length).toBe(32);
    const again = loadConfig(
      env({
        NODE_ENV: 'development',
        WEBHOOK_ENCRYPTION_KEY: '',
        WEBHOOK_SECRETS_DEV_MODE: 'local',
      }),
    );
    expect(
      again.webhook.encryptionKey.equals(local.webhook.encryptionKey),
    ).toBe(false);
    expect(() =>
      loadConfig(
        env({
          WEBHOOK_ENCRYPTION_KEY: Buffer.from('short').toString('base64'),
        }),
      ),
    ).toThrow(/32 bytes/);
  });
});
