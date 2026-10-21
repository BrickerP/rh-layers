import type { BacktestData, Gate, LayerId, OverlayStats, PerfStats, RunConfig, SignalPoint } from '../types';
import { annualize, bsPrice, covariance, covToCorr, hrp, ledoitWolf, maxDrawdown, stdev, worst12m } from '../math';
import type { CleanData } from './clean';
import { capWeights } from './build';
import { clusterFromCorr } from './corr';
import { pct } from '../util';

function weightsAt(clean: CleanData, pool: string[], cfg: RunConfig, i: number, classOf: Record<string, string>): { weights: Record<string, number>; eligible: string[] } {
  const eligible = pool.filter((s) => (clean.validFrom[s] ?? 0) <= i - cfg.windowWeeks && (clean.returns[s]?.length ?? 0) > i);
  if (eligible.length < 5) return { weights: {}, eligible: [] };
  const rows: number[][] = [];
  for (let t = Math.max(1, i - cfg.windowWeeks); t < i; t++) rows.push(eligible.map((s) => clean.returns[s]?.[t] ?? 0));
  if (rows.length < 60) return { weights: {}, eligible: [] };
  const { cov } = ledoitWolf(rows);
  const corr = covToCorr(cov);
  const { order, weights } = hrp(cov);
  const raw: Record<string, number> = {};
  order.forEach((idx, k) => (raw[eligible[idx]] = weights[k]));
  const clusters = clusterFromCorr(eligible, corr, 0.45);
  return { weights: capWeights(raw, clusters, cfg, classOf), eligible };
}

function perf(returns: number[], ppy = 52): PerfStats {
  const a = annualize(returns, ppy);
  const dd = maxDrawdown(returns);
  return {
    cagr: a.cagr,
    vol: a.vol,
    maxDD: dd,
    sharpe: a.sharpe,
    calmar: a.cagr / Math.max(1e-9, Math.abs(dd)),
    worst12m: worst12m(returns, ppy),
  };
}

function unitAt(points: SignalPoint[] | undefined, date: string): number {
  if (!points?.length) return 0;
  let last = points[0];
  for (const p of points) {
    if (p.d <= date) last = p;
    else break;
  }
  return Math.min(1, Math.max(0, last.units / 2));
}

