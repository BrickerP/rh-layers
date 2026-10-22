import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

/**
 * Sleeve vehicles for the frontier. One committed file per vehicle in data/sleeves/.
 *
 * History policy:
 *  - seeded once from the local cache (Eastmoney backward-adjusted = total return,
 *    or Nasdaq price-only + constant yield accrual);
 *  - extended daily from Nasdaq (stocks/ETFs) or Binance (crypto). Appended bars are
 *    price-only, so yield accrual applies after `appendedFrom` even for adjusted series.
 * Quotes are real, unadjusted last prices used only for share counts.
 */
const run = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const OUT = join(ROOT, 'data/sleeves');
const RAW = join(ROOT, 'data/raw');
const REPS = join(ROOT, 'data/reps');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type Kind = 'etf' | 'stock' | 'crypto';
interface Vehicle {
  symbol: string;
  kind: Kind;
  divYield: number;
}
interface Bar {
  d: string;
  c: number;
}
export interface SleeveFile {
  symbol: string;
  kind: Kind;
  adjusted: boolean;
  appendedFrom?: string;
  divYield: number;
  source: string;
  bars: Bar[];
  quote?: { price: number; asOf: string; source: string };
}

export const VEHICLES: Vehicle[] = [
  { symbol: 'SPY', kind: 'etf', divYield: 0.012 },
  { symbol: 'SMH', kind: 'etf', divYield: 0.005 },
  { symbol: 'MU', kind: 'stock', divYield: 0.003 },
  { symbol: 'WDC', kind: 'stock', divYield: 0.002 },
  { symbol: 'STX', kind: 'stock', divYield: 0.02 },
  { symbol: 'VST', kind: 'stock', divYield: 0.006 },
  { symbol: 'CEG', kind: 'stock', divYield: 0.005 },
  { symbol: 'ETN', kind: 'stock', divYield: 0.012 },
  { symbol: 'PWR', kind: 'stock', divYield: 0.002 },
  { symbol: 'NEE', kind: 'stock', divYield: 0.028 },
  { symbol: 'MSFT', kind: 'stock', divYield: 0.007 },
  { symbol: 'GOOGL', kind: 'stock', divYield: 0.004 },
  { symbol: 'META', kind: 'stock', divYield: 0.003 },
  { symbol: 'AMZN', kind: 'stock', divYield: 0 },
  { symbol: 'UFO', kind: 'etf', divYield: 0.005 },
  { symbol: 'BOTZ', kind: 'etf', divYield: 0.002 },
  { symbol: 'BTC-USD', kind: 'crypto', divYield: 0 },
  { symbol: 'ETH-USD', kind: 'crypto', divYield: 0 },
  { symbol: 'VGSH', kind: 'etf', divYield: 0.038 },
  { symbol: 'GLD', kind: 'etf', divYield: 0 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) =>
  access(p)
    .then(() => true)
    .catch(() => false);

async function curlJson(url: string, nasdaq = false): Promise<any> {
  const headers = nasdaq ? ['-H', 'accept: application/json', '-H', 'referer: https://www.nasdaq.com/'] : [];
  const { stdout } = await run('curl', ['-sS', '--max-time', '45', '-A', UA, ...headers, url], { maxBuffer: 64 * 1024 * 1024 });
  if (!stdout.trim()) throw new Error('empty response');
  return JSON.parse(stdout);
}

async function nasdaq(symbol: string, kind: Kind): Promise<Bar[]> {
  const cls = kind === 'etf' ? 'etf' : 'stocks';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const j = await curlJson(`https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=${cls}&fromdate=2016-01-01&limit=9999`, true);
      const rows = j?.data?.tradesTable?.rows ?? [];
      const bars: Bar[] = [];
      for (const r of rows) {
        const [m, d, y] = String(r.date).split('/');
        const c = Number(String(r.close).replace(/[$,]/g, ''));
        if (m && d && y && Number.isFinite(c) && c > 0) bars.push({ d: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, c });
      }
      if (bars.length) return bars.sort((a, b) => a.d.localeCompare(b.d));
    } catch {
      /* retry */
    }
    await sleep(1500 + attempt * 2000);
  }
  throw new Error(`${symbol}: nasdaq unavailable`);
}

