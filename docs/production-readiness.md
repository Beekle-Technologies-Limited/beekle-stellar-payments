# Production readiness

This checklist is unmet. The software is a testnet-first integration for review. Do not point it at mainnet or at live merchant funds by copying `.env.example`.

## Must be true before real money

- [ ] `STELLAR_ALLOW_MAINNET` remains false until a separate review, and the accepted issuer is Circle's mainnet USDC (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`), re-read from Circle's address page rather than from this file alone
- [ ] After every Stellar testnet reset, re-load the testnet issuer account before trusting `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- [ ] `DEMO_OPEN_REGISTRATION=false`
- [ ] `ADMIN_TOKEN` comes from a secrets manager and is not the example placeholder
- [x] Webhook HMAC secrets are encrypted at rest with AES-256-GCM and bound to the merchant id. Production boot fails without `WEBHOOK_ENCRYPTION_KEY`. `WEBHOOK_SECRETS_DEV_MODE=local` is refused in production
- [ ] Supply a production `WEBHOOK_ENCRYPTION_KEY` from a secrets manager. The example file does not contain one. Rotate by re-encrypting stored ciphertext
- [ ] Confirm the demo receiver on testnet still has its trustline after any testnet reset before showing a USDC QR
- [ ] `WEBHOOK_HOST_ALLOWLIST` lists real merchant hosts; `WEBHOOK_ALLOW_PUBLIC_HTTPS` stays false unless that list is set
- [ ] Horizon access through a provider you operate, with alerting on passphrase mismatch and cursor lag
- [ ] Reconciliation findings page an on-call. `settlement_paused` is enforced by whatever payout system exists. This repository does not pay out
- [ ] Database backups and a tested restore
- [ ] API key hashing is already SHA-256; add rate limits and key revocation in the merchant admin that this demo does not have
- [ ] A second person reviews a mainnet config change. This process still must not gain a signing seed
- [ ] If custody is ever required, build the external signer described in `docs/custody.md` instead of adding a seed column

## Explicitly out of scope

- Mainnet submission, Friendbot on mainnet (there is none), or gathering production credentials
- Soroban / Stellar Asset Contract transfer observation
- Muxed-account checkout as a first-class reference
- KYC, sanctions screening, or travel-rule payloads
- A Bridge adapter, and any claim that one was integration-tested
- Deploying to AWS or Contabo
