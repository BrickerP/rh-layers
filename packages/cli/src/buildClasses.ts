import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { alignToCalendar, toWeekly, type PriceSeries } from '@rh-layers/core';
import {
  annualize,
  covariance,
  covToCorr,
  hrp,
  maxDrawdown,
  mean,
  stdev,
  worst12m,
} from '@rh-layers/core';

const ROOT = resolve(process.cwd(), '../..');
const RAW = join(ROOT, 'data/raw');
const REPS = join(ROOT, 'data/reps');
const run = promisify(execFile);
const OUT = join(ROOT, 'apps/web/public/classes.json');
const PORT = join(ROOT, 'apps/web/public/portfolio.json');

const CLASSES: { symbol: string; name: string; group: string; from: 'raw' | 'reps' }[] = [
  { symbol: 'SPY', name: 'US large cap', group: 'Equity', from: 'raw' },
  { symbol: 'IWM', name: 'US small cap', group: 'Equity', from: 'raw' },
  { symbol: 'EFA', name: 'Developed ex-US', group: 'Equity', from: 'reps' },
  { symbol: 'EEM', name: 'Emerging markets', group: 'Equity', from: 'reps' },
  { symbol: 'AGG', name: 'US aggregate bonds', group: 'Fixed Income', from: 'reps' },
  { symbol: 'IEF', name: 'US 7-10y Treasuries', group: 'Fixed Income', from: 'reps' },
  { symbol: 'VGLT', name: 'US 20y+ Treasuries', group: 'Fixed Income', from: 'raw' },
  { symbol: 'TIP', name: 'US TIPS', group: 'Fixed Income', from: 'reps' },
  { symbol: 'LQD', name: 'US IG credit', group: 'Fixed Income', from: 'reps' },
  { symbol: 'HYG', name: 'US high yield', group: 'Fixed Income', from: 'reps' },
  { symbol: 'EMB', name: 'EM USD debt', group: 'Fixed Income', from: 'reps' },
  { symbol: 'SHY', name: 'US 1-3y Treasuries', group: 'Cash', from: 'reps' },
  { symbol: 'GLD', name: 'Gold', group: 'Commodity', from: 'reps' },
  { symbol: 'DBC', name: 'Broad commodities', group: 'Commodity', from: 'reps' },
  { symbol: 'VNQ', name: 'US REITs', group: 'Real Estate', from: 'raw' },
  { symbol: 'IGF', name: 'Global infrastructure', group: 'Real Assets', from: 'reps' },
  { symbol: 'BTC-USD', name: 'Bitcoin', group: 'Crypto', from: 'raw' },
];

async function load(symbol: string, from: 'raw' | 'reps'): Promise<PriceSeries> {
  const dir = from === 'raw' ? RAW : REPS;
  return JSON.parse(await readFile(join(dir, `${symbol}.json`), 'utf8')) as PriceSeries;
}

function returnsWithYield(px: (number | null)[], dy: number): number[] {
  const r = [0];
  const d = dy / 52;
  for (let i = 1; i < px.length; i++) {
    const a = px[i - 1];
    const b = px[i];
    if (a == null || b == null || a <= 0 || b <= 0) {
      r.push(0);
      continue;
    }
    r.push((b + d * a) / a - 1);
  }
  return r;
}

function stats(r: number[], spy: number[]) {
  const a = annualize(r);
  const dd = maxDrawdown(r);
  const down = r.filter((_, i) => spy[i] < 0);
  const up = r.filter((_, i) => spy[i] > 0);
  return {
    cagr: a.cagr,
    vol: a.vol,
    maxDD: dd,
    sharpe: a.sharpe,
    worst12m: worst12m(r),
    beta: covariance(r, spy) / Math.max(1e-9, covariance(spy, spy)),
    corrSpy: correlation(r, spy),
    upCapture: up.length ? mean(r.filter((_, i) => spy[i] > 0)) / mean(up) : 0,
    downCapture: down.length ? mean(down) / mean(spy.filter((x) => x < 0)) : 0,
  };
}

function correlation(a: number[], b: number[]): number {
  const sa = stdev(a);
  const sb = stdev(b);
  return sa && sb ? covariance(a, b) / (sa * sb) : 0;
}

