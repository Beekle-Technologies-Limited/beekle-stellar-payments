# Source export manifest

This archive is a source snapshot for publication. It is not a git repository and it does not contain commit history.

| Item | Value |
| --- | --- |
| Project | beekle-stellar-payments |
| Owner and maintainer | Buchi Onwuasoanya, Beekle Technologies Limited |
| Source commit | `e154b8d91f4c9e9a093148ef8ba9799b9b007efb` |
| License field | `UNLICENSED` in `package.json`. No separate `LICENSE` file is in the source. Dependency licenses are not vendored; they apply when dependencies are installed from `package-lock.json`. |
| Ownership note | `docs/ownership.md` |

Naming Buchi Onwuasoanya as owner and maintainer states responsibility for the project. It does not mean every line was typed by hand, and this archive does not add a signature.

## Commands

```bash
npm ci
npm run lint
npm test
npm run test:e2e
npm run build
```

`npm run test:e2e` needs MySQL 8 and the variables in `.github/workflows/ci.yml`. `.env.example` is a local template. Do not commit a real `.env`.

## Verified on this commit before export

- `eslint "{src,test}/**/*.ts" --max-warnings 0` passed.
- Unit tests: 10 suites, 26 tests passed. Horizon is not called.
- MySQL integration tests: 11 tests passed.
- `npm run build` (`nest build`) passed.

## Not in this archive

Git history, `node_modules`, `dist`, coverage, logs, database dumps, a real `.env`, Stellar seeds, and generated demo API keys.

## Implementation limits

Testnet is the default. The process does not sign mainnet transactions. The recorded testnet demo funded an account and submitted a Circle USDC trustline; it did not transfer USDC. The payment that was observed and recognized was native testnet XLM. If that trustline cannot be confirmed, a payable demo is native XLM and is labeled as such, or no payment link is created. Friendbot does not dispense USDC. Webhook HMAC secrets are AES-256-GCM ciphertext; production boot requires an encryption key that is not in this archive. There is no payout signer. Bridge is separate and not connected. There is no production deployment.
