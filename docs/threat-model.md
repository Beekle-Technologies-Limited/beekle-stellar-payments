# Threat model

This is a design note for the code in this repository. It is not a pentest and it does not claim a production deployment was reviewed.

## Assets

- Merchant API keys and webhook HMAC secrets
- The recognition ledger (who is marked paid)
- The observer cursor (which Horizon history has been consumed)
- Customer payment requests (amount, destination, memo)
- There is no Stellar seed to steal from this database

## Boundaries

| Boundary | Trust |
| --- | --- |
| Merchant API caller | Holds the API key. Can create invoices for their own destination only |
| Customer wallet | Signs. This service never sees the seed |
| Horizon | Supplies history. Records are re-fetched and compared before recognition |
| Merchant webhook host | Receives payment status. Must be registered and allowlisted |
| Operator admin token | Can move a held invoice to recognized, reset a cursor, or note an external refund |

## Abuse cases the code is written to resist

- **Fake USDC.** Code and issuer are compared to the intent. A same-code asset from another issuer is held, not recognized. The default testnet issuer is Circle's published issuer, not an asset this service issues.
- **Mainnet mix-up.** Boot fails if the passphrase, the named network, and the Horizon URL disagree. Mainnet stays off unless `STELLAR_ALLOW_MAINNET=true`. SEP-7 includes the passphrase. This process does not sign.
- **Float rounding.** Amounts that are not fixed-point strings with at most 7 decimals are rejected. Stroop math uses integers.
- **Replay and double credit.** `(network, operation_id)` is unique. A second operation in the same transaction is a new observation. Cursor updates commit with the observation.
- **Late and partial payment.** They do not increase `merchant_available`.
- **History import surprise.** New merchants start at the Horizon tip.
- **Webhook SSRF.** URLs are not taken from payment requests. Hosts must be allowlisted in the demo default. Private, link-local, and metadata answers are rejected unless the host itself is an allowlisted localhost address. Redirects are not followed. The TCP connection uses the address that was checked.
- **Secret leakage in the demo key generator.** The preview address is a random public key. No seed is allocated.
- **Inconsistent Horizon pages.** If the list record and the re-fetched operation or transaction disagree, the payment is not recognized.
- **Cursor skip.** Moving a cursor forward is an admin action and is audited. The code will not skip a failing record by itself, so a poison record stalls that account until an operator acts.

## Residual risk

- Horizon can still lie if both the list and the re-fetch are wrong together. A second Horizon provider is not configured.
- DNS rebinding is reduced by pinning, not eliminated if the platform resolver is compromised.
- Webhook HMAC secrets are stored as AES-256-GCM ciphertext bound to the merchant id. Production still needs `WEBHOOK_ENCRYPTION_KEY` from a secrets manager. That key is not in this repository. The local mode key is ephemeral, so ciphertext from that mode cannot be decrypted after restart.
- Testnet resets can replace Circle's testnet issuer. The address is pinned from Circle's page as of 2026-11-07 and must be re-checked.
- Claimable-balance and Soroban transfers of USDC are not auto-credited. A payer who uses those paths will not complete checkout.
- The admin token in `.env.example` is a placeholder. Anyone who deploys it unchanged can recognize invoices.
- Open demo registration, when enabled, lets a caller register any allowlisted webhook and any account id. It does not give them that account's funds.
- Reconciliation detects ledger drift and pauses the `settlement_paused` flag. Nothing in this service pays out, so the flag is a signal for a future worker, not a custody control that was tested against one.
