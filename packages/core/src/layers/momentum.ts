import type { RunConfig } from '../types';
import type { CleanData } from './clean';
import { mean, stdev } from '../math';

export function priceIndex(clean: CleanData, pool: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of pool) {
    let v = 1;
    out[s] = (clean.returns[s] ?? []).map((r) => (v *= 1 + r));
  }
  return out;
}

/**
 * Cross-sectional momentum with a trend filter and inverse-vol sizing.
 * No class constraints: the strategy may hold 100% equities, crypto, or cash.
 */
export function momentumWeights(
  index: Record<string, number[]>,
  clean: CleanData,
  pool: string[],
  cfg: RunConfig,
  i: number,
): { weights: Record<string, number>; cash: number; eligible: string[] } {
  const cand: { s: string; mom: number; vol: number }[] = [];
  for (const s of pool) {
    const idx = index[s];
    if (!idx || i - cfg.momentumLookback < 0) continue;
    const mom = idx[i] / idx[i - cfg.momentumLookback] - 1;
    const sma = mean(idx.slice(Math.max(0, i - cfg.momentumTrend), i));
    const vol = stdev((clean.returns[s] ?? []).slice(Math.max(1, i - 52), i)) * Math.sqrt(52);
    if (mom > 0 && idx[i] > sma && vol > 0.01) cand.push({ s, mom, vol });
  }
  cand.sort((a, b) => b.mom - a.mom);
  const top = cand.slice(0, cfg.momentumTop);
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const c of top) {
    raw[c.s] = 1 / c.vol;
    sum += raw[c.s];
  }
  if (!sum) return { weights: {}, cash: 1, eligible: [] };
  for (const s of Object.keys(raw)) raw[s] = Math.min(cfg.maxAssetWeight, raw[s] / sum);
  const invested = Object.values(raw).reduce((a, b) => a + b, 0);
  return { weights: raw, cash: Math.max(0, 1 - invested), eligible: top.map((t) => t.s) };
}
