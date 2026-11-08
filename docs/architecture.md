# Architecture

This service is the Stellar side of a Beekle checkout. It is new work. The attached lifecycle diagram is a proposal, not a description of a deployed system. The current business platform (NestJS, MySQL, AWS/Contabo) is not in this repository and was not modified.

## What runs here

```text
Merchant API  ->  payment intent (MySQL)
Customer      ->  SEP-7 URI / QR  ->  customer wallet signs and submits
Horizon       ->  observer cursor  ->  validate  ->  recognition ledger
                                      ->  signed webhook or merchant poll
```

No Soroban contract is required for a classic USDC payment. Circle's Stellar USDC transfer quickstart uses a payment operation through Horizon, and this service follows that shape.

## Corrections to the proposed diagram

The diagram is the right skeleton. These parts are implemented differently on purpose:

1. **Idempotency is the operation id, not only the transaction hash.** One transaction can contain more than one payment. Replaying a transaction hash is not enough to prevent a second credit. The unique key is `(network, operation_id)`.

2. **There is no automatic on-chain refund.** The inbound design is watch-only. Underpayment, overpayment, and late payment move into review balances. An operator can record that a refund happened elsewhere. This service does not submit that refund and does not pretend a KMS signed it.

3. **Wrong asset does not cancel the invoice.** A payment with the right memo but the wrong issuer is held and the intent stays `AWAITING_PAYMENT`, so the correct USDC payment can still arrive.

4. **Registration does not replay history.** The cursor starts at Horizon's current tip. Older payments are not booked unless an operator runs reconciliation from an earlier cursor. That avoids dumping an existing account's history into suspense.

5. **`DETECTED` is not a stored resting state.** Horizon's payments endpoint already returns operations from closed ledgers. Validation and recognition commit in one database transaction. The audit row is written at that commit, not backdated.

6. **`CREATED` is not stored separately.** Creating an intent registers it as `AWAITING_PAYMENT` in the same request. The diagram's two hops (merchant to checkout, checkout to orchestrator) are one API in this codebase.

7. **A second payment after a successful credit does not un-pay the invoice.** The extra amount is held and a review case is opened. The recognized amount stays at the invoice amount.

8. **Self-custody ledger is recognition, not custody.** `merchant_available` means the invoice is recognized. Beekle cannot pay it out, because the USDC already sits in the merchant's own account.

9. **SEP-7 always carries the network passphrase.** The diagram's QR step is implemented, and the passphrase is included so a wallet does not default the request to the public network. The URI is not domain-signed, and it has no callback. The wallet submits the transaction itself.

10. **Webhooks are not arbitrary URLs.** The destination is the URL stored on the merchant. The demo allowlist is localhost only, redirects are not followed, and the connection is pinned to a checked address.

## States

| Status | Meaning |
| --- | --- |
| `AWAITING_PAYMENT` | Invoice is open |
| `PARTIAL` | Some of the invoice asset arrived before expiry. It is held, not recognized |
| `OVERPAID` | More than the invoice arrived before recognition. Nothing is recognized until an operator accepts the invoice amount |
| `HELD` | The invoice was expired, or a payment arrived at or after expiry. Not recognized |
| `CREDITED` | Invoice amount is recognized. Webhook not yet acknowledged |
| `COMPLETED` | Webhook returned 2xx, or no webhook was configured |
| `EXPIRED` | No matching payment arrived before `expires_at` |

Review reasons include `WRONG_ASSET`, `UNMATCHED_MEMO`, `PARTIAL`, `OVERPAID`, `LATE_PAYMENT`, `EXCESS_AFTER_CREDIT`, `MUXED_DESTINATION`, and `INCONSISTENT_EVIDENCE`.

`EXTERNAL_REFUND_RECORDED` is a review resolution. It is not a chain transaction and it is not the diagram's `REFUNDED` branch.

## Observation rules

A payment is recognized only when all of these hold:

- Horizon root passphrase matches the configured network
- The listed payment, the re-fetched operation, and the re-fetched transaction agree
- The transaction and the operation are successful
- `to` is the watched merchant account
- The transaction memo matches the intent exactly
- Asset code and issuer match the intent exactly (`XLM` has a null issuer)
- The running received total equals the invoice before expiry
- The operation id has not been booked before

Accepted operation types are `payment`, `path_payment_strict_receive`, and `path_payment_strict_send`. On those records Horizon's `amount` is the destination asset received. Source amounts are ignored. `create_account`, claimable balances, and Soroban invocations are not treated as USDC payments.

Muxed (`M...`) payments are held for review rather than auto-matched, because this checkout routes with a memo.

## Accounts

Classic Stellar accounts (`G...`) plus a `MEMO_TEXT` reference of at most 28 bytes. Memos are unique per network and destination.

Amounts are decimal strings with at most 7 decimal places, stored as `DECIMAL(20,7)`, and compared as integer stroops. JSON numbers are rejected.
