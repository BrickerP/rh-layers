import type {
  AssetSpec,
  BacktestData,
  CorrData,
  LayerEvent,
  LayerId,
  Metrics,
  PriceSeries,
  RunArtifact,
  RunConfig,
  ScreenData,
  SignalPoint,
} from './types';
import { DEFAULT_CONFIG } from './config';
import { UNIVERSE } from './universe';
import { createRecorder } from './events';
import { runSources } from './layers/sources';
import { runClean } from './layers/clean';
import { runMetrics } from './layers/metrics';
import { runScreen } from './layers/screen';
import { runSignal } from './layers/signal';
import { runCorr } from './layers/corr';
import { runBuild } from './layers/build';
import { runBacktest } from './layers/backtest';

export interface RunOptions {
  runId?: string;
  universe?: AssetSpec[];
  discovery?: { discovered?: number; candidates?: number; stocks?: number; etfs?: number; crypto?: number };
  config?: Partial<Omit<RunConfig, 'runId'>>;
}

const nowId = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export async function runPipeline(raw: PriceSeries[], opts: RunOptions = {}): Promise<RunArtifact> {
  const runId = opts.runId ?? nowId();
  const cfg: RunConfig = { runId, ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  const universe = opts.universe ?? UNIVERSE;
  const started = Date.now();
  const rec = createRecorder(started);
  const emit = rec.emit;

  const layers: RunArtifact['layers'] = [];
  const layerData: Partial<{
    clean: ReturnType<typeof runClean>['data'];
    metrics: Record<string, Metrics>;
    screen: ScreenData;
    signals: Record<string, SignalPoint[]>;
    corr: CorrData;
    weights: Record<string, number>;
    backtest: BacktestData;
  }> = {};

  const record = (id: LayerId, _status: string, ms: number, gate: RunArtifact['layers'][number]['gate'], summary: string) => {
    const resolved = gate.level === 'pass' ? 'ok' : gate.level === 'warn' ? 'warn' : 'fail';
    layers.push({
      id,
      status: resolved,
      ms,
      gate,
      summary,
      events: [
        ...rec.events.filter((e: LayerEvent) => e.layer === id),
        { t: Date.now() - started, layer: id, kind: 'end', msg: summary } as LayerEvent,
      ],
    });
  };

  // 1. Sources
  emit('sources', 'start', 'resolving market data adapters');
  let t0 = Date.now();
  const sources = runSources(raw, emit);
  record('sources', sources.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, sources.gate, sources.summary);
  emit('sources', 'end', sources.summary);
  if (sources.gate.level === 'fail') throw new Error(`sources gate failed: ${sources.summary}`);

  // 2. Clean
  emit('clean', 'start', 'aligning calendars and building weekly returns');
  t0 = Date.now();
  const clean = runClean(sources.data.series, emit);
  layerData.clean = clean.data;
  record('clean', clean.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, clean.gate, clean.summary);
  emit('clean', 'end', clean.summary);

  // 3. Metrics
  emit('metrics', 'start', 'computing return, risk and tail metrics');
  t0 = Date.now();
  const metrics = runMetrics(clean.data, emit);
  layerData.metrics = metrics.data.metrics;
  record('metrics', metrics.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, metrics.gate, metrics.summary);
  emit('metrics', 'end', metrics.summary);

  // 4. Screen
  emit('screen', 'start', 'applying quality gates and written selection reasons');
  t0 = Date.now();
  const screen = runScreen(metrics.data.metrics, clean.data, universe, cfg, emit);
  layerData.screen = screen.data;
  record('screen', screen.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, screen.gate, screen.summary);
  emit('screen', 'end', screen.summary);

  // 5. Signal
  emit('signal', 'start', 'evaluating trend and momentum states');
  t0 = Date.now();
  const cleaned = sources.data.series.filter((s) => clean.data.returns[s.symbol] !== undefined);
  const signal = runSignal(cleaned, cfg, emit);
  layerData.signals = signal.data.signals;
  record('signal', signal.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, signal.gate, signal.summary);
  emit('signal', 'end', signal.summary);

  // 6. Correlation
  emit('corr', 'start', 'shrinking the covariance and clustering risk sources');
  t0 = Date.now();
  const corr = runCorr(clean.data, screen.data.pool, cfg, emit);
  layerData.corr = corr.data;
  record('corr', corr.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, corr.gate, corr.summary);
  emit('corr', 'end', corr.summary);

  // 7. Build
  emit('build', 'start', 'sizing the portfolio under hard caps');
  t0 = Date.now();
  const eventAvailable = sources.data.unavailable.length === 0 && raw.some((s) => s.cls === 'Event');
  const classOf = Object.fromEntries(universe.map((s) => [s.symbol, s.cls]));
  const build = runBuild(corr.data, cfg, eventAvailable, classOf, clean.data, emit);
  layerData.weights = build.data.weights;
  record('build', build.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, build.gate, build.summary);
  emit('build', 'end', build.summary);

  // 8. Backtest
  emit('backtest', 'start', 'walk-forward validation and synthetic option overlay');
  t0 = Date.now();
  const backtest = runBacktest(clean.data, screen.data.pool, cfg, signal.data.signals, classOf, emit);
  layerData.backtest = backtest.data;
  record('backtest', backtest.gate.level === 'fail' ? 'fail' : 'ok', Date.now() - t0, backtest.gate, backtest.summary);
  emit('backtest', 'end', backtest.summary);

  const weeklyReturns: Record<string, number[]> = {};
  for (const s of screen.data.pool) weeklyReturns[s] = clean.data.returns[s];

  return {
    schema: 1,
    runId,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    config: cfg,
    universe,
    strategyLabel: cfg.buildMode === 'momentum' ? `Momentum ${cfg.momentumTop}` : 'HRP core',
    discovery: {
      discovered: opts.discovery?.discovered ?? universe.length,
      candidates: opts.discovery?.candidates ?? universe.length,
      fetched: raw.length,
      pool: screen.data.pool.length,
      stocks: opts.discovery?.stocks ?? universe.filter((s) => s.cls === 'Equity').length,
      etfs: opts.discovery?.etfs ?? 0,
      crypto: opts.discovery?.crypto ?? universe.filter((s) => s.cls === 'Crypto').length,
    },
    layers,
    weekly: { dates: clean.data.dates, returns: weeklyReturns },
    metrics: metrics.data.metrics,
    screen: screen.data,
    signals: signal.data.signals,
    corr: corr.data,
    weights: build.data.weights,
    cash: build.data.cash,
    backtest: backtest.data,
    provenance: sources.data.provenance,
  };
}
