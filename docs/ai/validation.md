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

## 2026-05-17 Stage 1B CLV And Liquidity Estimates

Changed:

- Added `wallet_trade_clv` and `wallet_trade_liquidity` tables.
- Added CLOB `/prices-history` lookup for recent historical trades.
- Added CLOB `/book` lookup for current-book copy-slippage estimates.
- Updated wallet scoring to include weighted CLV, CLV sample count, liquidity sample count, fillable rate, and copy slippage estimate.
- Stage is now `stage1b`.

Validation target:

- Syntax/import check for new module and modified scoring path.
- Run `npm run wallet-score -- --help`.
- Run one low-limit wallet score command against local Postgres and public APIs.

Validation performed:

- `node --check src/services/walletMarketData.js`
- `node --check src/services/walletAnalyticsDb.js`
- `node --check src/services/walletScorer.js`
- `node --check src/wallet-score.js`
- `node --check src/config/index.js`
- `npm run wallet-score -- --help`
- `DATABASE_URL=postgres://polymarket:polymarket_dev_password@127.0.0.1:15432/polymarket_terminal WALLET_ANALYTICS_TRADE_LIMIT=20 WALLET_ANALYTICS_CLOSED_POSITION_LIMIT=20 WALLET_ANALYTICS_CLV_LIMIT=5 npm run wallet-score -- 0x1111111111111111111111111111111111111111`

Results:

- Stage 1B table initialization succeeded against local Postgres.
- Empty sample wallet returned `stage=stage1b`, `score=0`, `eligible=false`, `provisionalEligible=false`.
- Empty sample wallet produced `marketData.analyzedTrades=0`, `clvSampleCount=0`, and `liquiditySampleCount=0`.

Known unverified:

- Need a real active wallet sample to validate CLV and orderbook payload normalization against non-empty trades.
- Current-book slippage is only a proxy until real-time post-fill snapshots are recorded.

## 2026-05-17 Multi-Watch Dashboard Analytics Panel

Changed:

- Added `analytics` state to the Web dashboard only for `multi-watch` mode.
- Added a `Wallet Analytics` panel that displays target wallet paper PnL, score, ROI, CLV, slippage, and last scoring time.
- Initialized wallet analytics DB in `multi-watch`.
- Fixed multi-watch WebSocket cleanup so terminating during connection setup does not emit an unhandled error.

Validation performed:

- `node --check src/ui/webDashboard.js`
- `node --check src/multi-watch.js`
- `node --check src/services/walletScorer.js`
- `node --check src/services/multiWsWatcher.js`
- Temporary smoke test: `WEB_PORT=8877 MULTI_WATCH_REQUIRE_DB=false DATABASE_URL=... TRADER_ADDRESSES=0x1111111111111111111111111111111111111111 npm run multi-watch`
- Queried `http://127.0.0.1:8877/api/state` and confirmed it returned `analytics.enabled=true` with the target wallet's Stage 1B score and metrics.

Known unverified:

- Browser visual rendering was not checked with a screenshot.
- A real scored wallet with non-empty CLV/liquidity metrics still needs to be tested.

## 2026-05-17 Dashboard Cross Links

Changed:

- Added `MULTI_WATCH_DASHBOARD_URL` and `LIVE_DASHBOARD_URL` config.
- Added a header navigation link in the shared Web dashboard.
- Live/copy-bot mode links to multi-watch.
- Multi-watch mode links to live-bot.

Validation performed:

- `node --check src/config/index.js`
- `node --check src/ui/webDashboard.js`
- Temporary smoke test: `WEB_PORT=8877 MULTI_WATCH_REQUIRE_DB=false DATABASE_URL=... TRADER_ADDRESSES=0x1111111111111111111111111111111111111111 LIVE_DASHBOARD_URL=http://127.0.0.1:8788 npm run multi-watch`
- Queried `http://127.0.0.1:8877/api/state` and confirmed `config.liveDashboardUrl` was present.

Known unverified:

- Browser visual rendering of the header link was not screenshot-tested.

## 2026-05-17 Same-Page Read-Only Targets Tab

Changed:

- Added a browser-style `Targets` tab to the shared Web dashboard page.
- Added a read-only target wallet report that combines wallet score metrics with stored paper PnL from `paper_trades` when that table exists.
- Added a read-only wallet analytics DB initializer for live/copy-bot mode.
- In live/copy-bot mode, target report refresh uses a short-lived cache and background query so the live dashboard refresh path does not wait on Postgres.

Validation performed:

- `node --check src/ui/webDashboard.js`
- `node --check src/bot.js`
- `node --check src/services/walletScorer.js`
- `node --check src/services/walletAnalyticsDb.js`
- `git diff --check`
- Temporary smoke test: `WEB_HOST=127.0.0.1 WEB_PORT=8877 MULTI_WATCH_REQUIRE_DB=false DATABASE_URL=... TRADER_ADDRESSES=0x1111111111111111111111111111111111111111 npm run multi-watch`
- Queried `http://127.0.0.1:8877/api/state` and confirmed it returned `targetReport.enabled=true` with the target wallet's score metrics and stored paper PnL.

Known unverified:

- Browser visual rendering of the new tab has not been screenshot-tested yet.
- Live-bot runtime smoke test was not run because that entry point requires real wallet credentials in `.env`.
- The smoke test used the existing multi-watch runtime, so it wrote local `portfolio_snapshots` as designed.

## 2026-05-17 Docker Live-Bot Postgres Wiring

Changed:

- Docker `live-bot` now overrides `DATABASE_URL` to `postgres://polymarket:polymarket_dev_password@postgres:5432/polymarket_terminal`.
- Docker `live-bot` now waits for the compose `postgres` health check before starting.
- Updated Chinese docs to explain that `.env` `127.0.0.1:15432` is for host commands, while Docker containers must use `postgres:5432`.
- Downgraded optional read-only wallet analytics connection failure from error to warning.

Validation performed:

- `docker compose config`
- `docker compose --profile live config`
- `docker compose --profile live config --services`
- `node --check src/services/walletAnalyticsDb.js`
- `node --check src/bot.js`

Known unverified:

- Did not restart VPS Docker services from this local session.
