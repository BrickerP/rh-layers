import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AssetClass, AssetSpec } from '@rh-layers/core';

/**
 * Universe discovery from Eastmoney's US market list:
 * every US-listed stock/ETF (≈13.9k) with market cap, volume and turnover.
 * Candidates = top liquid stocks by cap + top liquid ETFs by turnover.
 * History comes from the adjusted kline endpoint (backward-adjusted ≈ total return).
 */
const run = promisify(execFile);
const OUT = resolve(process.cwd(), '../../data/universe.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LIST = 'https://push2.eastmoney.com/api/qt/clist/get';
const FIELDS = 'f12,f13,f14,f20,f5,f6';

interface Row {
  f12: string;
  f13: number;
  f14: string;
  f20: number;
  f5: number;
  f6: number;
}

async function curlJson<T>(url: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { stdout } = await run('curl', ['-sS', '--max-time', '40', '-A', UA, url], { maxBuffer: 64 * 1024 * 1024 });
      if (stdout.trim()) return JSON.parse(stdout) as T;
      last = new Error('empty response');
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 + attempt * 1200));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function page(pn: number): Promise<{ total: number; rows: Row[] }> {
  const url = `${LIST}?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:105,m:106,m:107&fields=${FIELDS}`;
  const j = await curlJson<{ data?: { total?: number; diff?: Row[] } }>(url);
  return { total: j.data?.total ?? 0, rows: j.data?.diff ?? [] };
}

function etfClass(name: string): AssetClass {
  if (/债|国债|信用|MBS|TIPS|优先股/i.test(name)) return 'Fixed Income';
  if (/黄金|白银|贵金属|商品|原油|能源|农产品|铜|天然气/i.test(name)) return 'Commodity';
  if (/房地产|REIT|不动产/i.test(name)) return 'Real Estate';
  if (/基础设施|基建|公用事业/i.test(name)) return 'Real Assets';
  return 'Equity';
}

async function main() {
  await mkdir(resolve(process.cwd(), '../../data'), { recursive: true });
  const first = await page(1);
  const total = first.total || 13906;
  const pages = Math.ceil(total / 100);
  console.log(`discovering US market: ${total} instruments / ${pages} pages`);

  const rows: Row[] = [...first.rows];
  let pn = 2;
  const workers = Array.from({ length: 6 }, async () => {
    while (pn <= pages) {
      const p = pn++;
      try {
        const r = await page(p);
        rows.push(...r.rows);
      } catch {
        /* skip a page; the universe stays representative */
      }
    }
  });
  await Promise.all(workers);

  const stocks = rows.filter((r) => r.f20 > 0 && !/ETF|ETN/i.test(r.f14)).sort((a, b) => b.f20 - a.f20);
  const etfs = rows.filter((r) => /ETF|ETN/i.test(r.f14)).sort((a, b) => b.f6 - a.f6);
  const liquidStocks = stocks.filter((r) => r.f6 >= 5_000_000).slice(0, 400);
  const liquidEtfs = etfs.filter((r) => r.f6 >= 5_000_000).slice(0, 120);

  const assets: (AssetSpec & { assetType: string; rank: number; market: number })[] = [
    ...liquidStocks.map((r, i) => ({
      symbol: r.f12,
      name: r.f14,
      cls: 'Equity' as AssetClass,
      role: i < 20 ? ('core' as const) : ('satellite' as const),
      rationale: `US equity · $${(r.f20 / 1e9).toFixed(1)}B cap · $${(r.f6 / 1e6).toFixed(0)}M/day`,
      divYield: 0,
      assetType: 'stock',
      rank: i + 1,
      market: r.f13,
    })),
    ...liquidEtfs.map((r, i) => ({
      symbol: r.f12,
      name: r.f14,
      cls: etfClass(r.f14),
      role: i < 12 ? ('core' as const) : ('satellite' as const),
      rationale: `US ETF · $${(r.f6 / 1e6).toFixed(0)}M/day`,
      divYield: 0,
      assetType: 'etf',
      rank: 500 + i,
      market: r.f13,
    })),
  ];

  let cryptoSymbols: { symbol: string; name: string; volume: number }[] = [];
  let cryptoTotal = 0;
  try {
    const t = await curlJson<{ symbol: string; quoteVolume: string }[]>('https://data-api.binance.vision/api/v3/ticker/24hr');
    const pairs = t
      .filter((x) => x.symbol.endsWith('USDT'))
      .filter((x) => !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
      .map((x) => ({ symbol: `${x.symbol.slice(0, -4)}-USD`, name: x.symbol.slice(0, -4), volume: Number(x.quoteVolume) }))
      .filter((x) => Number.isFinite(x.volume) && x.volume > 0)
      .sort((a, b) => b.volume - a.volume);
    cryptoSymbols = pairs.slice(0, 30);
    cryptoTotal = pairs.length;
  } catch {
    console.log('crypto discovery unavailable');
  }

  const cryptoAssets = cryptoSymbols.map((c, i) => ({
    symbol: c.symbol,
    name: c.name,
    cls: 'Crypto' as AssetClass,
    role: 'satellite' as const,
    rationale: `crypto · $${(c.volume / 1e6).toFixed(0)}M 24h volume`,
    divYield: 0,
    assetType: 'crypto',
    rank: 1000 + i,
    market: 0,
  }));

  const all = [...assets, ...cryptoAssets];
  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      counts: {
        discovered: total,
        stocks: stocks.length,
        etfs: etfs.length,
        stocksLiquid: liquidStocks.length,
        etfsLiquid: liquidEtfs.length,
        cryptoPairs: cryptoTotal,
        cryptoCurated: cryptoSymbols.length,
        candidates: all.length,
      },
      assets: all,
    }),
  );
  console.log(`discovered ${total} · stocks ${stocks.length} · etfs ${etfs.length} · crypto ${cryptoTotal}`);
  console.log(`candidates ${all.length} (stocks ${liquidStocks.length}, etfs ${liquidEtfs.length}, crypto ${cryptoAssets.length})`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
