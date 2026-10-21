import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const UA = 'Mozilla/5.0';

async function curlJson(url: string): Promise<any> {
  const headers = url.includes('nasdaq.com') ? ['-H', 'accept: application/json', '-H', 'referer: https://www.nasdaq.com/'] : [];
  const { stdout } = await run('curl', ['-sS', '--max-time', '20', '-A', UA, ...headers, url], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function quote(symbol: string, market: number | undefined): Promise<{ px: number; live: boolean }> {
  if (symbol.endsWith('-USD')) {
    try {
      const pair = `${symbol.split('-')[0]}USDT`;
      const j = await curlJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`);
      const px = Number(j.price);
      if (px > 0) return { px, live: true };
    } catch {
      /* fall through */
    }
    return { px: 0, live: false };
  }
  const markets = market ? [market] : [105, 106, 107];
  for (const m of markets) {
    try {
      const j = await curlJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${m}.${symbol}&fields=f43`);
      const scaled = Number(j.data?.f43);
      if (Number.isFinite(scaled) && scaled > 0) return { px: scaled / 1000, live: true };
    } catch {
      /* fall through to Nasdaq */
    }
  }
  for (const assetclass of ['stocks', 'etf']) {
    try {
      const j = await curlJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetclass}`);
      const raw = j.data?.primaryData?.lastSalePrice as string | undefined;
      const px = Number((raw ?? '').replace(/[$,]/g, ''));
      if (Number.isFinite(px) && px > 0) return { px, live: true };
    } catch {
      /* try next */
    }
  }
  return { px: 0, live: false };
}

async function main() {
  const runJson = JSON.parse(await readFile(join(ROOT, 'runs/latest.json'), 'utf8'));
  const universe = new Map((runJson.universe as any[]).map((u) => [u.symbol, u]));
  const weights = runJson.weights as Record<string, number>;
  const positions = [];
  let liveAll = true;

  for (const [symbol, weight] of Object.entries(weights).sort((a, b) => b[1] - a[1])) {
    const u = universe.get(symbol);
    const q = await quote(symbol, u?.market);
    if (!q.live) liveAll = false;
    positions.push({
      symbol,
      name: u?.name ?? symbol,
      cls: u?.cls ?? 'Other',
      weight,
      price: q.px,
      crypto: symbol.endsWith('-USD'),
      live: q.live,
    });
  }

  const stats = runJson.backtest.stats['HRP core'];
  const spy = runJson.backtest.stats['SPY buy & hold'] ?? { cagr: 0, maxDD: 0 };
  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    runId: runJson.runId,
    dataDate: runJson.weekly.dates.at(-1),
    capitalDefault: 100000,
    pricesLive: liveAll,
    strategy: runJson.strategyLabel ?? 'Momentum 20',
    classes: Object.entries(
      positions.reduce<Record<string, number>>((a, p) => {
        a[p.cls] = (a[p.cls] ?? 0) + p.weight;
        return a;
      }, {}),
    )
      .map(([cls, weight]) => ({ cls, weight }))
      .sort((a, b) => b.weight - a.weight),
    positions,
    stats: {
      cagr: stats.cagr,
      maxDD: stats.maxDD,
      sharpe: stats.sharpe,
      benchCagr: spy.cagr,
      benchMaxDD: spy.maxDD,
      spyCagr: spy.cagr,
      spyMaxDD: spy.maxDD,
    },
    rules: [
      'Rebalance every 6 months: rerank the universe by 12-month momentum, keep the top 20 above their 40-week average.',
      'Size by inverse volatility; no single position above 10% of NAV.',
      'No class caps: the strategy may hold 100% equities, crypto, or cash. It goes where momentum is.',
      'If fewer than 20 names qualify, the remainder stays in T-bills / money market.',
      'No leverage and no shorting in the core sleeve.',
    ],
    checklist: [
      'Refresh the run and confirm the as-of date is within 5 trading days.',
      'Compare current holdings to the new top-20 list; list exits and entries.',
      'Enter new names at 1/20 risk weight; trim any position above 10%.',
      'Use limit orders and avoid the first/last 15 minutes of the session.',
      'Recompute share counts after fills and update this sheet.',
      'Log turnover, reason (rerank), and the new weights.',
    ],
  };

  await mkdir(join(ROOT, 'apps/web/public'), { recursive: true });
  await writeFile(join(ROOT, 'apps/web/public/portfolio.json'), JSON.stringify(out, null, 2));
  await writeFile(join(ROOT, 'runs/latest.portfolio.json'), JSON.stringify(out, null, 2));
  console.log(`portfolio: ${positions.length} positions · ${out.dataDate} · ${out.strategy}`);
  console.log(positions.slice(0, 10).map((p) => `${p.symbol} ${(p.weight * 100).toFixed(1)}% @ ${p.price.toFixed(2)}`).join(' · '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
