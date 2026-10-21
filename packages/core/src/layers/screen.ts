import type { AssetSpec, Gate, LayerId, Metrics, RunConfig } from '../types';
import type { CleanData } from './clean';
import { pct } from '../util';

export interface ScreenData {
  pool: string[];
  rejected: { symbol: string; reasons: string[] }[];
  scores: Record<string, number>;
}

export function runScreen(
  metrics: Record<string, Metrics>,
  clean: CleanData,
  universe: AssetSpec[],
  cfg: RunConfig,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: ScreenData; gate: Gate; summary: string } {
  const pool: string[] = [];
  const rejected: ScreenData['rejected'] = [];
  const scores: Record<string, number> = {};
  const passed: AssetSpec[] = [];

  for (const spec of universe) {
    const m = metrics[spec.symbol];
    const reasons: string[] = [];
    if (spec.role === 'overlay' || spec.cls === 'Event') reasons.push('overlay asset: excluded from covariance pool by design');
    if (!m) reasons.push('no metrics');
    if (m && m.weeks < cfg.minHistoryWeeks) reasons.push(`history ${m.weeks}w < ${cfg.minHistoryWeeks}w`);
    if (m && m.vol > 0.9) reasons.push(`vol ${pct(m.vol)} > 90%`);
    const miss = clean.missingPct[spec.symbol] ?? 0;
    if (miss > 0.05) reasons.push(`missing ${pct(miss)} > 5%`);
    if (spec.cls === 'Event') reasons.push('binary payoff: terminal risk, not a covariance asset');

    if (reasons.length) {
      rejected.push({ symbol: spec.symbol, reasons });
      emit('screen', 'progress', `${spec.symbol} rejected · ${reasons[0]}`, { symbol: spec.symbol, reasons });
      continue;
    }
    passed.push(spec);
    scores[spec.symbol] = m!.vol > 0 ? m!.cagr / m!.vol : 0;
    emit('screen', 'progress', `${spec.symbol} passed · score ${scores[spec.symbol].toFixed(2)}`, {
      symbol: spec.symbol,
      score: scores[spec.symbol],
    });
  }

  const byClass = new Map<string, AssetSpec[]>();
  for (const spec of passed) byClass.set(spec.cls, [...(byClass.get(spec.cls) ?? []), spec]);
  const kept: AssetSpec[] = [];
  const dropped: AssetSpec[] = [];
  for (const [cls, list] of byClass) {
    const quota = cfg.classQuotas[cls] ?? 5;
    list.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    kept.push(...list.slice(0, quota));
    dropped.push(...list.slice(quota));
  }
  kept.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  for (const spec of kept) pool.push(spec.symbol);
  dropped.forEach((spec) => {
    rejected.push({ symbol: spec.symbol, reasons: [`outside the ${spec.cls} quota (${cfg.classQuotas[spec.cls] ?? 5})`] });
  });
  emit('screen', 'progress', `${kept.length} kept · ${dropped.length} cut by class quota`, { kept: kept.length, dropped: dropped.length });

  const checks = [
    { name: 'pool size', ok: pool.length >= 12, detail: `${pool.length} assets in the investable pool` },
    { name: 'core coverage', ok: ['Fixed Income', 'Commodity'].every((c) => pool.some((s) => universe.find((u) => u.symbol === s)?.cls === c)), detail: 'at least one bond and one commodity sleeve in the pool' },
    { name: 'reasoned selection', ok: rejected.every((r) => r.reasons.length > 0), detail: 'every exclusion has a written reason' },
  ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'warn', checks };
  emit('screen', 'gate', `screen gate ${gate.level}`, { gate });
  return { data: { pool, rejected, scores }, gate, summary: `${pool.length} kept · ${rejected.length} rejected` };
}
