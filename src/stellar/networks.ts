export const STELLAR_NETWORKS = {
  testnet: {
    name: 'testnet' as const,
    passphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  mainnet: {
    name: 'mainnet' as const,
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    friendbotUrl: null,
  },
};

export type StellarNetworkName = keyof typeof STELLAR_NETWORKS;

/**
 * Passphrases published by SDF:
 * https://developers.stellar.org/docs/networks
 * Confirmed against Horizon testnet root `network_passphrase` on 2026-11-07.
 */
export function officialNetwork(name: StellarNetworkName) {
  return STELLAR_NETWORKS[name];
}
