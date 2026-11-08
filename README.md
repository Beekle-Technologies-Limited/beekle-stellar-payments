# Beekle Stellar payments

Owner and maintainer: **Buchi Onwuasoanya**, Beekle Technologies Limited. See [docs/ownership.md](docs/ownership.md).

Watch-only checkout for a **native Stellar payment** to a merchant's own account. The customer signs in their wallet. This service creates the invoice, shows a [SEP-7](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) request and QR code, observes Horizon, and records a double-entry recognition in MySQL.

It is new work for an SCF-style review. Stellar observation is **not** part of the current Beekle production platform. Nothing here is deployed, and it does not move mainnet funds.

Default network: **testnet**. Default asset: Circle's published Stellar testnet USDC, `USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, from [Circle's USDC address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) as read on 2026-11-07. This service does not issue that token. Friendbot does not dispense it.

SDK: `@stellar/stellar-sdk` 17.4.0. Classic payments use Horizon, not Soroban.

## What is real, mocked, or external

| Piece | Status |
| --- | --- |
| Intent creation, memo, expiry, idempotency, fixed-point amounts | Implemented. Covered by unit tests and MySQL integration tests |
| SEP-7 URI and QR | Implemented. Passphrase is included. No domain signature, no submit callback |
| Network passphrase guard | Implemented. Mainnet refused unless explicitly enabled. This process never signs |
| Horizon observation, operation re-fetch, cursor, duplicate protection | Implemented behind a `HorizonClient`. Integration tests use an in-memory fake. They do not call Horizon |
| Recognition ledger, partial / over / late / wrong-asset / suspense | Implemented and covered with the fake Horizon client against MySQL |
| Signed webhooks, backoff, allowlist, address pinning | Implemented. HMAC secrets are AES-256-GCM at rest. Integration tests use `127.0.0.1` only |
| Demo receiving account | Friendbot-funds a testnet account and submits a Circle USDC trustline when Horizon can see that issuer. The seed is not stored. If the trustline is not confirmed, the demo requests native XLM and says so. The customer page hides the QR until Horizon shows the account can receive the asset |
| Reconciliation and `settlement_paused` | Implemented against the same database. No payout worker exists to honor the flag |
| Opt-in testnet smoke (`npm run smoke:testnet`) | External. Not part of `npm test`. The recorded observation was a Friendbot **testnet XLM** payment. It was not a USDC transfer and not a mainnet payment. A `changeTrust` to Circle's testnet USDC issuer is a separate setup step. This source export does not store that transaction hash |
| Bridge adapter | Not implemented and not connected. Shared JSON is documented in `docs/provider-interface.md` and was not tested against Bridge |
| Custodial signer / KMS | Not implemented. See `docs/custody.md` |
| AWS, Contabo, production secrets | Not used |

## Self-custody

The merchant registers a public account id. Customers pay that account with the invoice memo. Beekle stores no Stellar seed and cannot refund. The ledger says an invoice was recognized; it does not hold the USDC. Details and the deliberate differences from the proposed lifecycle diagram are in `docs/architecture.md` and `docs/custody.md`.

## Run locally

Requirements: Node.js 22, MySQL 8.

```bash
cp .env.example .env
docker compose up -d mysql
npm ci
npm run db:migrate
npm start
```

The API and the checkout demo listen on [http://127.0.0.1:4317](http://127.0.0.1:4317). OpenAPI is at [http://127.0.0.1:4317/docs](http://127.0.0.1:4317/docs).

`docker compose up` also builds the API container, which runs migrations on boot. The database password in `.env.example` is a local development value, not a production secret.

Without Docker, point `DB_HOST` at any MySQL 8 with the user in `.env.example`.

The home page can create a checkout. Leaving the destination blank initializes a testnet account with Friendbot and submits a Circle USDC trustline when that issuer is visible. The seed stays in memory only for those setup transactions and is not stored or returned. If the trustline is not confirmed, and `XLM:native` is accepted, the checkout is labeled native XLM instead of USDC. A destination Horizon cannot show as able to receive the asset does not get a payment link, and the customer page withholds the QR in that case.

## API sketch

`POST /v1/merchants` with `stellar_destination` (public key only) and an optional allowlisted `webhook_url`. The API key and webhook secret are returned once.

`POST /v1/intents` with `Authorization: Bearer <api key>`, an `Idempotency-Key`, and:

```json
{
  "amount": "25.5000000",
  "asset_code": "USDC",
  "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "merchant_order_ref": "order-1001"
}
```

`amount` must be a string. A JSON number is rejected. More examples are in `docs/examples/requests.http`.

Public checkout: `GET /checkout/:id` and `GET /v1/checkout/:id`.

## Tests

```bash
npm test          # deterministic unit tests, no network
npm run test:e2e  # MySQL. Horizon is faked. Set DB_* as in .env.example and use database beekle_stellar_test
npm run lint
npm run smoke:testnet   # optional, spends nothing but Friendbot testnet XLM
```

CI is `.github/workflows/ci.yml`. It runs lint, unit tests, and the MySQL suite. It does not run the testnet smoke and does not deploy.

## Safety limits

- Testnet passphrase must be exactly `Test SDF Network ; September 2015` or the process will not boot.
- `STELLAR_ALLOW_MAINNET` defaults to false. Nothing in the recorded checks moved mainnet funds.
- The previously checked on-chain demo payment was native testnet XLM. It is not evidence of a USDC payment.
- Bridge is a separate provider. This service does not call it.
- Webhook hosts default to `localhost` and `127.0.0.1`. Arbitrary fetch URLs are not accepted on a payment.
- Observer failures do not advance the cursor past the failed record.
- Duplicate Horizon operations cannot credit twice (`network` + `operation_id`).

Read `docs/threat-model.md` and `docs/production-readiness.md` before treating any of this as ready for live funds. It is not.