async function binance(symbol: string): Promise<Bar[]> {
  const pair = `${symbol.split('-')[0]}USDT`;
  const bars: Bar[] = [];
  let start = Date.parse('2017-01-01T00:00:00Z');
  for (let page = 0; page < 8; page++) {
    const rows = (await curlJson(`https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&startTime=${start}`)) as unknown[][];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const c = Number(row[4]);
      if (Number.isFinite(c) && c > 0) bars.push({ d: new Date(Number(row[0])).toISOString().slice(0, 10), c });
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][6]) + 1;
  }
  if (!bars.length) throw new Error(`${symbol}: binance unavailable`);
  return bars;
}

async function seed(v: Vehicle): Promise<SleeveFile | null> {
  const raw = join(RAW, `${v.symbol}.json`);
  if (await exists(raw)) {
    const j = JSON.parse(await readFile(raw, 'utf8'));
    const adjusted = String(j.source ?? '').includes('adjusted');
    return {
      symbol: v.symbol,
      kind: v.kind,
      adjusted: v.kind === 'crypto' ? true : adjusted,
      divYield: v.divYield,
      source: j.source,
      bars: (j.bars as { d: string; c: number }[]).map((b) => ({ d: b.d, c: b.c })),
    };
  }
  const reps = join(REPS, `${v.symbol}.json`);
  if (await exists(reps)) {
    const j = JSON.parse(await readFile(reps, 'utf8'));
    return {
      symbol: v.symbol,
      kind: v.kind,
      adjusted: false,
      divYield: v.divYield,
      source: 'nasdaq:historical (price-only)',
      bars: (j.bars as { d: string; c: number }[]).map((b) => ({ d: b.d, c: b.c })),
    };
  }
  return null;
}

function merge(base: SleeveFile, fresh: Bar[]): number {
  const last = base.bars[base.bars.length - 1];
  const ref = [...fresh].reverse().find((b) => b.d <= last.d);
  if (!ref) return 0;
  let added = 0;
  for (const b of fresh) {
    if (b.d <= last.d) continue;
    base.bars.push({ d: b.d, c: (last.c * b.c) / ref.c });
    added++;
  }
  if (added && base.adjusted && base.kind !== 'crypto' && !base.appendedFrom) base.appendedFrom = last.d;
  return added;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let ok = 0;
  for (const v of VEHICLES) {
    const file = join(OUT, `${v.symbol}.json`);
    let series: SleeveFile | null = (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : await seed(v);
    let fresh: Bar[] | null = null;
    try {
      fresh = v.kind === 'crypto' ? await binance(v.symbol) : await nasdaq(v.symbol, v.kind);
    } catch (e) {
      console.log(`${v.symbol.padEnd(8)} fresh fetch failed: ${String(e).split('\n')[0]}`);
    }
    if (!series && fresh) {
      series = {
        symbol: v.symbol,
        kind: v.kind,
        adjusted: v.kind === 'crypto',
        divYield: v.divYield,
        source: v.kind === 'crypto' ? 'binance:vision' : 'nasdaq:historical (price-only)',
        bars: fresh,
      };
    } else if (series && fresh) {
      const added = merge(series, fresh);
      if (added) console.log(`${v.symbol.padEnd(8)} +${added} bars`);
    }
    if (!series) {
      console.log(`${v.symbol.padEnd(8)} MISSING (no cache, no fresh data)`);
      continue;
    }
    if (fresh?.length) {
      const q = fresh[fresh.length - 1];
      series.quote = { price: q.c, asOf: q.d, source: v.kind === 'crypto' ? 'binance' : 'nasdaq' };
    }
    series.divYield = v.divYield;
    await writeFile(file, JSON.stringify(series));
    ok++;
    console.log(`${v.symbol.padEnd(8)} ${series.bars.length} bars ${series.bars[0].d} → ${series.bars.at(-1)!.d} · ${series.adjusted ? 'total return' : 'price + yield'}${series.appendedFrom ? ` (accrual after ${series.appendedFrom})` : ''} · quote ${series.quote?.price ?? 'n/a'}`);
    await sleep(v.kind === 'crypto' ? 300 : 1200);
  }
  console.log(`\n${ok}/${VEHICLES.length} sleeve vehicles ready`);
  if (ok < VEHICLES.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
