import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const UA = 'Mozilla/5.0';

interface Template {
  symbol: string;
  name: string;
  cls: string;
  market?: number;
  split: number;
  crypto?: boolean;
  fallback: number;
}

const TEMPLATE: Template[] = [
  { symbol: 'SPY', name: 'S&P 500', cls: 'Equity', market: 107, split: 0.7, fallback: 769.98 },
  { symbol: 'EFA', name: 'Developed ex-US', cls: 'Equity', market: 107, split: 0.3, fallback: 104.26 },
  { symbol: 'AGG', name: 'US aggregate bonds', cls: 'Fixed Income', market: 107, split: 0.65, fallback: 95.42 },
  { symbol: 'VGLT', name: 'US long Treasuries', cls: 'Fixed Income', market: 105, split: 0.35, fallback: 51.532 },
  { symbol: 'GLD', name: 'Gold', cls: 'Commodity', market: 107, split: 0.6, fallback: 378.94 },
  { symbol: 'DBC', name: 'Broad commodities', cls: 'Commodity', market: 107, split: 0.4, fallback: 33.39 },
  { symbol: 'BTC-USD', name: 'Bitcoin', cls: 'Crypto', split: 0.6, crypto: true, fallback: 83399.63 },
  { symbol: 'ETH-USD', name: 'Ethereum', cls: 'Crypto', split: 0.4, crypto: true, fallback: 2464.69 },
  { symbol: 'IGF', name: 'Global infrastructure', cls: 'Real Assets', market: 105, split: 1, fallback: 64.41 },
  { symbol: 'VNQ', name: 'US REITs', cls: 'Real Estate', market: 107, split: 1, fallback: 92.62 },
];

async function curlJson(url: string): Promise<any> {
  const { stdout } = await run('curl', ['-sS', '--max-time', '20', '-A', UA, url], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function price(t: Template): Promise<{ px: number; live: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (t.crypto) {
        const pair = `${t.symbol.split('-')[0]}USDT`;
        const j = await curlJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`);
        const px = Number(j.price);
        if (px > 0) return { px, live: true };
      } else {
        const j = await curlJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${t.market}.${t.symbol}&fields=f43`);
        const scaled = Number(j.data?.f43);
        if (Number.isFinite(scaled) && scaled > 0) return { px: scaled / 1000, live: true };
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 900 + attempt * 800));
  }
  return { px: t.fallback, live: false };
}

async function main() {
  const runJson = JSON.parse(await readFile(join(ROOT, 'runs/latest.json'), 'utf8'));
  const universe = new Map((runJson.universe as any[]).map((u) => [u.symbol, u.cls]));
  const clsTotals: Record<string, number> = {};
  for (const [s, w] of Object.entries(runJson.weights as Record<string, number>)) {
    const c = universe.get(s) ?? 'Other';
    clsTotals[c] = (clsTotals[c] ?? 0) + w;
  }

  const positions = [];
  let allLive = true;
  for (const t of TEMPLATE) {
    const clsWeight = clsTotals[t.cls] ?? 0;
    const weight = clsWeight * t.split;
    const { px, live } = await price(t);
    if (!live) allLive = false;
    positions.push({
      symbol: t.symbol,
      name: t.name,
      cls: t.cls,
      weight,
      price: px,
      crypto: !!t.crypto,
      live,
    });
  }
  const total = positions.reduce((a, p) => a + p.weight, 0) || 1;
  for (const p of positions) p.weight /= total;

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    pricesLive: allLive,
    runId: runJson.runId,
    dataDate: runJson.weekly.dates.at(-1),
    capitalDefault: 100000,
    classes: Object.entries(clsTotals)
      .map(([cls, weight]) => ({ cls, weight }))
      .sort((a, b) => b.weight - a.weight),
    positions,
    stats: {
      cagr: runJson.backtest.stats['HRP core'].cagr,
      maxDD: runJson.backtest.stats['HRP core'].maxDD,
      sharpe: runJson.backtest.stats['HRP core'].sharpe,
      benchCagr: runJson.backtest.stats['60/40'].cagr,
      benchMaxDD: runJson.backtest.stats['60/40'].maxDD,
      spyCagr: runJson.backtest.stats['SPY buy & hold']?.cagr ?? 0,
      spyMaxDD: runJson.backtest.stats['SPY buy & hold']?.maxDD ?? 0,
    },
    rules: [
      'Rebalance every 6 months, or when a class drifts more than 5 percentage points.',
      'Use new contributions to top up underweight classes before selling anything.',
      'Crypto sleeve capped at 8% of the portfolio; rebalance back to target, do not let it compound past the cap.',
      'No leverage, no shorting, no options in the core portfolio.',
      'If cash appears because a cap binds, hold it in T-bills / money market, not in the risk assets.',
    ],
    checklist: [
      'Check the as-of date: if the data is older than 5 trading days, refresh before trading.',
      'Compare current class weights to the target table; list every drift above 5pp.',
      'Direct new cash to the largest underweight first; only sell if cash is unavailable.',
      'For each trade, use limit orders and check the spread; avoid the first/last 15 minutes.',
      'Recompute share counts with the latest prices after fills; update the target sheet.',
      'Log the trade date, reason (drift / contribution), and the resulting weights.',
    ],
  };

  await mkdir(join(ROOT, 'apps/web/public'), { recursive: true });
  await writeFile(join(ROOT, 'apps/web/public/portfolio.json'), JSON.stringify(out, null, 2));
  await writeFile(join(ROOT, 'runs/latest.portfolio.json'), JSON.stringify(out, null, 2));
  console.log(`portfolio: ${positions.length} positions · ${out.dataDate}`);
  console.log(positions.map((p) => `${p.symbol} ${(p.weight * 100).toFixed(1)}% @ ${p.price.toFixed(2)}`).join(' · '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