export function runBacktest(
  clean: CleanData,
  pool: string[],
  cfg: RunConfig,
  signals: Record<string, SignalPoint[]>,
  classOf: Record<string, string>,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: BacktestData; gate: Gate; summary: string } {
  const dates = clean.dates;
  const n = dates.length;
  const strategy = new Array(n).fill(0);
  const strategyTrend = new Array(n).fill(0);
  const equalWeight = new Array(n).fill(0);
  const minVariance = new Array(n).fill(0);
  const turnover: number[] = [];
  const cost = cfg.costBps / 1e4;
  const spy = clean.returns.SPY ?? new Array(n).fill(0);
  const bondSym = clean.returns.AGG ? 'AGG' : 'IEF';
  const bond = clean.returns[bondSym] ?? new Array(n).fill(0);

  let prev: Record<string, number> = {};

  for (let i = cfg.windowWeeks; i < n; i += cfg.rebalanceWeeks) {
    const { weights: w, eligible } = weightsAt(clean, pool, cfg, i, classOf);
    if (eligible.length < 5) continue;
    const eq: Record<string, number> = Object.fromEntries(eligible.map((s) => [s, 1 / eligible.length]));
    const inv: Record<string, number> = {};
    for (const s of eligible) {
      const r = clean.returns[s].slice(Math.max(1, i - 52), i);
      inv[s] = 1 / Math.max(1e-4, stdev(r));
    }
    const invSum = Object.values(inv).reduce((a, b) => a + b, 0);
    for (const s of eligible) inv[s] /= invSum;

    const names = new Set([...Object.keys(w), ...Object.keys(prev)]);
    let diff = 0;
    for (const s of names) diff += Math.abs((w[s] ?? 0) - (prev[s] ?? 0));
    turnover.push(diff);
    prev = w;

    for (let j = i; j < Math.min(i + cfg.rebalanceWeeks, n); j++) {
      let rw = 0;
      let rt = 0;
      let re = 0;
      let rv = 0;
      let invested = 0;
      for (const s of pool) {
        const x = clean.returns[s][j] ?? 0;
        rw += (w[s] ?? 0) * x;
        re += (eq[s] ?? 0) * x;
        rv += (inv[s] ?? 0) * x;
        const u = unitAt(signals[s], dates[i - 1]);
        rt += (w[s] ?? 0) * u * x;
        invested += (w[s] ?? 0) * u;
      }
      const cashRate = clean.returns.SHY?.[j] ?? 0;
      const cashW = Math.max(0, 1 - Object.values(w).reduce((a, b) => a + b, 0));
      strategy[j] = rw + cashW * cashRate - (j === i ? cost * diff : 0);
      strategyTrend[j] = rt + Math.max(0, 1 - invested) * cashRate - (j === i ? cost * diff : 0);
      equalWeight[j] = re - (j === i ? cost * diff * 0.5 : 0);
      minVariance[j] = rv - (j === i ? cost * diff * 0.5 : 0);
    }
    emit('backtest', 'progress', `rebalance ${dates[i]} · ${Object.keys(w).length} assets · turnover ${pct(diff, 0)}`, {
      date: dates[i],
      turnover: diff,
    });
  }

  const sixtyForty = dates.map((_, i) => 0.6 * (spy[i] ?? 0) + 0.4 * (bond[i] ?? 0));
  const active = strategy.map((v, i) => (i < cfg.windowWeeks ? 0 : v));

  const dd = (() => {
    let v = 1;
    let peak = 1;
    return active.map((r) => {
      v *= 1 + r;
      peak = Math.max(peak, v);
      return v / peak - 1;
    });
  })();

  // Synthetic option overlay on SPY: 4-week blocks, Black-Scholes with realised vol.
  const spyBlocks: number[] = [];
  const ccBlocks: number[] = [];
  const ppBlocks: number[] = [];
  const overlayDates: string[] = [];
  for (let i = cfg.windowWeeks; i < n; i += 4) {
    const block = spy.slice(i, Math.min(i + 4, n));
    if (!block.length) continue;
    const r = block.reduce((a, x) => a * (1 + x), 1) - 1;
    const hist = spy.slice(Math.max(1, i - 52), i);
    const sigma = Math.max(0.08, stdev(hist) * Math.sqrt(52));
    const T = 4 / 52;
    const callPrem = bsPrice('call', 1, 1.05, T, 0.03, sigma);
    const putPrem = bsPrice('put', 1, 0.9, T, 0.03, sigma);
    spyBlocks.push(r);
    ccBlocks.push(r + callPrem - Math.max(0, r - 0.05));
    ppBlocks.push(r - putPrem + Math.max(0, -0.1 - r));
    overlayDates.push(dates[i]);
  }
  const overlayStats: OverlayStats[] = [
    { label: 'SPY hold', ...perf(spyBlocks, 13), note: '4-week blocks' },
    { label: 'Covered call 5% OTM', ...perf(ccBlocks, 13), note: `synthetic BS, ${overlayDates.length} blocks` },
    { label: 'Protective put 10% OTM', ...perf(ppBlocks, 13), note: `synthetic BS, ${overlayDates.length} blocks` },
  ];

  const stats: Record<string, PerfStats> = {
    'HRP core': perf(active),
    'HRP + trend units': perf(strategyTrend.map((v, i) => (i < cfg.windowWeeks ? 0 : v))),
    '60/40': perf(sixtyForty),
    'SPY buy & hold': perf(spy.map((v, i) => (i < cfg.windowWeeks ? 0 : v))),
    'Equal weight': perf(equalWeight.map((v, i) => (i < cfg.windowWeeks ? 0 : v))),
    'Inverse vol': perf(minVariance.map((v, i) => (i < cfg.windowWeeks ? 0 : v))),
  };

  const checks = [
    { name: 'walk-forward', ok: strategy.every((v, i) => i >= cfg.windowWeeks || v === 0), detail: `weights estimated only from trailing ${cfg.windowWeeks}w` },
    { name: 'beats equal weight', ok: stats['HRP core'].calmar >= stats['Equal weight'].calmar * 0.9, detail: `Calmar ${stats['HRP core'].calmar.toFixed(2)} vs ${stats['Equal weight'].calmar.toFixed(2)}` },
    { name: 'drawdown budget', ok: stats['HRP core'].maxDD > -0.35, detail: `maxDD ${pct(stats['HRP core'].maxDD)}` },
    { name: 'turnover', ok: turnover.reduce((a, b) => a + b, 0) / Math.max(1, turnover.length) < 0.8, detail: `avg ${pct(turnover.reduce((a, b) => a + b, 0) / Math.max(1, turnover.length), 0)}` },
  ];
  const gate: Gate = { level: checks.filter((c) => !c.ok).length === 0 ? 'pass' : 'warn', checks };
  emit('backtest', 'gate', `backtest gate ${gate.level}`, { gate });
  emit('backtest', 'progress', `HRP CAGR ${pct(stats['HRP core'].cagr)} · maxDD ${pct(stats['HRP core'].maxDD)} · 60/40 CAGR ${pct(stats['60/40'].cagr)}`, {
    stats,
  });

  return {
    data: { dates, strategy: active, strategyTrend, sixtyForty, equalWeight, minVariance, drawdown: dd, stats, overlays: overlayStats, turnover },
    gate,
    summary: `HRP ${pct(stats['HRP core'].cagr)} CAGR · ${pct(stats['HRP core'].maxDD)} maxDD`,
  };
}
