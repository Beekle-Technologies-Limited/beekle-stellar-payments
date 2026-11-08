/**
 * Circle-published USDC issuers on Stellar.
 *
 * Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
 * Read on 2026-11-07.
 * - Mainnet: USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 * - Testnet: USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
 *
 * Circle's Stellar quickstart repeats the same testnet issuer:
 * https://developers.circle.com/stablecoins/quickstarts/setup-usdc-trustline-stellar
 *
 * These are Circle issuers, not tokens issued by this service. A testnet
 * reset can invalidate the testnet account; the smoke script re-reads it
 * from Horizon before using it. Friendbot does not dispense this asset.
 */
export const CIRCLE_USDC = {
  mainnet: {
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  testnet: {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
} as const;

export const NATIVE_ASSET = {
  code: 'XLM',
  issuer: null,
} as const;
