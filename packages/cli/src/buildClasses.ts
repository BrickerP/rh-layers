import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { alignToCalendar, annualize, covariance, maxDrawdown, mean, stdev, toWeekly, worst12m, type PriceSeries } from '@rh-layers/core';

const ROOT = resolve(process.cwd(), '../..');
const RAW = join(ROOT, 'data/raw');
const REPS = join(ROOT, 'data/reps');
const OUT = join(ROOT, 'apps/web/public/classes.json');

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

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    period: `${dates[0]} → ${dates.at(-1)}`,
    classes: rows,
    matrix: { names, cells: matrix },
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

  console.log(`classes: ${rows.length} · ${dates[0]} → ${dates.at(-1)}`);
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
