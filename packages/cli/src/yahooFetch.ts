import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { UNIVERSE, type Bar, type PriceSeries } from '@rh-layers/core';

/**
 * Slow, polite Yahoo Finance adapter. Yahoo rate-limits aggressively; this
 * fetches one symbol at a time with a cookie+crumb session and long backoff.
 * Only used for the initial/cold data build; reruns overwrite atomically.
 */
const run = promisify(execFile);
const RAW_DIR = resolve(process.cwd(), '../../data/raw');
const CACHE_DIR = resolve(process.cwd(), '../../data/.cache');
const JAR = join(CACHE_DIR, 'yahoo-cookies.txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function curl(url: string, opts: { follow?: boolean; accept?: string; timeout?: number; out?: string } = {}): Promise<string> {
  const args = ['-sS', '--max-time', String(opts.timeout ?? 40), '-A', UA, '-H', `accept: ${opts.accept ?? 'application/json,text/plain,*/*'}`];
  if (opts.follow !== false) args.push('-L');
  args.push('-b', JAR, '-c', JAR);
  if (opts.out) args.push('-o', opts.out);
  args.push(url);
  const { stdout } = await run('curl', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function crumb(): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await curl('https://fc.yahoo.com', { follow: false, accept: 'text/html', timeout: 20, out: '/dev/null' }).catch(() => '');
    const c = (await curl('https://query1.finance.yahoo.com/v1/test/getcrumb', { accept: 'text/plain', timeout: 20 })).trim();
    if (c && c.length <= 32 && !c.startsWith('<')) return c;
    await sleep(6000 + i * 4000);
  }
  throw new Error('yahoo: crumb unavailable');
}

async function fetchOne(symbol: string, c: string): Promise<Bar[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=15y&interval=1d&includeAdjustedClose=true&crumb=${encodeURIComponent(c)}`;
  const body = await curl(url);
  if (body.trim().startsWith('<')) throw new Error('html (rate limited)');
  const json = JSON.parse(body);
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error('empty chart');
  const close = r.indicators.quote[0]?.close ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? [];
  const vol = r.indicators.quote[0]?.volume ?? [];
  const bars: Bar[] = [];
  r.timestamp.forEach((ts: number, i: number) => {
    const v = adj[i] ?? close[i];
    if (v == null || !Number.isFinite(v) || v <= 0) return;
    bars.push({ d: new Date(ts * 1000).toISOString().slice(0, 10), c: v, v: vol[i] ?? undefined });
  });
  if (bars.length < 260) throw new Error(`only ${bars.length} bars`);
  return bars;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  let c = await crumb();
  console.log('session ready');
  for (const spec of UNIVERSE.filter((s) => s.cls !== 'Crypto')) {
    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      try {
        const bars = await fetchOne(spec.symbol, c);
        const series: PriceSeries = { ...spec, source: 'yahoo:chart (adj close)', provenance: 'live', bars };
        await writeFile(join(RAW_DIR, `${spec.symbol}.json`), JSON.stringify(series));
        console.log(`${spec.symbol.padEnd(8)} ${bars.length} bars  ${bars[0].d} → ${bars.at(-1)!.d}`);
        done = true;
      } catch (err) {
        console.log(`retry ${attempt + 1} ${spec.symbol}: ${String(err).split('\n')[0]}`);
        await sleep(8000 + attempt * 6000);
        if (String(err).includes('rate')) c = await crumb().catch(() => c);
      }
    }
    await sleep(9000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
