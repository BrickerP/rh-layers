import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { UNIVERSE, type Bar, type PriceSeries } from '@rh-layers/core';
import { RhClient, type RhBar } from './rhClient';

const run = promisify(execFile);
const RAW_DIR = resolve(process.cwd(), '../../data/raw');
const CACHE_DIR = resolve(process.cwd(), '../../data/.cache');
const JAR = join(CACHE_DIR, 'yahoo-cookies.txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const START = '2010-01-01T00:00:00Z';

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: {
        quote: Array<{ close?: (number | null)[]; volume?: (number | null)[] }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
    }>;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function curl(url: string, outFile?: string, opts: { follow?: boolean; accept?: string; timeout?: number } = {}): Promise<string> {
  const args = ['-sS', '--max-time', String(opts.timeout ?? 40), '-A', UA, '-H', `accept: ${opts.accept ?? 'application/json,text/plain,*/*'}`];
  if (opts.follow !== false) args.push('-L');
  args.push('-b', JAR, '-c', JAR);
  if (outFile) args.push('-o', outFile);
  args.push(url);
  const { stdout } = await run('curl', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function initYahoo(): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  await curl('https://fc.yahoo.com', '/dev/null', { follow: false, accept: 'text/html,application/xhtml+xml', timeout: 20 }).catch(() => '');
  for (let attempt = 0; attempt < 5; attempt++) {
    const crumb = (await curl('https://query1.finance.yahoo.com/v1/test/getcrumb', undefined, { accept: 'text/plain', timeout: 20 })).trim();
    if (crumb && crumb.length <= 32 && !crumb.startsWith('<')) return crumb;
    await sleep(4000 + attempt * 4000);
    await curl('https://fc.yahoo.com', '/dev/null', { follow: false, accept: 'text/html,application/xhtml+xml', timeout: 20 }).catch(() => '');
  }
  throw new Error('yahoo: crumb unavailable');
}

async function yahooChart(symbol: string, crumb: string): Promise<PriceSeries> {
  const range = symbol.includes('-USD') ? '6y' : '15y';
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includeAdjustedClose=true&crumb=${encodeURIComponent(crumb)}`;
  const body = await curl(url);
  if (body.trim().startsWith('<')) throw new Error(`${symbol}: html (rate limited)`);
  const json = JSON.parse(body) as YahooChart;
  const r = json.chart.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`${symbol}: empty chart`);
  const close = r.indicators.quote[0]?.close ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? [];
  const vol = r.indicators.quote[0]?.volume ?? [];
  const bars: (Bar | null)[] = r.timestamp.map((ts, i) => {
    const c = adj[i] ?? close[i];
    if (c == null || !Number.isFinite(c) || c <= 0) return null;
    return { d: new Date(ts * 1000).toISOString().slice(0, 10), c, v: vol[i] ?? undefined };
  });
  const clean = bars.filter((b): b is Bar => b !== null);
  const spec = UNIVERSE.find((u) => u.symbol === symbol)!;
  return { ...spec, source: 'yahoo:chart', provenance: 'live', bars: clean };
}

function fromRhBars(symbol: string, bars: RhBar[], divYield = 0): PriceSeries {
  const spec = UNIVERSE.find((u) => u.symbol === symbol)!;
  return {
    ...spec,
    divYield,
    source: 'robinhood:mcp (split-adjusted + constant yield)',
    provenance: 'live',
    bars: bars
      .map((b) => ({ d: b.begins_at.slice(0, 10), c: Number(b.close_price), v: b.volume }))
      .filter((b) => Number.isFinite(b.c) && b.c > 0),
  };
}

/** Binance public market-data mirror: long daily history, paginated. */
async function binanceDaily(symbol: string): Promise<Bar[]> {
  const pair = `${symbol.split('-')[0]}USDT`;
  const bars: Bar[] = [];
  let start = Date.parse('2017-01-01T00:00:00Z');
  for (let page = 0; page < 8; page++) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&startTime=${start}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${symbol}: binance HTTP ${res.status}`);
    const rows = (await res.json()) as unknown[][];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const ts = Number(row[0]);
      const c = Number(row[4]);
      if (Number.isFinite(c) && c > 0) bars.push({ d: new Date(ts).toISOString().slice(0, 10), c });
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][6]) + 1;
  }
  if (bars.length < 260) throw new Error(`${symbol}: only ${bars.length} crypto bars`);
  return bars;
}

