# Provider interface

Bridge is not implemented. Nothing in this repository was run against a Bridge API, and no cross-repo contract test exists.

The shapes below are the stable JSON this Stellar adapter already returns. A Bridge adapter could emit the same top-level fields with `provider: "bridge"` and a `data.bridge` object instead of `data.stellar`.

## Payment intent

`GET /v1/intents/:id` and the public `GET /v1/checkout/:id`:

```json
{
  "id": "uuid",
  "provider": "stellar",
  "merchant_order_ref": "order-1001",
  "status": "AWAITING_PAYMENT",
  "amount": "25.5000000",
  "received_amount": "0.0000000",
  "recognized_amount": "0.0000000",
  "asset": {
    "code": "USDC",
    "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "network": "testnet"
  },
  "destination": "G...",
  "reference": { "memo_type": "MEMO_TEXT", "memo": "..." },
  "expires_at": "2026-11-07T22:00:00.000Z",
  "provider_reference": null,
  "sep7_uri": "web+stellar:pay?...",
  "model": "self_custody_recognition"
}
```

`amount`, `received_amount`, and `recognized_amount` are decimal strings with 7 decimal places. They are not JSON numbers.

`provider_reference` is the Stellar transaction hash of the latest matched payment, when there is one.

## Normalized event

Outbound webhook body:

```json
{
  "id": "uuid",
  "type": "payment.credited",
  "provider": "stellar",
  "created_at": "2026-11-07T21:00:00.000Z",
  "data": {
    "intent_id": "uuid",
    "merchant_order_ref": "order-1001",
    "status": "CREDITED",
    "amount": "25.5000000",
    "received_amount": "25.5000000",
    "recognized_amount": "25.5000000",
    "asset": { "code": "USDC", "issuer": "G...", "network": "testnet" },
    "destination": "G...",
    "reference": { "memo_type": "MEMO_TEXT", "memo": "..." },
    "provider_reference": "hex transaction hash",
    "stellar": {
      "operation_id": "123",
      "transaction_hash": "hex",
      "paging_token": "123",
      "operation_type": "payment"
    }
  }
}
```

Event types used now: `payment.credited`, `payment.partial`, `payment.overpaid`, `payment.held`, `payment.expired`, `payment.review`, `payment.unmatched`.

The Stellar-specific object is `data.stellar`. Shared fields are everything else under `data`. A Bridge adapter would not reuse `data.stellar`.

## Webhook signature

Header `Beekle-Signature: t=<unix seconds>,v1=<hex hmac sha256>` over the exact bytes `` `${t}.${rawBody}` `` with the merchant webhook secret. Header `Beekle-Event-Id` repeats `id`. Receivers should reject timestamps older than five minutes and treat `id` as idempotent.

See `docs/examples/verify-webhook.mjs`.
