import type { Gate, LayerId, PriceSeries, RunConfig, SignalPoint, SignalState } from '../types';

export interface SignalData {
  signals: Record<string, SignalPoint[]>;
  current: Record<string, SignalPoint>;
}

const monthKey = (d: string): string => d.slice(0, 7);

export function runSignal(
  series: PriceSeries[],
  cfg: RunConfig,
  emit: (layer: LayerId, kind: 'start' | 'progress' | 'gate' | 'end' | 'error', msg: string, data?: Record<string, unknown>) => void,
): { data: SignalData; gate: Gate; summary: string } {
  const signals: Record<string, SignalPoint[]> = {};
  const current: Record<string, SignalPoint> = {};

  for (const s of series) {
    if (s.cls === 'Event' || s.role === 'overlay') continue;
    const bars = [...s.bars].sort((a, b) => a.d.localeCompare(b.d));
    if (bars.length < cfg.smaWindow + 30) continue;

    const closes = bars.map((b) => b.c);
    let sum = 0;
    for (let i = 0; i < cfg.smaWindow; i++) sum += closes[i];
    const points: SignalPoint[] = [];
    let units = 0;
    let lastAddPx = 0;
    let lastMonth = '';

    for (let i = cfg.smaWindow; i < bars.length; i++) {
      sum += closes[i] - closes[i - cfg.smaWindow];
      const sma = sum / cfg.smaWindow;
      const px = closes[i];
      const back = i >= cfg.momLookback ? closes[i - cfg.momLookback] : closes[0];
      const mom = back > 0 ? px / back - 1 : 0;
      const endOfMonth = i === bars.length - 1 || monthKey(bars[i + 1].d) !== monthKey(bars[i].d);
      if (!endOfMonth) continue;

      let state: SignalState;
      if (px > sma && mom > 0) {
        if (units === 0) {
          units = 1;
          lastAddPx = px;
          state = 'entry';
        } else if (units < 3 && px > lastAddPx * 1.1) {
          units += 1;
          lastAddPx = px;
          state = 'add';
        } else {
          state = 'hold';
        }
      } else if (px > sma) {
        state = units > 0 ? 'hold' : 'exit';
      } else if (mom > 0) {
        state = units > 0 ? 'reduce' : 'exit';
        units = Math.min(units, 0.5);
      } else {
        state = 'exit';
        units = 0;
      }

      const point: SignalPoint = { d: bars[i].d, state, units, px, sma200: sma, mom12: mom };
      if (lastMonth !== monthKey(bars[i].d)) {
        points.push(point);
        lastMonth = monthKey(bars[i].d);
      } else {
        points[points.length - 1] = point;
      }
    }

    if (!points.length) continue;
    signals[s.symbol] = points;
    current[s.symbol] = points[points.length - 1];
    const last = points[points.length - 1];
    emit('signal', 'progress', `${s.symbol} · ${last.state} · ${last.units}u · mom ${(last.mom12 * 100).toFixed(0)}%`, {
      symbol: s.symbol,
      state: last.state,
      units: last.units,
    });
  }

  const entries = Object.values(current).filter((p) => p.state === 'entry' || p.state === 'add').length;
  const checks = [
    { name: 'signal coverage', ok: Object.keys(signals).length >= 12, detail: `${Object.keys(signals).length} assets have signals` },
    { name: 'fresh signal', ok: Object.values(current).every((p) => p.d >= '2026-01-01'), detail: 'all series updated in 2026' },
    { name: 'state breadth', ok: entries > 0, detail: `${entries} assets in entry/add state` },
  ];
  const gate: Gate = { level: checks.every((c) => c.ok) ? 'pass' : 'warn', checks };
  emit('signal', 'gate', `signal gate ${gate.level}`, { gate });
  return { data: { signals, current }, gate, summary: `${Object.keys(signals).length} signals · ${entries} actionable` };
}