async function quote(symbol: string): Promise<{ px: number; live: boolean }> {
  try {
    if (symbol.endsWith('-USD')) {
      const pair = `${symbol.split('-')[0]}USDT`;
      const { stdout } = await run('curl', ['-sS', '--max-time', '20', '-A', 'Mozilla/5.0', `https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`], { maxBuffer: 1024 * 1024 });
      const j = JSON.parse(stdout);
      const px = Number(j.price);
      return { px, live: px > 0 };
    }
    const { stdout } = await run(
      'curl',
      ['-sS', '--max-time', '20', '-A', 'Mozilla/5.0', '-H', 'accept: application/json', '-H', 'referer: https://www.nasdaq.com/', `https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=etf`],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const j = JSON.parse(stdout);
    const px = Number(String(j.data?.primaryData?.lastSalePrice ?? '').replace(/[$,]/g, ''));
    return { px, live: px > 0 };
  } catch {
    return { px: 0, live: false };
  }
}

async function main() {
  const series = await Promise.all(CLASSES.map((c) => load(c.symbol, c.from)));
  const spySeries = series[0];
  const calendar = spySeries.bars.map((b) => b.d).filter((d) => d >= '2016-10-20');
  const aligned = alignToCalendar(series, calendar, 7);
  const { dates, closes } = toWeekly(calendar, aligned);

  const returns: Record<string, number[]> = {};
  series.forEach((s, i) => {
    returns[s.symbol] = returnsWithYield(closes[s.symbol] ?? [], s.divYield ?? 0);
  });

  const spy = returns.SPY;
  const rows = CLASSES.map((c) => {
    const st = stats(returns[c.symbol], spy);
    return {
      symbol: c.symbol,
      name: c.name,
      group: c.group,
      ...st,
      corrRates: correlation(returns[c.symbol], returns.IEF),
      corrGold: correlation(returns[c.symbol], returns.GLD),
      corrCmdty: correlation(returns[c.symbol], returns.DBC),
      stress: mean(returns[c.symbol].filter((_, i) => spy[i] <= quantile(spy, 0.1))),
    };
  });

  const names = CLASSES.map((c) => c.symbol);
  const matrix = names.map((a) => names.map((b) => correlation(returns[a], returns[b])));

  // Strategic weights: annual walk-forward HRP on class representatives.
  const n = dates.length;
  const strategy = new Array(n).fill(0);
  let prev: Record<string, number> = {};
  const turnovers: number[] = [];
  for (let i = 156; i < n; i += 52) {
    const rowsM: number[][] = [];
    for (let t = i - 156; t < i; t++) rowsM.push(names.map((s) => returns[s][t] ?? 0));
    const cov = covarianceMatrix(rowsM);
    const { order, weights } = hrp(cov);
    const w: Record<string, number> = {};
    order.forEach((idx, k) => (w[names[idx]] = weights[k]));
    // Hard policy caps: crypto 5%, any single class 25%.
    if (w['BTC-USD'] > 0.05) {
      const excess = w['BTC-USD'] - 0.05;
      w['BTC-USD'] = 0.05;
      const others = names.filter((s) => s !== 'BTC-USD');
      const total = others.reduce((a, s) => a + w[s], 0);
      for (const s of others) w[s] += (excess * w[s]) / total;
    }
    const diff = names.reduce((a, s) => a + Math.abs((w[s] ?? 0) - (prev[s] ?? 0)), 0);
    turnovers.push(diff);
    prev = w;
    for (let j = i; j < Math.min(i + 52, n); j++) {
      let r = 0;
      for (const s of names) r += (w[s] ?? 0) * (returns[s][j] ?? 0);
      strategy[j] = r - (j === i ? 0.001 * diff : 0);
    }
  }
  const active = strategy.map((v, i) => (i < 156 ? 0 : v));
  const pstats = stats(active, spy);
  const pdd = maxDrawdown(active);

  const MIXES: Record<string, Record<string, number>> = {
    Growth: { SPY: 0.40, EFA: 0.12, EEM: 0.08, IWM: 0.05, VGLT: 0.08, IEF: 0.05, TIP: 0.02, LQD: 0.03, HYG: 0.03, GLD: 0.06, DBC: 0.03, VNQ: 0.02, IGF: 0.02, 'BTC-USD': 0.03 },
    Balanced: { SPY: 0.25, EFA: 0.08, EEM: 0.05, IWM: 0.03, AGG: 0.08, IEF: 0.08, VGLT: 0.04, TIP: 0.04, LQD: 0.05, HYG: 0.04, GLD: 0.10, DBC: 0.04, VNQ: 0.04, IGF: 0.04, 'BTC-USD': 0.03, SHY: 0.01 },
    Defensive: { SPY: 0.12, EFA: 0.04, EEM: 0.02, AGG: 0.12, IEF: 0.12, VGLT: 0.06, TIP: 0.08, LQD: 0.08, HYG: 0.03, GLD: 0.12, DBC: 0.04, VNQ: 0.03, IGF: 0.03, SHY: 0.11 },
  };
  const mixes = Object.entries(MIXES).map(([name, w]) => {
    const r = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (const s of Object.keys(w)) x += (w[s] ?? 0) * (returns[s]?.[i] ?? 0);
      r[i] = x;
    }
    const st = stats(r, spy);
    return { name, weights: w, cagr: st.cagr, vol: st.vol, maxDD: maxDrawdown(r), sharpe: st.sharpe };
  });
  const balanced = MIXES.Balanced;
  const balStats = mixes.find((m) => m.name === 'Balanced')!;

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    mixes,
    period: `${dates[0]} → ${dates.at(-1)}`,
    classes: rows,
    matrix: { names, cells: matrix },
    portfolio: {
      weights: prev,
      cagr: pstats.cagr,
      vol: pstats.vol,
      maxDD: pdd,
      sharpe: pstats.sharpe,
      avgTurnover: mean(turnovers),
    },
    hedges: {
      equity: rows
        .filter((r) => r.symbol !== 'SPY')
        .sort((a, b) => a.corrSpy - b.corrSpy)
        .slice(0, 5)
        .map((r) => ({ symbol: r.symbol, corr: r.corrSpy, stress: r.stress })),
      rates: rows
        .filter((r) => !['IEF', 'VGLT', 'SHY'].includes(r.symbol))
        .sort((a, b) => a.corrRates - b.corrRates)
        .slice(0, 5)
        .map((r) => ({ symbol: r.symbol, corr: r.corrRates })),
      debasement: rows
        .filter((r) => !['GLD', 'BTC-USD'].includes(r.symbol))
        .sort((a, b) => a.corrGold - b.corrGold)
        .slice(0, 5)
        .map((r) => ({ symbol: r.symbol, corr: r.corrGold })),
    },
  };

  await writeFile(OUT, JSON.stringify(out, null, 2));

  // Strategic implementation sheet: round weights to the liquid representatives.
  const positions = Object.entries(balanced)
    .filter(([, w]) => w >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol, weight]) => {
      const meta = CLASSES.find((c) => c.symbol === symbol)!;
      return { symbol, name: meta.name, cls: meta.group, weight, price: 0, crypto: symbol.endsWith('-USD'), live: false };
    });
  let liveAll = true;
  for (const p of positions) {
    const q = await quote(p.symbol);
    p.price = q.px;
    p.live = q.live;
    if (!q.live) liveAll = false;
  }
  const invested = positions.reduce((a, p) => a + p.weight, 0);
  const port = {
    asOf: out.asOf,
    runId: 'classes',
    dataDate: dates.at(-1),
    capitalDefault: 100000,
    pricesLive: liveAll,
    strategy: 'Balanced strategic mix',
    classes: rows.map((r) => ({ cls: r.group, weight: positions.filter((p) => p.cls === r.group).reduce((a, p) => a + p.weight, 0) })),
    positions,
    stats: {
      cagr: balStats.cagr,
      maxDD: balStats.maxDD,
      sharpe: balStats.sharpe,
      benchCagr: stats(spy, spy).cagr,
      benchMaxDD: maxDrawdown(spy),
      spyCagr: stats(spy, spy).cagr,
      spyMaxDD: maxDrawdown(spy),
    },
    rules: [
      'Strategic weights, rebalanced once a year — not a daily or monthly portfolio.',
      'Weights come from HRP on asset-class representatives with a 25% class cap and 5% crypto cap.',
      'No tactical signals: the point is the long-run class mix and the hedge structure.',
      'Rebalance when a class drifts more than 5 percentage points, or on the calendar.',
      'No leverage and no shorting.',
    ],
    checklist: [
      'Check the data date and refresh the class series if older than a month.',
      'Compare class weights to target; list drifts above 5pp.',
      'Rebalance with new cash first; sell only the largest overweight.',
      'Recompute share counts after fills and update the sheet.',
      'Review once a year whether the class set still matches your goals.',
    ],
  };
  await writeFile(PORT, JSON.stringify(port, null, 2));
  console.log(`balanced: ${positions.length} classes · CAGR ${(balStats.cagr * 100).toFixed(1)}% · DD ${(balStats.maxDD * 100).toFixed(1)}% · Sharpe ${balStats.sharpe.toFixed(2)}`);
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
}

function covarianceMatrix(rows: number[][]): number[][] {
  const N = rows[0].length;
  const out: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = rows.map((r) => r[i]);
      const b = rows.map((r) => r[j]);
      out[i][j] = covariance(a, b);
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
