# Current State

Date: 2026-05-17

Current goal:

- Show target-wallet analytics and latest paper PnL in the Web dashboard without affecting live copy pages.

Recent changes:

- `docs/wallet-selection-roadmap.zh-CN.md`
- `docs/ai/context.md`
- `docs/ai/current-state.md`
- `docs/ai/decisions.md`
- `docs/ai/validation.md`
- `docs/ai/risks.md`
- `src/services/walletAnalyticsDb.js`
- `src/services/walletBackfill.js`
- `src/services/walletScorer.js`
- `src/services/walletMarketData.js`
- `src/wallet-score.js`
- `src/ui/webDashboard.js`
- `src/multi-watch.js`
- `src/services/multiWsWatcher.js`

Implementation status:

- Stage 1B code is implemented.
- `npm run wallet-score -- 0x...` reads public Data API trades and closed positions, enriches recent trades with CLOB `/prices-history` and `/book`, writes local Postgres tables, and prints JSON scoring output.
- The command does not initialize live CLOB order execution and does not place orders.
- `eligible` can become true only when historical metrics, weighted CLV, and current orderbook copy-slippage checks all pass.
- `eligible=true` means only "ready for 4-8 week paper follow", not "ready for live copy".
- The Web dashboard now includes a `Wallet Analytics` panel only when `config.dashboardMode === 'multi-watch'`.
- The live copy-bot dashboard does not query or display wallet analytics.
- A multi-watch shutdown edge case was fixed by swallowing WebSocket errors after listeners are removed during cleanup.

Recommended next implementation step:

- Add real-time post-fill orderbook snapshots in multi-watch so paper follow can use actual observed copy prices rather than only current-book estimates.
- Add a dashboard action to run/refresh `wallet-score` for selected targets from the UI if manual CLI refresh becomes inconvenient.
