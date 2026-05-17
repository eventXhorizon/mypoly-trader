# Validation

## 2026-05-17 Documentation Update

Changed:

- Added the wallet screening and paper validation roadmap.
- Added AI project memory files under `docs/ai/`.

Validation performed:

- Documentation was reviewed for consistency with the existing Node.js architecture described in `README.md` and `AGENT.MD`.
- No code or configuration was changed.

Not run:

- `npm test` or runtime commands, because this was a documentation-only change and the project does not define a test script in `package.json`.

Remaining validation for future implementation:

- Verify Data API and CLOB API response fields against live responses before implementing historical backfill.
- Validate CLV calculations on known trades by comparing stored target fill prices with subsequent midpoint/orderbook snapshots.
- Run `npm run multi-watch` in simulation after adding scoring/dashboard code.

## 2026-05-17 Stage 1A Wallet Analytics

Changed:

- Added wallet analytics Postgres tables.
- Added single-wallet historical backfill from public Data API trades and closed positions.
- Added Stage 1A scoring for sample size, settled ROI, profit factor, drawdown, profit concentration, and trading frequency.
- Added `npm run wallet-score`.

Validation target:

- Syntax/import check for new modules.
- Run `npm run wallet-score -- --help`.
- If Postgres is reachable, run a DB initialization and top-score query.

Validation performed:

- `node --check src/wallet-score.js`
- `node --check src/services/walletAnalyticsDb.js`
- `node --check src/services/walletBackfill.js`
- `node --check src/services/walletScorer.js`
- `node --check src/config/index.js`
- `node --check src/utils/proxy.js`
- `npm run wallet-score -- --help`
- `DATABASE_URL=postgres://polymarket:polymarket_dev_password@127.0.0.1:15432/polymarket_terminal npm run wallet-score -- --top 5`
- `DATABASE_URL=postgres://polymarket:polymarket_dev_password@127.0.0.1:15432/polymarket_terminal WALLET_ANALYTICS_TRADE_LIMIT=20 WALLET_ANALYTICS_CLOSED_POSITION_LIMIT=20 npm run wallet-score -- 0x1111111111111111111111111111111111111111`

Results:

- DB table initialization succeeded after starting local Postgres with `npm run db:up`.
- `--top 5` returned JSON successfully.
- The zero-activity sample wallet returned zero fetched trades, zero closed positions, `score=0`, and `provisionalEligible=false`.
- Node fetch needed standard `HTTPS_PROXY`/`HTTP_PROXY` compatibility in this environment; proxy support now falls back to those variables when `PROXY_URL` is unset.

Known unverified:

- Live Data API field variations across wallets still need to be tested with real wallet examples.
- Stage 1A intentionally does not compute CLV or copy slippage yet.
