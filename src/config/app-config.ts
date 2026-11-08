import { randomBytes } from 'node:crypto';
import { CIRCLE_USDC } from '../stellar/known-assets';
import { officialNetwork, type StellarNetworkName } from '../stellar/networks';

export type AcceptedAsset = {
  code: string;
  issuer: string | null;
};

export type AppConfig = {
  nodeEnv: string;
  port: number;
  publicBaseUrl: string;
  migrateOnBoot: boolean;
  demoOpenRegistration: boolean;
  adminToken: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  stellar: {
    network: StellarNetworkName;
    passphrase: string;
    horizonUrl: string;
    allowMainnet: boolean;
    allowUnofficialHorizon: boolean;
    acceptedAssets: AcceptedAsset[];
    friendbotUrl: string | null;
  };
  observer: {
    enabled: boolean;
    pollMs: number;
    pageLimit: number;
  };
  expiry: { enabled: boolean; pollMs: number };
  webhook: {
    workerEnabled: boolean;
    pollMs: number;
    hostAllowlist: string[];
    allowPublicHttps: boolean;
    backoffMs: number[];
    timeoutMs: number;
    encryptionKey: Buffer;
    encryptionKeySource: 'config' | 'ephemeral-local';
  };
};

const DEFAULT_BACKOFF_MS = [
  15_000, 30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000,
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === '') {
    throw new ConfigError(`${key} is required`);
  }
  return value.trim();
}

function flag(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigError(`${key} must be true or false`);
}

function normalizeHorizonUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('STELLAR_HORIZON_URL is not a valid URL');
  }
  if (url.username || url.password) {
    throw new ConfigError('STELLAR_HORIZON_URL must not contain credentials');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('STELLAR_HORIZON_URL must be http or https');
  }
  url.hash = '';
  url.search = '';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path;
  return url.toString().replace(/\/$/, '');
}

