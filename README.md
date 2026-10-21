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

The UI replays the recorded event log. It does not call market data at runtime, so a run is reproducible and can be published as a static site.

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
- Weights come from Hierarchical Risk Parity, not mean-variance: expected returns are the least reliable input.
- The backtest is walk-forward: weights at each rebalance use trailing data only, and the eligible set expands as assets build history.

### Overlays

- **Options** are modelled synthetically from realised volatility (covered call, protective put). They are reported separately and never enter the HRP solve.
- **Event contracts** (Kalshi/Polymarket style) are binary and terminal, so they are ring-fenced as a capped sleeve and excluded from the covariance matrix. If the source is unreachable, the sleeve is **blocked with weight 0** — no fixture is substituted.
- **Robinhood MCP** is an optional read-only adapter for positions and snapshots. Historical series come from public data. No order-placement tool is ever called.

## Data

- Public daily bars via Yahoo Finance (cookie + crumb session, curl transport).
- Optional: `RH_MCP_TOKEN` enables the Robinhood MCP read-only historical adapter (split-adjusted prices + current distribution yield accrued as total return).
- When only split-adjusted prices exist, total return is approximated by accruing the current distribution yield. This is labelled in each series' provenance.
- Raw data stays under `data/raw/` and `data/.cache/` and is git-ignored. Only derived run artifacts are published.
- Secrets live in GitHub Actions secrets; nothing sensitive is committed.

## Demo

- `http://localhost:5173/?t=end` opens the completed run instead of replaying it.
- The UI is a static artifact: `runs/latest.json` is the whole input.

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
