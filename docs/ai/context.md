# Project Context

Polymarket Terminal is a Node.js ESM trading terminal with copy trading, multi-wallet paper watching, market making, and sniper modes.

Important existing entry points:

- `src/multi-watch.js`: multi-wallet simulation watcher and Web dashboard.
- `src/services/multiWsWatcher.js`: RTDS activity WebSocket watcher for multiple wallets.
- `src/services/paperPortfolio.js`: local paper portfolio accounting.
- `src/services/pnlLedger.js`: Postgres PnL trade and snapshot ledger.
- `src/ui/webDashboard.js`: HTTP dashboard, settings API, SSE updates.

Current strategic direction:

- Build wallet screening and paper-follow validation inside the existing Node program first.
- Do not rewrite the whole program in Rust initially.
- Add Rust later only as an analysis worker for large historical backfills, CLV calculations, and bulk wallet scoring.

Primary documentation:

- `docs/wallet-selection-roadmap.zh-CN.md`: phased wallet screening and paper validation plan.
- `docs/trading-mode-guide.zh-CN.md`: current live vs simulation run modes.
- `docs/env-config-guide.zh-CN.md`: environment configuration guide.
