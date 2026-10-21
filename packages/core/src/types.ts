export type LayerId =
  | 'sources'
  | 'clean'
  | 'metrics'
  | 'screen'
  | 'signal'
  | 'corr'
  | 'build'
  | 'backtest';

export type AssetClass =
  | 'Equity'
  | 'Fixed Income'
  | 'Commodity'
  | 'Real Estate'
  | 'Real Assets'
  | 'Crypto'
  | 'Event';

export type Role = 'core' | 'satellite' | 'overlay';

export interface AssetSpec {
  symbol: string;
  name: string;
  cls: AssetClass;
  role: Role;
  rationale: string;
  market?: number;
  /** Liquidity/cap rank from discovery; lower is more investable. */
  rank?: number;
  /** Annual distribution yield used only when prices are split-adjusted (not total-return). */
  divYield?: number;
}

export interface Bar {
  d: string;
  c: number;
  v?: number;
}

export interface PriceSeries extends AssetSpec {
  source: string;
  provenance: 'live' | 'fixture';
  bars: Bar[];
}

export interface Metrics {
  symbol: string;
  weeks: number;
  cagr: number;
  vol: number;
  sharpe: number;
  sortino: number;
  maxDD: number;
  calmar: number;
  worst12m: number;
  recoveryWeeks: number;
  beta: number;
  skew: number;
  kurt: number;
  hitRate: number;
  spark: number[];
}

export type SignalState = 'entry' | 'add' | 'hold' | 'reduce' | 'exit';

export interface SignalPoint {
  d: string;
  state: SignalState;
  units: number;
  px: number;
  sma200: number;
  mom12: number;
}

export interface GateCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Gate {
  level: 'pass' | 'warn' | 'fail';
  checks: GateCheck[];
}

export interface LayerResult<T = unknown> {
  id: LayerId;
  status: 'ok' | 'warn' | 'fail' | 'skipped';
  ms: number;
  gate: Gate;
  summary: string;
  data: T;
}

export interface LayerEvent {
  t: number;
  layer: LayerId;
  kind: 'start' | 'progress' | 'gate' | 'end' | 'error';
  msg: string;
  data?: Record<string, unknown>;
}

export interface RunConfig {
  runId: string;
  windowWeeks: number;
  rebalanceWeeks: number;
  costBps: number;
  maxAssetWeight: number;
  maxClusterWeight: number;
  maxCryptoWeight: number;
  classCaps: Record<string, number>;
  minHistoryWeeks: number;
  maxPoolSize: number;
  buildMode: 'hrp' | 'momentum';
  momentumTop: number;
  momentumLookback: number;
  momentumTrend: number;
  classQuotas: Record<string, number>;
  cashMin: number;
  smaWindow: number;
  momLookback: number;
}

export interface PerfStats {
  cagr: number;
  vol: number;
  maxDD: number;
  sharpe: number;
  calmar: number;
  worst12m: number;
}

export interface OverlayStats {
  label: string;
  cagr: number;
  vol: number;
  maxDD: number;
  sharpe: number;
  note: string;
}

export interface BacktestData {
  dates: string[];
  strategy: number[];
  strategyTrend: number[];
  sixtyForty: number[];
  equalWeight: number[];
  minVariance: number[];
  drawdown: number[];
  stats: Record<string, PerfStats>;
  overlays: OverlayStats[];
  turnover: number[];
}

export interface CorrData {
  order: string[];
  matrix: number[][];
  clusters: string[][];
  weights: Record<string, number>;
  sensitivity: { window: number; top: [string, number][] }[];
}

export interface ScreenData {
  pool: string[];
  rejected: { symbol: string; reasons: string[] }[];
  scores: Record<string, number>;
}

export interface RunArtifact {
  schema: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  config: RunConfig;
  universe: AssetSpec[];
  layers: {
    id: LayerId;
    status: string;
    ms: number;
    gate: Gate;
    summary: string;
    events: LayerEvent[];
  }[];
  weekly: { dates: string[]; returns: Record<string, number[]> };
  metrics: Record<string, Metrics>;
  screen: ScreenData;
  signals: Record<string, SignalPoint[]>;
  corr: CorrData;
  weights: Record<string, number>;
  cash: number;
  strategyLabel: string;
  discovery: { discovered: number; candidates: number; fetched: number; pool: number; stocks: number; etfs: number; crypto: number; };
  backtest: BacktestData;
  provenance: Record<string, { source: string; provenance: string; bars: number }>;
}
