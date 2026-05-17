# Current State

Date: 2026-05-17

Current goal:

- Design and document a phased process for finding Polymarket wallets worth following.
- Prioritize wallets with positive long-term CLV, positive settled ROI, controlled drawdown, diversified profit sources, moderate frequency, and limited post-fill price deterioration.

Recent documentation added:

- `docs/wallet-selection-roadmap.zh-CN.md`
- `docs/ai/context.md`
- `docs/ai/current-state.md`
- `docs/ai/decisions.md`
- `docs/ai/validation.md`
- `docs/ai/risks.md`

Implementation status:

- Documentation only.
- No runtime code, database schema, config, dependency, or build changes have been made for wallet scoring yet.

Recommended next implementation step:

- Add database tables and service boundaries for historical wallet trades, market price snapshots, wallet scoring output, and paper validation status.
