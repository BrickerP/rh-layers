import type { Gate, LayerId, PriceSeries } from '../types';
import { alignToCalendar, pct, toWeekly } from '../util';

export interface CleanData {
  dates: string[];
  closes: Record<string, (number | null)[]>;
  returns: Record<string, number[]>;
  missingPct: Record<string, number>;
  validFrom: Record<string, number>;
  outliers: { symbol: string; date: string; ret: number }[];
  dropped: { symbol: string; reason: string }[];
}

const START = '2010-01-01';

export function runClean(
  series: PriceSeries[],
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: CleanData; gate: Gate; summary: string } {
  const reference = series.find((s) => s.symbol === 'SPY') ?? series[0];
  if (!reference) throw new Error('no series to clean');
  const calendar = reference.bars.map((b) => b.d).filter((d) => d >= START).sort();
  emit('clean', 'progress', `master calendar: ${calendar.length} US sessions from ${reference.symbol}`, { days: calendar.length });

  const aligned = alignToCalendar(series, calendar, 7);
  const { dates, closes } = toWeekly(calendar, aligned);
  emit('clean', 'progress', `collapsed to ${dates.length} weekly closes`, { weeks: dates.length });

  const returns: Record<string, number[]> = {};
  const missingPct: Record<string, number> = {};
  const validFrom: Record<string, number> = {};
  const outliers: CleanData['outliers'] = [];
  const dropped: CleanData['dropped'] = [];

  for (const s of series) {
    const px = closes[s.symbol] ?? [];
    const r: number[] = [0];
    const dy = (s.divYield ?? 0) / 52;
    let missing = 0;
    let first = -1;
    for (let i = 0; i < px.length; i++) {
      if (first < 0 && px[i] != null) first = i;
    }
    first = Math.max(0, first);
    validFrom[s.symbol] = first;
    for (let i = 1; i < px.length; i++) {
      const a = px[i - 1];
      const b = px[i];
      if (a == null || b == null || a <= 0 || b <= 0) {
        if (i > first) missing++;
        r.push(0);
        continue;
      }
      const ret = (b + dy * a) / a - 1;
      r.push(ret);
      if (Math.abs(ret) > 0.35) outliers.push({ symbol: s.symbol, date: dates[i], ret });
    }
    const observed = Math.max(1, px.length - 1 - first);
    const mp = missing / observed;
    missingPct[s.symbol] = mp;
    returns[s.symbol] = r;
    if (first >= px.length - 60) {
      dropped.push({ symbol: s.symbol, reason: 'less than 60 weeks of observations' });
      delete returns[s.symbol];
      continue;
    }
    if (mp > 0.25) {
      dropped.push({ symbol: s.symbol, reason: `gaps ${pct(mp)} of observed weeks` });
      delete returns[s.symbol];
      continue;
    }
  }

  const deep = series.filter((x) => x.bars.length >= 1300 && returns[x.symbol] !== undefined).map((x) => missingPct[x.symbol] ?? 0);
  const worstDeep = deep.length ? Math.max(...deep) : 0;
  const checks = [
    { name: 'weekly depth', ok: dates.length >= 520, detail: `${dates.length} weeks` },
    { name: 'missing data', ok: worstDeep <= 0.1, detail: `worst ${pct(worstDeep)} among 5y+ series` },
    { name: 'return outliers', ok: outliers.length < dates.length * 0.02, detail: `${outliers.length} weekly moves > 35% (kept, flagged)` },
  ];
  const gate: Gate = {
    level: checks.every((c) => c.ok) ? 'pass' : 'warn',
    checks,
  };
  emit('clean', 'progress', `${outliers.length} outliers flagged; ${dropped.length} series dropped`, { outliers: outliers.length });
  emit('clean', 'gate', `clean gate ${gate.level}`, { gate });
  return {
    data: { dates, closes, returns, missingPct, validFrom, outliers, dropped },
    gate,
    summary: `${dates.length} weeks · ${Object.keys(returns).length} series · ${pct(Math.max(...Object.values(missingPct)))} worst gaps`,
  };
}
