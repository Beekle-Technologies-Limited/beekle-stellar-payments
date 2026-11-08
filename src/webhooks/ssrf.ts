import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.0.2.0', 24, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('198.51.100.0', 24, 'ipv4');
blocked.addSubnet('203.0.113.0', 24, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('224.0.0.0', 4, 'ipv4');
blocked.addSubnet('240.0.0.0', 4, 'ipv4');
blocked.addSubnet('::', 128, 'ipv6');
blocked.addSubnet('::1', 128, 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

export type WebhookUrlPolicy = {
  hostAllowlist: string[];
  allowPublicHttps: boolean;
};

export type DnsResolver = (hostname: string) => Promise<string[]>;

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return true;
  return blocked.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

const defaultResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export function normalizeHost(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
}

/**
 * Registered merchant URLs only. The demo allowlist is localhost.
 * Public HTTPS is off unless configured, and DNS answers that point at
 * private or metadata addresses are refused. Fetch pins the resolved
 * address so the connection target is the address that was checked.
 */
export async function pinWebhookAddress(
  rawUrl: string,
  policy: WebhookUrlPolicy,
  resolve: DnsResolver = defaultResolver,
): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError('webhook URL is invalid');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('webhook URL must not include credentials');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebhookUrlError('webhook URL protocol is not allowed');
  }
  const host = normalizeHost(url.hostname);
  if (!host) throw new WebhookUrlError('webhook URL is missing a host');
  const allowlisted = policy.hostAllowlist.includes(host);
  if (!allowlisted) {
    if (!policy.allowPublicHttps) {
      throw new WebhookUrlError('webhook host is not on the allowlist');
    }
    if (url.protocol !== 'https:') {
      throw new WebhookUrlError('public webhook URLs must use https');
    }
  }
  if (isIP(host)) {
    if (isBlockedAddress(host) && !allowlisted) {
      throw new WebhookUrlError('webhook IP address is blocked');
    }
    return { url, address: host };
  }
  if (allowlisted && (host === 'localhost' || host.endsWith('.localhost'))) {
    return { url, address: '127.0.0.1' };
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookUrlError('webhook host did not resolve');
  }
  if (addresses.length === 0) {
    throw new WebhookUrlError('webhook host did not resolve');
  }
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebhookUrlError('webhook host resolves to a blocked address');
    }
  }
  return { url, address: addresses[0] };
}
