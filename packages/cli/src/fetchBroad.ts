import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AssetSpec, Bar, PriceSeries } from '@rh-layers/core';

const run = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const UNIVERSE = join(ROOT, 'data/universe.json');
const RAW = join(ROOT, 'data/raw');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type Asset = AssetSpec & { assetType: 'stock' | 'etf' | 'crypto'; rank: number; market: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function curlJson<T>(url: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { stdout } = await run('curl', ['-sS', '--max-time', '60', '-A', UA, url], { maxBuffer: 64 * 1024 * 1024 });
      if (stdout.trim()) return JSON.parse(stdout) as T;
      last = new Error('empty response');
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 + attempt * 1200));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function eastmoneyHistory(market: number, symbol: string): Promise<Bar[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${encodeURIComponent(symbol)}&fields1=f1&fields2=f51,f53&klt=101&fqt=2&beg=20100101&end=20500101`;
  const j = await curlJson<{ data?: { klines?: string[] } }>(url);
  const rows = j.data?.klines ?? [];
  const bars: Bar[] = [];
  for (const line of rows) {
    const [d, c] = line.split(',');
    const close = Number(c);
    if (!d || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ d, c: close });
  }
  if (bars.length < 260) throw new Error(`only ${bars.length} bars`);
  return bars;
}

async function binanceDaily(symbol: string): Promise<Bar[]> {
  const pair = `${symbol.split('-')[0]}USDT`;
  const bars: Bar[] = [];
  let start = Date.parse('2017-01-01T00:00:00Z');
  for (let pageNo = 0; pageNo < 8; pageNo++) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&startTime=${start}`;
    const rows = await curlJson<unknown[][]>(url);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const c = Number(row[4]);
      if (Number.isFinite(c) && c > 0) bars.push({ d: new Date(Number(row[0])).toISOString().slice(0, 10), c });
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][6]) + 1;
  }
  if (bars.length < 260) throw new Error(`only ${bars.length} crypto bars`);
  return bars;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<string>): Promise<string[]> {
  const out: string[] = [];
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        out.push(await fn(item));
      } catch (e) {
        out.push(`FAIL ${String(e).slice(0, 100)}`);
      }
      await sleep(80);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  await mkdir(RAW, { recursive: true });
  const u = JSON.parse(await readFile(UNIVERSE, 'utf8')) as { assets: Asset[] };
  const traditional = u.assets.filter((a) => a.assetType !== 'crypto');
  const crypto = u.assets.filter((a) => a.assetType === 'crypto');
  console.log(`fetching ${traditional.length} stocks/ETFs + ${crypto.length} crypto`);

  const lines = await pool(traditional, 3, async (a) => {
    const file = join(RAW, `${a.symbol.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
    try {
      await access(file);
      return `${a.symbol} cached`;
    } catch {
      /* fetch below */
    }
    let bars: Bar[];
    try {
      bars = await eastmoneyHistory(a.market, a.symbol);
    } catch (e) {
      await sleep(900);
      bars = await eastmoneyHistory(a.market, a.symbol);
    }
    const series: PriceSeries = {
      symbol: a.symbol,
      name: a.name,
      cls: a.cls,
      role: a.role,
      rationale: a.rationale,
      divYield: 0,
      source: 'eastmoney:kline (backward-adjusted)',
      provenance: 'live',
      bars,
    } as PriceSeries;
    await writeFile(file, JSON.stringify(series));
    return `${a.symbol} ${bars.length}`;
  });

  const clines = await pool(crypto, 4, async (a) => {
    const bars = await binanceDaily(a.symbol);
    const series: PriceSeries = {
      symbol: a.symbol,
      name: a.name,
      cls: 'Crypto',
      role: a.role,
      rationale: a.rationale,
      divYield: 0,
      source: 'binance:vision',
      provenance: 'live',
      bars,
    } as PriceSeries;
    await writeFile(join(RAW, `${a.symbol}.json`), JSON.stringify(series));
    return `${a.symbol} ${bars.length}`;
  });

  const all = [...lines, ...clines];
  const fails = all.filter((l) => l.startsWith('FAIL'));
  console.log(`saved ${all.length - fails.length} · failed ${fails.length}`);
  if (fails.length) console.log(fails.slice(0, 12).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
