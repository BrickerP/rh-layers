import type { CorrData, Gate, LayerId, RunConfig } from '../types';
import type { CleanData } from './clean';
import { momentumWeights, priceIndex } from './momentum';
import { pct } from '../util';

/**
 * Enforce caps by scaling only downwards. We deliberately do NOT redistribute
 * the clipped weight: if asset / cluster / class caps bind, the residual becomes
 * cash. That keeps every hard limit true instead of silently levering or
 * breaching a cap to stay fully invested.
 */
export function capWeights(
  raw: Record<string, number>,
  clusters: string[][],
  cfg: RunConfig,
  classOf: Record<string, string> = {},
): Record<string, number> {
  const keys = Object.keys(raw);
  const w: Record<string, number> = { ...raw };
  const total = keys.reduce((a, k) => a + w[k], 0) || 1;
  for (const k of keys) w[k] /= total;

  const cls = (s: string): string => classOf[s] ?? 'Other';
  const clusterOf = new Map<string, number>();
  clusters.forEach((c, i) => c.forEach((s) => clusterOf.set(s, i)));
  const clusterSum = (ci: number | undefined): number => (ci == null ? 0 : (clusters[ci] ?? []).reduce((a, s) => a + (w[s] ?? 0), 0));
  const byClass = new Map<string, string[]>();
  for (const k of keys) byClass.set(cls(k), [...(byClass.get(cls(k)) ?? []), k]);
  const assetHead = (k: string): number =>
    Math.max(0, Math.min(cfg.maxAssetWeight - w[k], cfg.maxClusterWeight - clusterSum(clusterOf.get(k))));

  for (let iter = 0; iter < 200; iter++) {
    let changed = false;
    for (const k of keys) {
      if (w[k] > cfg.maxAssetWeight) {
        w[k] = cfg.maxAssetWeight;
        changed = true;
      }
    }
    for (const cluster of clusters) {
      const members = cluster.filter((s) => s in w);
      const s = members.reduce((a, m) => a + w[m], 0);
      if (s > cfg.maxClusterWeight) {
        const scale = cfg.maxClusterWeight / s;
        for (const m of members) w[m] *= scale;
        changed = true;
      }
    }
    const byClassLoop = byClass;
    for (const [c, members] of byClassLoop) {
      const cap = cfg.classCaps[c] ?? 1;
      const s = members.reduce((a, m) => a + w[m], 0);
      if (s > cap) {
        const scale = cap / s;
        for (const m of members) w[m] *= scale;
        changed = true;
      }
    }
    if (!changed) break;
    const sum = keys.reduce((a, k) => a + w[k], 0);
    if (sum > 1) for (const k of keys) w[k] /= sum;
  }

  const enforceCaps = (): void => {
    for (const k of keys) if (w[k] > cfg.maxAssetWeight) w[k] = cfg.maxAssetWeight;
    for (const cluster of clusters) {
      const members = cluster.filter((s) => s in w);
      const s = members.reduce((a, m) => a + w[m], 0);
      if (s > cfg.maxClusterWeight) {
        const scale = cfg.maxClusterWeight / s;
        for (const m of members) w[m] *= scale;
      }
    }
    for (const [c, members] of byClass) {
      const cap = cfg.classCaps[c] ?? 1;
      const s = members.reduce((a, m) => a + w[m], 0);
      if (s > cap) {
        const scale = cap / s;
        for (const m of members) w[m] *= scale;
      }
    }
  };

  // Fill residual into classes that still have headroom, without breaching caps.
  for (let pass = 0; pass < 60; pass++) {
    enforceCaps();
    const sum = keys.reduce((a, k) => a + w[k], 0);
    const gap = 1 - sum;
    if (gap <= 1e-9) break;

    const heads = new Map<string, number>();
    let totalHead = 0;
    for (const [c, members] of byClass) {
      const classHead = Math.max(0, (cfg.classCaps[c] ?? 1) - members.reduce((a, m) => a + w[m], 0));
      const h = Math.min(classHead, members.reduce((a, m) => a + assetHead(m), 0));
      heads.set(c, h);
      totalHead += h;
    }
    if (totalHead <= 1e-12) break;
    const budget = Math.min(gap, totalHead);
    for (const [c, members] of byClass) {
      const hc = heads.get(c) ?? 0;
      if (hc <= 0) continue;
      const per = members.map(assetHead);
      const th = per.reduce((a, b) => a + b, 0);
      if (th <= 0) continue;
      const add = Math.min((budget * hc) / totalHead, th);
      members.forEach((k, i) => {
        w[k] += (add * per[i]) / th;
      });
    }
  }
  enforceCaps();
  return w;
}

