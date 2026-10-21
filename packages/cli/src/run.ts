import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runPipeline, type AssetSpec, type PriceSeries } from '@rh-layers/core';

const ROOT = resolve(process.cwd(), '../..');
const RAW_DIR = join(ROOT, 'data/raw');
const UNIVERSE = join(ROOT, 'data/universe.json');
const RUNS_DIR = join(ROOT, 'runs');

async function main() {
  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json'));
  const series: PriceSeries[] = [];
  for (const f of files) series.push(JSON.parse(await readFile(join(RAW_DIR, f), 'utf8')) as PriceSeries);
  console.log(`loaded ${series.length} series`);

  let universe: AssetSpec[] | undefined;
  let discovery: { discovered: number; candidates: number; stocks: number; etfs: number; crypto: number } | undefined;
  try {
    const u = JSON.parse(await readFile(UNIVERSE, 'utf8')) as {
      assets: (AssetSpec & { assetType: string; rank: number; market: number })[];
      counts: { discovered: number; candidates: number; stocks: number; etfs: number; cryptoPairs: number; cryptoCurated: number };
    };
    universe = u.assets.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      cls: a.cls,
      role: a.role,
      rationale: a.rationale,
      rank: a.rank,
      divYield: a.divYield,
    }));
    discovery = {
      discovered: u.counts.discovered,
      candidates: u.counts.candidates,
      stocks: u.counts.stocks,
      etfs: u.counts.etfs,
      crypto: u.counts.cryptoCurated,
    };
  } catch {
    console.log('no universe.json: falling back to the series specs');
  }

  const artifact = await runPipeline(series, { universe, discovery });
  const dir = join(RUNS_DIR, artifact.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'run.json'), JSON.stringify(artifact));
  await writeFile(join(RUNS_DIR, 'latest.json'), JSON.stringify(artifact));

  console.log(`\nrun ${artifact.runId}`);
  console.log(`discovery: ${artifact.discovery.discovered} discovered → ${artifact.discovery.candidates} candidates → ${artifact.discovery.fetched} fetched → ${artifact.discovery.pool} pool`);
  for (const l of artifact.layers) {
    console.log(`${l.id.padEnd(9)} ${l.status.padEnd(4)} ${String(l.ms).padStart(5)}ms  ${l.summary}`);
  }
  const top = Object.entries(artifact.weights).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\ntop weights:', top.map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' · '));
  console.log('backtest:', Object.entries(artifact.backtest.stats).map(([k, v]) => `${k} ${(v.cagr * 100).toFixed(1)}%/${(v.maxDD * 100).toFixed(0)}%`).join(' · '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
