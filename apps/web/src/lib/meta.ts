import type { LayerId } from '@rh-layers/core';

export interface LayerMeta {
  id: LayerId;
  label: string;
  sub: string;
  input: string;
  output: string;
  gate: string;
  color: string;
}

export const LAYERS: LayerMeta[] = [
  { id: 'sources', label: 'Sources', sub: 'adapters', input: 'universe + date range', output: 'raw bars + provenance', gate: 'resolved ≥ 80% live', color: '#38bdf8' },
  { id: 'clean', label: 'Clean', sub: 'normalise', input: 'raw bars', output: 'weekly returns panel', gate: 'gaps ≤ 10%', color: '#22d3ee' },
  { id: 'metrics', label: 'Metrics', sub: 'measure', input: 'weekly panel', output: 'return / risk / tail stats', gate: 'coverage ≥ 15', color: '#a78bfa' },
  { id: 'screen', label: 'Screen', sub: 'qualify', input: 'metrics + rules', output: 'pool + written reasons', gate: 'pool ≥ 12', color: '#f472b6' },
  { id: 'signal', label: 'Signal', sub: 'time', input: 'daily prices', output: 'entry / add / reduce / exit', gate: 'signal coverage ≥ 12', color: '#fbbf24' },
  { id: 'corr', label: 'Correlation', sub: 'depend', input: 'weekly panel', output: 'shrunk cov + clusters', gate: 'weight stability', color: '#34d399' },
  { id: 'build', label: 'Build', sub: 'size', input: 'cov + caps', output: 'weights under caps', gate: 'caps + Σw = 1', color: '#f97316' },
  { id: 'backtest', label: 'Backtest', sub: 'prove', input: 'weights + panel', output: 'walk-forward + overlays', gate: 'no look-ahead', color: '#e879f9' },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));
export const CHAIN: LayerId[] = LAYERS.map((l) => l.id);