export interface BuildData {
  weights: Record<string, number>;
  cash: number;
  eventSleeve: { weight: number; status: string; note: string };
  optionSleeve: { weight: number; status: string; note: string };
}

export function runBuild(
  corr: CorrData,
  cfg: RunConfig,
  eventAvailable: boolean,
  classOf: Record<string, string>,
  clean: CleanData,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: BuildData; gate: Gate; summary: string } {
  const pool = Object.keys(corr.weights);
  const momentum = cfg.buildMode === 'momentum' ? momentumWeights(priceIndex(clean, pool), clean, pool, cfg, clean.dates.length - 1) : null;
  const capped = momentum ? momentum.weights : capWeights(corr.weights, corr.clusters, cfg, classOf);
  Object.entries(capped)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => emit('build', 'progress', `${k} → ${pct(v)}`, { symbol: k, weight: v }));

  const sumW = Object.values(capped).reduce((a, b) => a + b, 0);
  const cash = momentum ? Math.max(cfg.cashMin, momentum.cash) : Math.max(cfg.cashMin, 1 - sumW);

  // Overlays never enter the covariance solve; they are sized by explicit policy.
  const eventSleeve = eventAvailable
    ? { weight: 0.02, status: 'capped', note: '2% policy cap, binary payoffs, excluded from covariance' }
    : { weight: 0, status: 'blocked', note: 'event market source unreachable: fail-closed, allocation withheld' };
  const optionSleeve = { weight: 0, status: 'modelled', note: 'synthetic overlay priced from realised vol; not a live option position' };

  const classTotals: Record<string, number> = {};
  for (const [s, v] of Object.entries(capped)) {
    const c = classOf[s] ?? 'Other';
    classTotals[c] = (classTotals[c] ?? 0) + v;
  }

  const checks = momentum
    ? [
        { name: 'Σw ≤ 1', ok: sumW <= 1 + 1e-6, detail: `risk assets ${pct(sumW)} · cash ${pct(cash)}` },
        { name: 'asset cap', ok: Object.values(capped).every((v) => v <= cfg.maxAssetWeight + 1e-9), detail: `max ${pct(Math.max(...Object.values(capped)))} ≤ ${pct(cfg.maxAssetWeight)}` },
        { name: 'position count', ok: Object.keys(capped).length <= cfg.momentumTop, detail: `${Object.keys(capped).length} ≤ ${cfg.momentumTop}` },
        { name: 'no class caps', ok: true, detail: 'momentum mode: any asset class may go to 0 or 100%' },
      ]
    : [
        { name: 'Σw ≤ 1', ok: sumW <= 1 + 1e-6, detail: `risk assets ${pct(sumW)} · cash ${pct(cash)}` },
        { name: 'asset cap', ok: Object.values(capped).every((v) => v <= cfg.maxAssetWeight + 1e-9), detail: `max ${pct(Math.max(...Object.values(capped)))} ≤ ${pct(cfg.maxAssetWeight)}` },
        { name: 'cluster cap', ok: corr.clusters.every((c) => c.reduce((a, s) => a + (capped[s] ?? 0), 0) <= cfg.maxClusterWeight + 1e-6), detail: corr.clusters.map((c) => pct(c.reduce((a, s) => a + (capped[s] ?? 0), 0), 0)).join(' / ') },
        { name: 'class caps', ok: Object.entries(classTotals).every(([c, v]) => v <= (cfg.classCaps[c] ?? 1) + 1e-6), detail: Object.entries(classTotals).map(([c, v]) => `${c} ${pct(v, 0)}`).join(' · ') },
        { name: 'overlay ring-fenced', ok: eventSleeve.weight + optionSleeve.weight <= 0.05, detail: `overlay ${pct(eventSleeve.weight + optionSleeve.weight)} of NAV` },
      ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'fail', checks };
  emit('build', 'gate', `build gate ${gate.level}`, { gate });
  const top = Object.entries(capped).sort((a, b) => b[1] - a[1])[0];
  return {
    data: { weights: capped, cash, eventSleeve, optionSleeve },
    gate,
    summary: `max ${top?.[0]} ${pct(top?.[1] ?? 0)} · cash ${pct(cash)}`,
  };
}
