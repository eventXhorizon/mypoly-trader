# Current State

Date: 2026-05-17

Current goal:

- Implement Stage 1B of Polymarket wallet screening.
- Stage 1B backfills a single wallet's public trades and closed positions, stores them in Postgres, enriches recent trades with CLOB price history/current orderbook estimates, and outputs a score.

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

Implementation status:

- Stage 1B code is implemented.
- `npm run wallet-score -- 0x...` reads public Data API trades and closed positions, enriches recent trades with CLOB `/prices-history` and `/book`, writes local Postgres tables, and prints JSON scoring output.
- The command does not initialize live CLOB order execution and does not place orders.
- `eligible` can become true only when historical metrics, weighted CLV, and current orderbook copy-slippage checks all pass.
- `eligible=true` means only "ready for 4-8 week paper follow", not "ready for live copy".

Recommended next implementation step:

- Surface wallet scores in the Web dashboard after scoring output is stable.
- Add real-time post-fill orderbook snapshots in multi-watch so paper follow can use actual observed copy prices rather than only current-book estimates.
