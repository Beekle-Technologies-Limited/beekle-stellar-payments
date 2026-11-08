# Custody

## What this service does

Inbound checkout is **merchant self-custody**.

- The merchant registers a Stellar account id (`G...`). Only the public key is stored.
- The customer signs the payment in their own wallet, using the SEP-7 request.
- Beekle watches Horizon. It does not co-sign, sponsor, or submit that payment.
- The MySQL ledger records that an invoice was paid. It is not a balance Beekle can withdraw.
- The destination account must already exist and must trust the asset. A missing trustline fails on the network, and this service simply never sees a successful payment.
- Beekle cannot refund. The merchant already has the funds in their account. If they return funds themselves, an operator can record that fact. The record is marked `on_chain_verified: false` and no transaction is submitted.

The demo can also generate a watch-only public key by encoding random bytes as an account id. No seed is created. That address cannot receive a successful payment until someone funds it, and nobody in this system can spend from it.

## What a custodial signer would be later

A future model where Beekle holds the receiving account would need:

- a destination account controlled outside this database
- signing in an external signer, HSM, or custody vendor
- no raw Stellar seed in MySQL, `.env`, logs, or this repository
- a separate payout flow with its own limits, approvals, and reconciliation pause

That signer is **not implemented**. There is no fake KMS, no local seed vault, and no "sign with a placeholder key" path in the API.

Webhook signing secrets are not Stellar keys. They are random server-side tokens used to HMAC outbound events. At rest they are AES-256-GCM ciphertext in `webhook_secret_ciphertext`, with the merchant id as authenticated data. Production boot refuses to start without `WEBHOOK_ENCRYPTION_KEY`. `WEBHOOK_SECRETS_DEV_MODE=local` keeps a process-only key in memory and is refused when `NODE_ENV=production`. The example environment does not contain a production key. This encryption does not cover a Stellar seed, because no seed is stored, and it is not a custodial signer.
