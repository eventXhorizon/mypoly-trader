# Current State

Date: 2026-05-17

Current goal:

- Implement Stage 1A of Polymarket wallet screening.
- Stage 1A backfills a single wallet's public trades and closed positions, stores them in Postgres, and outputs a provisional score.

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
- `src/wallet-score.js`

Implementation status:

- Stage 1A code is implemented.
- `npm run wallet-score -- 0x...` reads public Data API trades and closed positions, writes local Postgres tables, and prints JSON scoring output.
- The command does not initialize live CLOB order execution and does not place orders.
- `eligible` remains false in Stage 1A because CLV and copy-slippage are not implemented yet.
- `provisionalEligible` marks wallets worth entering the next CLV/slippage validation step.

Recommended next implementation step:

- Add CLOB midpoint/spread/orderbook snapshot capture around target fills.
- Compute weighted CLV and copy slippage estimates.
- Surface wallet scores in the Web dashboard after scoring output is stable.