export function parseAcceptedAssets(
  raw: string | undefined,
  network: StellarNetworkName,
): AcceptedAsset[] {
  const source =
    raw && raw.trim() !== ''
      ? raw
      : network === 'testnet'
        ? `${CIRCLE_USDC.testnet.code}:${CIRCLE_USDC.testnet.issuer}`
        : `${CIRCLE_USDC.mainnet.code}:${CIRCLE_USDC.mainnet.issuer}`;
  return source.split(',').map((entry) => {
    const piece = entry.trim();
    const separator = piece.indexOf(':');
    if (separator <= 0) {
      throw new ConfigError(
        'ACCEPTED_ASSETS entries must look like CODE:ISSUER or XLM:native',
      );
    }
    const code = piece.slice(0, separator).trim();
    const issuerPart = piece.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
      throw new ConfigError(`invalid asset code ${code}`);
    }
    if (issuerPart === 'native') {
      if (code !== 'XLM') {
        throw new ConfigError('only XLM can use the native issuer');
      }
      return { code: 'XLM', issuer: null };
    }
    if (!/^G[A-Z2-7]{55}$/.test(issuerPart)) {
      throw new ConfigError(`invalid asset issuer for ${code}`);
    }
    return { code, issuer: issuerPart };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const networkName = required(env, 'STELLAR_NETWORK');
  if (networkName !== 'testnet' && networkName !== 'mainnet') {
    throw new ConfigError('STELLAR_NETWORK must be testnet or mainnet');
  }
  const network = networkName;
  const official = officialNetwork(network);
  const allowMainnet = flag(env, 'STELLAR_ALLOW_MAINNET', false);
  if (network === 'mainnet' && !allowMainnet) {
    throw new ConfigError(
      'mainnet is refused unless STELLAR_ALLOW_MAINNET=true. This service does not sign or submit mainnet transactions.',
    );
  }
  const passphrase =
    env.STELLAR_NETWORK_PASSPHRASE?.trim() || official.passphrase;
  if (passphrase !== official.passphrase) {
    throw new ConfigError(
      `STELLAR_NETWORK_PASSPHRASE does not match the official ${network} passphrase`,
    );
  }
  const allowUnofficialHorizon = flag(
    env,
    'STELLAR_HORIZON_ALLOW_UNOFFICIAL',
    false,
  );
  const horizonUrl = normalizeHorizonUrl(
    env.STELLAR_HORIZON_URL?.trim() || official.horizonUrl,
  );
  if (horizonUrl !== official.horizonUrl && !allowUnofficialHorizon) {
    throw new ConfigError(
      'STELLAR_HORIZON_URL differs from the official Horizon for this network. Set STELLAR_HORIZON_ALLOW_UNOFFICIAL=true only for a local mock.',
    );
  }
  if (network === 'mainnet' && horizonUrl.includes('testnet')) {
    throw new ConfigError('refusing a testnet Horizon URL for mainnet');
  }
  const backoffRaw = env.WEBHOOK_BACKOFF_MS?.trim();
  const backoffMs = backoffRaw
    ? backoffRaw.split(',').map((part) => {
        if (!/^\d+$/.test(part.trim())) {
          throw new ConfigError(
            'WEBHOOK_BACKOFF_MS must be comma-separated milliseconds',
          );
        }
        const value = Number(part.trim());
        if (value > 6 * 60 * 60 * 1000) {
          throw new ConfigError('webhook backoff cannot exceed 6 hours');
        }
        return value;
      })
    : DEFAULT_BACKOFF_MS;
  if (backoffMs.length < 1 || backoffMs.length > 12) {
    throw new ConfigError('webhook backoff needs between 1 and 12 attempts');
  }
  const port = Number(env.PORT ?? '4317');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT is invalid');
  }
  const dbPort = Number(env.DB_PORT ?? '3306');
  if (!Number.isInteger(dbPort) || dbPort < 1) {
    throw new ConfigError('DB_PORT is invalid');
  }
  const pollMs = Number(env.OBSERVER_POLL_MS ?? '5000');
  if (!Number.isInteger(pollMs) || pollMs < 1000) {
    throw new ConfigError(
      'OBSERVER_POLL_MS must be an integer of at least 1000',
    );
  }
  const pageLimit = Number(env.OBSERVER_PAGE_LIMIT ?? '50');
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 200) {
    throw new ConfigError('OBSERVER_PAGE_LIMIT must be 1..200');
  }
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const webhookKey = loadWebhookEncryptionKey(env, nodeEnv);
  return {
    nodeEnv,
    port,
    publicBaseUrl: (
      env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1:${port}`
    ).replace(/\/$/, ''),
    migrateOnBoot: flag(env, 'DB_MIGRATE_ON_BOOT', false),
    demoOpenRegistration: flag(env, 'DEMO_OPEN_REGISTRATION', false),
    adminToken: env.ADMIN_TOKEN?.trim() ?? '',
    db: {
      host: required(env, 'DB_HOST'),
      port: dbPort,
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASSWORD'),
      name: required(env, 'DB_NAME'),
    },
    stellar: {
      network,
      passphrase,
      horizonUrl,
      allowMainnet,
      allowUnofficialHorizon,
      acceptedAssets: parseAcceptedAssets(env.ACCEPTED_ASSETS, network),
      friendbotUrl: official.friendbotUrl,
    },
    observer: {
      enabled: flag(env, 'OBSERVER_ENABLED', true),
      pollMs,
      pageLimit,
    },
    expiry: {
      enabled: flag(env, 'EXPIRY_WORKER_ENABLED', true),
      pollMs: Number(env.EXPIRY_POLL_MS ?? '15000'),
    },
    webhook: {
      workerEnabled: flag(env, 'WEBHOOK_WORKER_ENABLED', true),
      pollMs: Number(env.WEBHOOK_POLL_MS ?? '5000'),
      hostAllowlist: (env.WEBHOOK_HOST_ALLOWLIST ?? 'localhost,127.0.0.1')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
      allowPublicHttps: flag(env, 'WEBHOOK_ALLOW_PUBLIC_HTTPS', false),
      backoffMs,
      timeoutMs: Number(env.WEBHOOK_TIMEOUT_MS ?? '5000'),
      encryptionKey: webhookKey.key,
      encryptionKeySource: webhookKey.source,
    },
  };
}

/**
 * Webhook HMAC secrets are stored as AES-256-GCM ciphertext.
 * Production refuses to boot without a 32-byte WEBHOOK_ENCRYPTION_KEY.
 * WEBHOOK_SECRETS_DEV_MODE=local is the only non-production fallback: a key
 * is generated in memory for this process and is not written or logged.
 * That mode never stores the HMAC secret in plaintext.
 */
export function loadWebhookEncryptionKey(
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
): { key: Buffer; source: 'config' | 'ephemeral-local' } {
  const devMode = env.WEBHOOK_SECRETS_DEV_MODE?.trim() ?? '';
  if (devMode !== '' && devMode !== 'local') {
    throw new ConfigError('WEBHOOK_SECRETS_DEV_MODE must be "local" or unset');
  }
  if (devMode === 'local' && nodeEnv === 'production') {
    throw new ConfigError(
      'WEBHOOK_SECRETS_DEV_MODE=local is refused when NODE_ENV=production',
    );
  }
  const raw = env.WEBHOOK_ENCRYPTION_KEY?.trim() ?? '';
  if (raw !== '') {
    let key: Buffer;
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      throw new ConfigError('WEBHOOK_ENCRYPTION_KEY is not valid base64');
    }
    if (key.length !== 32) {
      throw new ConfigError('WEBHOOK_ENCRYPTION_KEY must decode to 32 bytes');
    }
    return { key, source: 'config' };
  }
  if (nodeEnv === 'production') {
    throw new ConfigError(
      'WEBHOOK_ENCRYPTION_KEY is required when NODE_ENV=production',
    );
  }
  if (devMode === 'local') {
    return { key: randomBytes(32), source: 'ephemeral-local' };
  }
  throw new ConfigError(
    'WEBHOOK_ENCRYPTION_KEY is required. For a local process-only key, set WEBHOOK_SECRETS_DEV_MODE=local with NODE_ENV other than production.',
  );
}

export function assetsMatch(
  left: AcceptedAsset,
  right: AcceptedAsset,
): boolean {
  return left.code === right.code && left.issuer === right.issuer;
}

export function findAcceptedAsset(
  config: AppConfig,
  code: string,
  issuer: string | null,
): AcceptedAsset | undefined {
  return config.stellar.acceptedAssets.find((asset) =>
    assetsMatch(asset, { code, issuer }),
  );
}
