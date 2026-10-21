import type { Gate, LayerId, PriceSeries } from '../types';
import { pct } from '../util';

export interface SourcesData {
  series: PriceSeries[];
  provenance: Record<string, { source: string; provenance: string; bars: number }>;
  unavailable: string[];
}

export function runSources(
  raw: PriceSeries[],
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: SourcesData; gate: Gate; summary: string } {
  const series: PriceSeries[] = [];
  const unavailable: string[] = [];
  const provenance: SourcesData['provenance'] = {};

  for (const s of raw) {
    const bars = s.bars.filter((b) => Number.isFinite(b.c) && b.c > 0);
    if (!bars.length) {
      unavailable.push(s.symbol);
      emit('sources', 'progress', `${s.symbol}: no usable bars`, { symbol: s.symbol });
      continue;
    }
    series.push({ ...s, bars });
    provenance[s.symbol] = { source: s.source, provenance: s.provenance, bars: bars.length };
    emit('sources', 'progress', `${s.symbol} · ${bars.length} bars · ${s.source}`, {
      symbol: s.symbol,
      bars: bars.length,
      source: s.source,
      provenance: s.provenance,
    });
  }

  const live = series.filter((s) => s.provenance === 'live').length;
  const checks = [
    { name: 'assets resolved', ok: series.length >= 15, detail: `${series.length}/${raw.length} resolved` },
    { name: 'history depth', ok: series.every((s) => s.bars.length >= 260), detail: `min ${Math.min(...series.map((s) => s.bars.length))} daily bars` },
    { name: 'live provenance', ok: live / Math.max(1, series.length) >= 0.8, detail: `${pct(live / Math.max(1, series.length), 0)} live` },
  ];
  const gate: Gate = {
    level: checks.every((c) => c.ok) ? 'pass' : checks.some((c) => c.name === 'assets resolved' && !c.ok) ? 'fail' : 'warn',
    checks,
  };
  emit('sources', 'gate', gate.level === 'pass' ? 'all source gates passed' : `source gate ${gate.level}`, { gate });
  return {
    data: { series, provenance, unavailable },
    gate,
    summary: `${series.length} assets · ${live} live · ${unavailable.length} unavailable`,
  };
}
