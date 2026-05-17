# Decisions

## 2026-05-17: Start wallet screening inside the existing Node program

Decision:

- Implement wallet screening, scoring, dashboard review, and paper-follow validation in the current Node.js codebase first.
- Do not start by rewriting the full system in Rust.

Rationale:

- Existing code already has multi-wallet watching, paper portfolio accounting, Postgres PnL recording, and a Web dashboard.
- Rewriting these execution and UI paths would duplicate existing working boundaries.
- Rust is still a good later fit for large historical backfills, CLV calculation, and bulk scoring workers.

## 2026-05-17: Screening must optimize for copyable edge, not headline win rate

Decision:

- Candidate wallet ranking should prioritize positive CLV, positive settled ROI, controlled drawdown, low profit concentration, moderate frequency, and low copy slippage.
- High win rate alone is not an eligibility criterion.

Rationale:

- Prediction markets can produce high win rates with negative expected value when positions are mostly high-probability, low-upside bets.
- Copy trading depends on reachable execution price, not only whether the target wallet was directionally correct.

## 2026-05-17: Paper follow for 4-8 weeks before any live copy expansion

Decision:

- A candidate wallet must go through 4-8 weeks of paper follow using realistic copy prices before being considered for small live allocation.

Rationale:

- Historical performance can be distorted by stale markets, one-off trades, survivorship bias, and uncopyable fills.
- Paper follow validates the actual latency, spread, slippage, skipped-trade rate, and realized PnL of this system.

## 2026-05-17: Dashboard analytics are same-page read-only

Decision:

- Show wallet analytics and paper-follow PnL through a same-page `Targets` tab in the shared Web dashboard.
- The live copy-bot dashboard may initialize a read-only wallet analytics DB connection, but it must not create analytics tables, mutate scoring records, start multi-watch runtime, or trigger real orders from analytics data.
- Keep the live trading state in the existing `Live` tab.

Rationale:

- The user wants a browser-tab-like view inside the same program instead of a separate port/page.
- Candidate screening and paper follow validation are observability workflows, not execution workflows.
- Read-only cached dashboard queries reduce coupling to live copy refresh and preserve the existing order execution boundary.
