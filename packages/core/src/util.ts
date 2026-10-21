import type { Bar, PriceSeries } from './types';

/** ISO week key (Monday-based) for a YYYY-MM-DD date. */
export function weekKey(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

export function toMap(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) if (Number.isFinite(b.c) && b.c > 0) m.set(b.d, b.c);
  return m;
}

/**
 * Align every series to a master calendar, carrying the last observation
 * forward for non-overlapping calendars (crypto trades when equities do not).
 * Stale observations older than `maxStaleDays` become null.
 */
export function alignToCalendar(
  series: PriceSeries[],
  calendar: string[],
  maxStaleDays = 7,
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const s of series) {
    const m = toMap(s.bars);
    const keys = [...m.keys()].sort();
    let p = 0;
    let last: number | null = null;
    let lastDate = '';
    out[s.symbol] = calendar.map((d) => {
      while (p < keys.length && keys[p] <= d) {
        last = m.get(keys[p]) ?? last;
        lastDate = keys[p];
        p++;
      }
      if (last == null || !lastDate) return null;
      const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000;
      return days > maxStaleDays ? null : last;
    });
  }
  return out;
}

/** Collapse a daily calendar + aligned closes into weekly closes (last of week). */
export function toWeekly(
  calendar: string[],
  aligned: Record<string, (number | null)[]>,
): { dates: string[]; closes: Record<string, (number | null)[]> } {
  const dates: string[] = [];
  const picks: number[] = [];
  let current = '';
  calendar.forEach((d, i) => {
    const k = weekKey(d);
    if (k !== current) {
      current = k;
      dates.push(d);
      picks.push(i);
    } else {
      picks[picks.length - 1] = i;
    }
  });
  const closes: Record<string, (number | null)[]> = {};
  for (const [sym, vals] of Object.entries(aligned)) closes[sym] = picks.map((i) => vals[i]);
  return { dates, closes };
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}
