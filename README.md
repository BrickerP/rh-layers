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
pnpm refresh        # extend sleeve history + re-estimate the frontier (data/sleeves → apps/web/public/frontier.json)
pnpm dev            # http://localhost:5173
```

The default page is the **Frontier**: the estimated Pareto frontier for the digital-economy thesis
(SPY, AI compute, memory & storage, power, model platforms, space, robotics, BTC, ETH, cash, gold),
next to a walk-forward test of what following each rule actually delivered. **Portfolio** turns the
selected point into tickers and share counts. **Classes** is a reference table of asset-class
correlations and hedges. **Process** / **Data** replay the broad 8-layer research pipeline.

### Frontier method

- Weekly returns, annual rebalance, long-only, max 25% per risky sleeve (cash uncapped).
- Drawdown is the risk axis. Max drawdown is path-dependent and not convex, so the frontier comes from a
  deterministic candidate search (corners, pairs, sparse random mixes, mean-variance seeds, local refinement)
  followed by non-dominated filtering.
- Estimates use a 50% alpha haircut toward a CAPM prior (beta to SPY, cash as risk-free): each sleeve keeps
  half of its historical excess over what its beta explains.
- Walk-forward: from year 3 on, the frontier is re-estimated each year on past data only, the weights at each
  drawdown target are held for 52 weeks, and the realised returns are chained.
- The robust family holds a fixed basket (equal weight with or without gold, or the hand-set thesis mix)
  and only estimates the cash share needed to stay within the drawdown target.
- The sleeves themselves were chosen in 2026 with hindsight; the walk-forward tests the weighting rule, not the theme.

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

## Data

- `data/sleeves/` (committed): one file per vehicle. History seeded from Eastmoney backward-adjusted
  closes (total return) where available, otherwise Nasdaq daily closes plus a constant distribution yield
  (SMH, UFO, BOTZ, GLD, VST). Crypto from Binance. Each file records its basis.
- Daily extension appends Nasdaq/Binance closes; appended days on total-return series accrue the yield.
- Quotes used for share counts are real last prices, not adjusted levels.
- The broad research pipeline (Process/Data) uses `data/raw/` (git-ignored) and is refreshed manually with
  `pnpm refresh:pipeline`.

## Refresh

- Every deploy (daily cron at 22:30 UTC and every push) runs `pnpm sleeves` (continue-on-error) →
  `pnpm frontier` → build → deploy, so the deployed numbers are always as of the last close.
- If a data source is unreachable the committed `data/sleeves/` history is used as-is; the page shows the
  `generated` date and the last quote date.

## Commands

| command | purpose |
|---|---|
| `pnpm refresh` | extend sleeve data and rebuild the frontier |
| `pnpm sleeves` | fetch/extend sleeve vehicles only |
| `pnpm frontier` | rebuild `frontier.json` from committed sleeves |
| `pnpm classes` | rebuild the asset-class reference table |
| `pnpm refresh:pipeline` | rerun the broad 8-layer pipeline (Process/Data) |
| `pnpm dev` / `pnpm build` | dev server / typecheck + static build |

## Layout

```
packages/core/src/layers/   one file per stage + math
packages/cli/src/           sleeve fetch, frontier build, pipeline runner
apps/web/src/               replay UI (flow graph, layer views, timeline)
runs/                       run artifacts (git-ignored)
```

## Not investment advice

This is a research/engineering artifact. Backtests are conditional on one history and one set of assumptions; they are not promises of future returns. Nothing here places trades.