async function saveCrypto(spec: (typeof UNIVERSE)[number]): Promise<void> {
  const bars = await binanceDaily(spec.symbol);
  await save({ ...spec, divYield: 0, source: 'binance:vision (USDT≈USD)', provenance: 'live', bars });
}async function save(series: PriceSeries): Promise<void> {
  await writeFile(join(RAW_DIR, `${series.symbol}.json`), JSON.stringify(series));
  console.log(`${series.symbol.padEnd(8)} ${String(series.bars.length).padStart(5)} bars  ${series.bars[0].d} → ${series.bars.at(-1)!.d}  · ${series.source}`);
}

async function viaRobinhood(token: string): Promise<number> {
  const rh = new RhClient(token);
  await rh.init();
  console.log('robinhood mcp: initialized (read-only historicals)');
  const equities = UNIVERSE.filter((s) => s.cls !== 'Crypto').map((s) => s.symbol);
  let n = 0;
  for (let i = 0; i < equities.length; i += 10) {
    const batch = equities.slice(i, i + 10);
    const [bars, yields] = await Promise.all([rh.equityBars(batch, START, 'day', 'split'), rh.dividendYields(batch)]);
    for (const symbol of batch) {
      const rows = bars[symbol];
      if (!rows?.length) {
        console.log(`rh: no bars for ${symbol}`);
        continue;
      }
      await save(fromRhBars(symbol, rows, yields[symbol] ?? 0));
      n++;
    }
  }
  return n;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  let ok = 0;
  let fail = 0;
  const token = process.env.RH_MCP_TOKEN?.trim();
  const todo = new Set(UNIVERSE.map((s) => s.symbol));

  if (token) {
    try {
      ok += await viaRobinhood(token);
      for (const s of UNIVERSE) {
        if (s.cls !== 'Crypto') todo.delete(s.symbol);
      }
    } catch (err) {
      console.log(`robinhood path failed: ${String(err).split('\n')[0]} — falling back to public data`);
    }
  } else {
    console.log('RH_MCP_TOKEN not set: using public source only');
  }

  for (const spec of UNIVERSE.filter((s) => s.cls === 'Crypto')) {
    try {
      await saveCrypto(spec);
      ok++;
      todo.delete(spec.symbol);
    } catch (err) {
      console.log(`crypto failed ${spec.symbol}: ${String(err).split('\n')[0]}`);
      fail++;
    }
  }

  if (todo.size) {
    const crumb = await initYahoo();
    console.log('yahoo session ready');
    for (const spec of UNIVERSE.filter((s) => todo.has(s.symbol))) {
      let done = false;
      for (let attempt = 0; attempt < 6 && !done; attempt++) {
        try {
          await save(await yahooChart(spec.symbol, crumb));
          ok++;
          done = true;
        } catch (err) {
          const msg = String(err).split('\n')[0];
          console.log(`retry ${attempt + 1} ${spec.symbol}: ${msg}`);
          await sleep(4000 + attempt * 3000);
          if (msg.includes('rate') || msg.includes('html')) {
            await initYahoo().catch(() => undefined);
          }
        }
      }
      if (!done) fail++;
      await sleep(1500);
    }
  }

  console.log(`\n${ok} saved · ${fail} failed · raw dir ${RAW_DIR}`);
  try {
    const body = await curl('https://api.elections.kalshi.com/trade-api/v2/markets?limit=1', undefined, { timeout: 10 });
    console.log(`kalshi probe: ${body.slice(0, 60)}`);
  } catch {
    console.log('kalshi probe: unreachable (event sleeve stays blocked, no fixture substituted)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
