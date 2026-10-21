import type { CorrData, Gate, LayerId, RunConfig } from '../types';
import { covToCorr, hrp, ledoitWolf } from '../math';
import type { CleanData } from './clean';
import { pct } from '../util';

export function clusterFromCorr(symbols: string[], corr: number[][], threshold: number): string[][] {
  const parent = symbols.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const d = Math.sqrt(Math.max(0, 0.5 * (1 - corr[i][j])));
      if (d < threshold) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  symbols.forEach((s, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), s]);
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function estimate(clean: CleanData, pool: string[], window: number) {
  const rows: number[][] = [];
  const start = Math.max(1, clean.dates.length - window);
  for (let i = start; i < clean.dates.length; i++) {
    rows.push(pool.map((s) => clean.returns[s]?.[i] ?? 0));
  }
  const { cov, shrink } = ledoitWolf(rows);
  const corr = covToCorr(cov);
  const { order, weights } = hrp(cov);
  const orderedSymbols = order.map((i) => pool[i]);
  const orderedMatrix = order.map((i) => order.map((j) => corr[i][j]));
  return { cov, corr, shrink, order, weights, orderedSymbols, orderedMatrix };
}

export function runCorr(
  clean: CleanData,
  pool: string[],
  cfg: RunConfig,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: CorrData; gate: Gate; summary: string } {
  const main = estimate(clean, pool, cfg.windowWeeks);
  emit('corr', 'progress', `Ledoit-Wolf shrinkage δ=${main.shrink.toFixed(2)} on ${cfg.windowWeeks} weeks`, {
    shrink: main.shrink,
    window: cfg.windowWeeks,
  });

  const weights: Record<string, number> = {};
  main.order.forEach((idx, k) => (weights[pool[idx]] = main.weights[k]));

  let clusters = clusterFromCorr(main.orderedSymbols, main.orderedMatrix, 0.45);
  let threshold = 0.45;
  while (clusters.length < 3 && threshold < 0.85) {
    threshold += 0.05;
    clusters = clusterFromCorr(main.orderedSymbols, main.orderedMatrix, threshold);
  }
  emit('corr', 'progress', `${clusters.length} risk clusters at distance < ${threshold.toFixed(2)}`, {
    clusters: clusters.map((c) => c.length),
  });

  const sensitivity = [156, 260, 520]
    .filter((w) => w < clean.dates.length)
    .map((w) => {
      const e = estimate(clean, pool, w);
      const top = e.order
        .map((idx, k) => [pool[idx], e.weights[k]] as [string, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      return { window: w, top };
    });

  const topNames = sensitivity.map((s) => s.top.map((t) => t[0]).join(','));
  const checks = [
    { name: 'weight stability', ok: new Set(topNames).size === 1, detail: `top-5 set identical across 3/5/10y windows: ${new Set(topNames).size === 1}` },
    { name: 'cluster count', ok: clusters.length >= 3, detail: `${clusters.length} clusters` },
    { name: 'shrinkage sane', ok: main.shrink >= 0 && main.shrink <= 0.95, detail: `δ=${main.shrink.toFixed(2)}` },
  ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'warn', checks };
  emit('corr', 'gate', `corr gate ${gate.level}`, { gate });
  const maxW = Math.max(...Object.values(weights));
  return {
    data: { order: main.orderedSymbols, matrix: main.orderedMatrix, clusters, weights, sensitivity },
    gate,
    summary: `${clusters.length} clusters · max weight ${pct(maxW)} · δ ${main.shrink.toFixed(2)}`,
  };
}
