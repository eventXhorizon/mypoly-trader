# Risks

## Wallet screening risks

- High win rate can still have negative expected value.
- Total PnL can mostly reflect wallet size rather than skill.
- Leaderboard results can suffer from survivorship bias.
- Open PnL can overstate performance and must be separated from realized PnL.
- A wallet may have edge only in one market class, such as politics, sports, macro, or crypto.
- Profit concentrated in one or two markets should be heavily discounted.
- Some target fills may be uncopyable because they depend on speed, maker priority, private information, or thin orderbook liquidity.
- Copy-trade slippage can erase the entire expected edge.

## Implementation risks

- Historical Data API records and RTDS payloads may not expose identical fields.
- CLV requires reliable price snapshots after the target fill; missing snapshots should not be treated as neutral.
- Backfills can create API rate-limit pressure and should use bounded concurrency and retries.
- Postgres writes should avoid unbounded growth without retention or indexing plans.
- Live copy should remain gated; scoring output must not automatically trigger real orders.

## Operational risks

- The current multi-watch mode is paper-only. Live copy remains in separate single-wallet entry points.
- Any future live expansion must preserve hard position caps, daily loss limits, clear dry-run behavior, and dashboard-visible state.
