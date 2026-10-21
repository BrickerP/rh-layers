import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Bar, PriceSeries } from '@rh-layers/core';

const run = promisify(execFile);
const ROOT = resolve(process.cwd(), '../..');
const OUT = join(ROOT, 'data/reps');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const REPS: { symbol: string; name: string; cls: string; y: number }[] = [
  { symbol: 'EFA', name: 'Developed ex-US equity', cls: 'Equity', y: 0.028 },
  { symbol: 'EEM', name: 'Emerging market equity', cls: 'Equity', y: 0.023 },
  { symbol: 'AGG', name: 'US aggregate bonds', cls: 'Fixed Income', y: 0.024 },
  { symbol: 'IEF', name: 'US 7-10y Treasuries', cls: 'Fixed Income', y: 0.035 },
  { symbol: 'TIP', name: 'US TIPS', cls: 'Fixed Income', y: 0.03 },
  { symbol: 'LQD', name: 'US IG credit', cls: 'Fixed Income', y: 0.04 },
  { symbol: 'HYG', name: 'US high yield', cls: 'Fixed Income', y: 0.052 },
  { symbol: 'EMB', name: 'EM USD debt', cls: 'Fixed Income', y: 0.05 },
  { symbol: 'SHY', name: 'US 1-3y Treasuries', cls: 'Cash', y: 0.035 },
  { symbol: 'GLD', name: 'Gold', cls: 'Commodity', y: 0 },
  { symbol: 'DBC', name: 'Broad commodities', cls: 'Commodity', y: 0 },
  { symbol: 'IGF', name: 'Global infrastructure', cls: 'Real Assets', y: 0.028 },
];

async function curlJson(url: string): Promise<any> {
  const { stdout } = await run(
    'curl',
    ['-sS', '--max-time', '40', '-A', UA, '-H', 'accept: application/json', '-H', 'referer: https://www.nasdaq.com/', url],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function history(symbol: string): Promise<Bar[]> {
  let j: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      j = await curlJson(`https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=etf&fromdate=2016-01-01&limit=9999`);
      if (j?.data?.tradesTable?.rows?.length) break;
    } catch {
      await new Promise((r) => setTimeout(r, 1200 + attempt * 1200));
    }
  }
  const rows = j?.data?.tradesTable?.rows ?? [];
  const bars: Bar[] = [];
  for (const r of rows) {
    const [m, d, y] = String(r.date).split('/');
    const c = Number(String(r.close).replace(/[$,]/g, ''));
    if (!m || !d || !y || !Number.isFinite(c) || c <= 0) continue;
    bars.push({ d: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, c, v: Number(String(r.volume).replace(/,/g, '')) });
  }
  bars.sort((a, b) => a.d.localeCompare(b.d));
  if (bars.length < 260) throw new Error(`only ${bars.length} bars`);
  return bars;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const r of REPS) {
    try {
      const bars = await history(r.symbol);
      const series: PriceSeries = {
        symbol: r.symbol,
        name: r.name,
        cls: r.cls as any,
        role: 'core',
        rationale: 'asset-class representative',
        divYield: r.y,
        source: 'nasdaq:historical (price + yield accrual)',
        provenance: 'live',
        bars,
      };
      await writeFile(join(OUT, `${r.symbol}.json`), JSON.stringify(series));
      console.log(`${r.symbol} ${bars.length} bars ${bars[0].d} → ${bars.at(-1)!.d}`);
    } catch (e) {
      console.log(`FAIL ${r.symbol} ${String(e).slice(0, 80)}`);
    }
    await new Promise((res) => setTimeout(res, 400));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
