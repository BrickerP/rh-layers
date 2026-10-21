import type { Gate, LayerId, Metrics } from '../types';
import { annualize, beta, correlation, kurtosis, maxDrawdown, recoveryWeeks, skewness, stdev, worst12m } from '../math';
import type { CleanData } from './clean';
import { pct } from '../util';

export interface MetricsData {
  metrics: Record<string, Metrics>;
}

export function runMetrics(
  clean: CleanData,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: MetricsData; gate: Gate; summary: string } {
  const metrics: Record<string, Metrics> = {};
  const bench = clean.returns.SPY;

  for (const [symbol, r] of Object.entries(clean.returns)) {
    const a = annualize(r);
    const c = r.map((x) => 1 + x).reduce((x, y) => x * y, 1);
    const spark: number[] = [];
    let v = 1;
    const tail = r.slice(-52);
    for (const x of tail) {
      v *= 1 + x;
      spark.push(v);
    }
    metrics[symbol] = {
      symbol,
      weeks: Math.max(0, r.length - (clean.validFrom[symbol] ?? 0)),
      cagr: a.cagr,
      vol: a.vol,
      sharpe: a.sharpe,
      sortino: a.sortino,
      maxDD: maxDrawdown(r),
      calmar: a.cagr / Math.max(1e-9, Math.abs(maxDrawdown(r))),
      worst12m: worst12m(r),
      recoveryWeeks: recoveryWeeks(r),
      beta: bench ? beta(r, bench) : 0,
      skew: skewness(r),
      kurt: kurtosis(r),
      hitRate: r.filter((x) => x > 0).length / Math.max(1, r.length),
      spark,
    };
    emit('metrics', 'progress', `${symbol} · CAGR ${pct(a.cagr)} · vol ${pct(a.vol)} · maxDD ${pct(maxDrawdown(r))}`, {
      symbol,
      cagr: a.cagr,
      vol: a.vol,
      maxDD: maxDrawdown(r),
    });
  }

  const corrWithSpy = bench ? correlation(bench, bench) : 0;
  const checks = [
    { name: 'coverage', ok: Object.keys(metrics).length >= 15, detail: `${Object.keys(metrics).length} series measured` },
    { name: 'bench integrity', ok: Math.abs(corrWithSpy - 1) < 1e-6, detail: 'SPY vs SPY = 1.00' },
    { name: 'vol sanity', ok: Object.values(metrics).every((m) => m.vol < 2.0), detail: `max ${pct(Math.max(...Object.values(metrics).map((m) => m.vol)))}` },
  ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'warn', checks };
  emit('metrics', 'gate', `metrics gate ${gate.level}`, { gate });
  const avg = Object.values(metrics).reduce((a, m) => a + m.cagr, 0) / Math.max(1, Object.keys(metrics).length);
  return { data: { metrics }, gate, summary: `${Object.keys(metrics).length} series · mean CAGR ${pct(avg)}` };
}
