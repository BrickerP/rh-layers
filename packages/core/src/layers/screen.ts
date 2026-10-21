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
    pool.push(spec.symbol);
    scores[spec.symbol] = m!.vol > 0 ? m!.cagr / m!.vol : 0;
    emit('screen', 'progress', `${spec.symbol} passed · score ${scores[spec.symbol].toFixed(2)}`, {
      symbol: spec.symbol,
      score: scores[spec.symbol],
    });
  }

  const checks = [
    { name: 'pool size', ok: pool.length >= 12, detail: `${pool.length} assets in the investable pool` },
    { name: 'core coverage', ok: ['SPY', 'AGG', 'GLD'].every((s) => pool.includes(s)), detail: 'SPY / AGG / GLD present' },
    { name: 'reasoned selection', ok: rejected.every((r) => r.reasons.length > 0), detail: 'every exclusion has a written reason' },
  ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'warn', checks };
  emit('screen', 'gate', `screen gate ${gate.level}`, { gate });
  return { data: { pool, rejected, scores }, gate, summary: `${pool.length} kept · ${rejected.length} rejected` };
}
