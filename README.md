# RH Layers

A layered, replayable asset-research pipeline with an animated architecture UI.

Eight governed stages run in order. Each stage has an explicit input, output and gate. If a gate fails the pipeline stops or the stage is skipped, instead of silently substituting data.

```
sources → clean → metrics → screen → signal → corr → build → backtest
   │         │        │        │        │        │       │        │
provenance  panel   risk     pool    states  cov+HRP  caps   walk-forward
```

## Quick start

```bash
pnpm install
pnpm run data       # 15y daily bars for the universe (public source)
pnpm pipeline       # run the eight layers, writes runs/latest.json
pnpm dev            # http://localhost:5173
```

The UI is result-first: Result (portfolio, KPIs, comparison), Process (the eight-stage replay), Data (funnel, gates, sources). It replays a recorded event log and never calls market data at runtime.

## Layers

| # | Layer | Input | Output | Gate |
|---|---|---|---|---|
| 1 | sources | universe + range | raw bars + provenance | ≥ 80% live, all resolved |
| 2 | clean | raw bars | weekly returns panel | gaps ≤ 10% |
| 3 | metrics | weekly panel | CAGR/vol/DD/tails | coverage ≥ 15 |
| 4 | screen | metrics + rules | pool + written reasons | pool ≥ 12 |
| 5 | signal | daily prices | entry/add/reduce/exit | coverage ≥ 12 |
| 6 | corr | weekly panel | shrunk cov + clusters | weight stability |
| 7 | build | cov + caps | weights under caps | caps + Σw = 1 |
| 8 | backtest | weights + panel | walk-forward + overlay | no look-ahead |

### Portfolio construction

- Correlation is estimated on weekly returns, shrunk toward a constant-correlation target (Ledoit-Wolf).
- Assets are clustered on correlation distance; caps apply per cluster, per asset class and per asset.
- Caps scale **downwards only**: if a cap binds, the residual becomes cash instead of levering up or breaching the limit.
- Default build mode is **momentum**: rank the pool by 12-month momentum, keep the top 20 above their 40-week average, size by inverse volatility, cap 10% per name. No class caps — the strategy may hold 100% equities, crypto, or cash.
- The HRP path remains available by setting `buildMode: 'hrp'`; it is shown as a benchmark, not the default.
- The backtest is walk-forward: weights at each rebalance use trailing data only, and the eligible set expands as assets build history.

### Overlays

- **Options** are modelled synthetically from realised volatility (covered call, protective put). They are reported separately and never enter the HRP solve.
- **Event contracts** (Kalshi/Polymarket style) are binary and terminal, so they are ring-fenced as a capped sleeve and excluded from the covariance matrix. If the source is unreachable, the sleeve is **blocked with weight 0** — no fixture is substituted.
- **Robinhood MCP** is an optional read-only adapter for positions and snapshots. Historical series come from public data. No order-placement tool is ever called.

## Data

- **Universe discovery**: Eastmoney US market list — every US-listed stock/ETF (~13.9k) with market cap, volume and turnover, plus every USD crypto pair on Binance.
- **Candidates**: top 400 liquid US stocks by market cap, top 120 ETFs by turnover, top 30 crypto pairs by 24h volume.
- **History**: Eastmoney backward-adjusted daily bars (≈ total return) for stocks/ETFs; Binance daily klines for crypto. 10y+ where available.
- **Scope**: 13,906 discovered → 550 candidates → 440 fetched → 129 in the covariance pool in the current run.
- **Options** are modelled synthetically from realised volatility; they are reported separately and never enter the HRP solve.
- **Event contracts** have no public history reachable from this environment, so the sleeve is blocked with weight 0 (fail-closed, no fixture).
- Raw data stays in `data/raw/` (git-ignored); only the derived run artifact is committed.

## Refresh

- Local: `pnpm refresh` (discover → fetch → pipeline → sync).
- Scheduled: `launchd` runs it daily at 07:00 (`ops/com.brickerp.rhlayers.daily.plist`).
- Cloud: GitHub Actions runs the same refresh daily at 06:00 UTC and deploys Pages; if a source is unreachable, the committed artifact is used.

## Commands

| command | purpose |
|---|---|
| `pnpm run data` | fetch raw bars |
| `pnpm pipeline` | run the pipeline |
| `pnpm dev` | dev UI |
| `pnpm build` | typecheck + static build |
| `pnpm -r typecheck` | typecheck all packages |

## Layout

```
packages/core/src/layers/   one file per stage + math
packages/cli/src/           data adapter + runner
apps/web/src/               replay UI (flow graph, layer views, timeline)
runs/                       run artifacts (git-ignored)
```

## Not investment advice

This is a research/engineering artifact. Backtests are conditional on one history and one set of assumptions; they are not promises of future returns. Nothing here places trades.
