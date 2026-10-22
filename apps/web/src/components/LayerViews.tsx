import React from 'react';
import type { LayerId, RunArtifact, SignalState } from '@rh-layers/core';
import { Badge, DrawdownChart, Heatmap, LineChart, Sparkline, Treemap } from './charts';

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (x: number, d = 1) => x.toFixed(d);

const STATE_TONE: Record<SignalState, 'ok' | 'info' | 'muted' | 'warn' | 'fail'> = {
  entry: 'ok',
  add: 'info',
  hold: 'muted',
  reduce: 'warn',
  exit: 'fail',
};

const CLASS_COLOR: Record<string, string> = {
  Equity: '#38bdf8',
  'Fixed Income': '#34d399',
  Commodity: '#fbbf24',
  'Real Estate': '#f97316',
  'Real Assets': '#22d3ee',
  Crypto: '#e879f9',
  Event: '#f472b6',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function SourcesView({ run }: { run: RunArtifact }) {
  const rows = Object.entries(run.provenance).sort((a, b) => b[1].bars - a[1].bars);
  const unavailable = run.universe.filter((u) => !run.provenance[u.symbol]);
  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="series" value={String(rows.length)} />
        <Stat label="bars" value={rows.reduce((a, r) => a + r[1].bars, 0).toLocaleString()} />
        <Stat label="live" value={`${rows.filter((r) => r[1].provenance === 'live').length}`} tone="#34d399" />
        <Stat label="unavailable" value={String(unavailable.length)} tone={unavailable.length ? '#fbbf24' : undefined} />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>symbol</th>
            <th>source</th>
            <th className="right">bars</th>
            <th>provenance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([sym, p]) => (
            <tr key={sym}>
              <td className="mono">{sym}</td>
              <td className="dim">{p.source}</td>
              <td className="right mono">{p.bars.toLocaleString()}</td>
              <td>
                <Badge tone={p.provenance === 'live' ? 'ok' : 'warn'}>{p.provenance}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {unavailable.length > 0 && (
        <div className="callout warn">
          <strong>Fail-closed:</strong> {unavailable.map((u) => u.symbol).join(', ')} could not be resolved. The pipeline keeps them out of the
          covariance solve and reports the sleeve as blocked instead of substituting synthetic data.
        </div>
      )}
      <p className="note">
        Optional adapter: Robinhood MCP can supply positions and snapshots, but it is not required for the historical series. Raw data stays
        local; only derived artifacts are published.
      </p>
    </div>
  );
}

export function CleanView({ run }: { run: RunArtifact }) {
  const worst = Object.entries(run.provenance).map(([s]) => s);
  const outliers = run.layers.find((l) => l.id === 'clean')?.events.filter((e) => e.msg.includes('outliers'));
  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="weeks" value={String(run.weekly.dates.length)} />
        <Stat label="series" value={String(Object.keys(run.weekly.returns).length)} />
        <Stat label="first" value={run.weekly.dates[0]} />
        <Stat label="last" value={run.weekly.dates.at(-1) ?? '—'} />
      </div>
      <div className="callout">
        {outliers?.[0]?.msg ?? 'weekly returns built with carry-forward for non-overlapping calendars'}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>symbol</th>
            <th className="right">weeks</th>
            <th className="right">CAGR</th>
            <th className="right">vol</th>
            <th className="right">max DD</th>
          </tr>
        </thead>
        <tbody>
          {worst.map((s) => {
            const m = run.metrics[s];
            return (
              <tr key={s}>
                <td className="mono">{s}</td>
                <td className="right mono">{m?.weeks ?? '—'}</td>
                <td className="right mono">{m ? pct(m.cagr) : '—'}</td>
                <td className="right mono">{m ? pct(m.vol) : '—'}</td>
                <td className="right mono neg">{m ? pct(m.maxDD) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsView({ run, onSelect }: { run: RunArtifact; onSelect: (s: string) => void }) {
  const items = Object.values(run.metrics);
  const w = 680;
  const h = 280;
  const pad = { l: 44, r: 14, t: 12, b: 30 };
  const maxVol = Math.max(...items.map((m) => m.vol), 0.1);
  const minC = Math.min(...items.map((m) => m.cagr), -0.05);
  const maxC = Math.max(...items.map((m) => m.cagr), 0.1);
  const x = (v: number) => pad.l + (v / maxVol) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minC) / (maxC - minC)) * (h - pad.t - pad.b);

  return (
    <div className="stack">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart">
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="grid" />
        <line x1={x(0)} x2={x(0)} y1={pad.t} y2={h - pad.b} className="grid" />
        <text x={pad.l - 6} y={y(maxC)} textAnchor="end" className="axis">
          {pct(maxC, 0)}
        </text>
        <text x={pad.l - 6} y={y(minC)} textAnchor="end" className="axis">
          {pct(minC, 0)}
        </text>
        <text x={w - pad.r} y={h - 8} textAnchor="end" className="axis">
          vol → {pct(maxVol, 0)}
        </text>
        <text x={pad.l} y={h - 8} className="axis">
          CAGR vs vol
        </text>
        {items.map((m) => (
          <g key={m.symbol} onClick={() => onSelect(m.symbol)} className="dot">
            <circle cx={x(m.vol)} cy={y(m.cagr)} r="5" fill={CLASS_COLOR[run.universe.find((u) => u.symbol === m.symbol)?.cls ?? ''] ?? '#94a3b8'} opacity="0.9" />
            <text x={x(m.vol) + 7} y={y(m.cagr) + 3} className="dot-label">
              {m.symbol}
            </text>
            <title>
              {m.symbol}: CAGR {pct(m.cagr)} · vol {pct(m.vol)} · maxDD {pct(m.maxDD)}
            </title>
          </g>
        ))}
      </svg>
      <table className="table">
        <thead>
          <tr>
            <th>symbol</th>
            <th className="right">CAGR</th>
            <th className="right">vol</th>
            <th className="right">Sharpe</th>
            <th className="right">max DD</th>
            <th>last 52w</th>
          </tr>
        </thead>
        <tbody>
          {items
            .sort((a, b) => b.cagr - a.cagr)
            .map((m) => (
              <tr key={m.symbol} onClick={() => onSelect(m.symbol)} className="row-click">
                <td className="mono">{m.symbol}</td>
                <td className="right mono pos">{pct(m.cagr)}</td>
                <td className="right mono">{pct(m.vol)}</td>
                <td className="right mono">{num(m.sharpe, 2)}</td>
                <td className="right mono neg">{pct(m.maxDD)}</td>
                <td>
                  <Sparkline values={m.spark} color={CLASS_COLOR[run.universe.find((u) => u.symbol === m.symbol)?.cls ?? ''] ?? '#38bdf8'} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScreenView({ run }: { run: RunArtifact }) {
  const roleOf = new Map(run.universe.map((u) => [u.symbol, u]));
  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="pool" value={String(run.screen.pool.length)} tone="#34d399" />
        <Stat label="rejected" value={String(run.screen.rejected.length)} tone="#fbbf24" />
        <Stat label="min history" value={`${run.config.minHistoryWeeks}w`} />
        <Stat label="max weight" value={pct(run.config.maxAssetWeight, 0)} />
      </div>
      <div>
        <h4 className="h4">investable pool</h4>
        <div className="chip-wrap">
          {run.screen.pool.map((s) => (
            <span key={s} className="chip" style={{ borderColor: CLASS_COLOR[roleOf.get(s)?.cls ?? ''] }}>
              <span className="mono">{s}</span>
              <span className="chip-sub">{roleOf.get(s)?.cls}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <h4 className="h4">excluded, with reasons</h4>
        <table className="table">
          <tbody>
            {run.screen.rejected.map((r) => (
              <tr key={r.symbol}>
                <td className="mono">{r.symbol}</td>
                <td className="dim">{r.reasons.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SignalView({ run, onSelect }: { run: RunArtifact; onSelect: (s: string) => void }) {
  const rows = Object.entries(run.signals)
    .map(([s, pts]) => ({ s, last: pts.at(-1)! }))
    .sort((a, b) => b.last.units - a.last.units || b.last.mom12 - a.last.mom12);
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.last.state] = (acc[r.last.state] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="stack">
      <div className="stats-row">
        {(['entry', 'add', 'hold', 'reduce', 'exit'] as SignalState[]).map((s) => (
          <Stat key={s} label={s} value={String(counts[s] ?? 0)} tone={STATE_TONE[s] === 'ok' ? '#34d399' : STATE_TONE[s] === 'fail' ? '#f472b6' : undefined} />
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>symbol</th>
            <th>state</th>
            <th className="right">units</th>
            <th className="right">12m mom</th>
            <th className="right">price / 200d</th>
            <th>as of</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, last }) => (
            <tr key={s} onClick={() => onSelect(s)} className="row-click">
              <td className="mono">{s}</td>
              <td>
                <Badge tone={STATE_TONE[last.state]}>{last.state}</Badge>
              </td>
              <td className="right mono">{num(last.units, 1)}</td>
              <td className={`right mono ${last.mom12 >= 0 ? 'pos' : 'neg'}`}>{pct(last.mom12, 0)}</td>
              <td className={`right mono ${last.px >= last.sma200 ? 'pos' : 'neg'}`}>{num(last.px / last.sma200, 3)}</td>
              <td className="dim mono">{last.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Entry = price above 200d SMA and 12m momentum positive. Add = +10% from last add, max 3 units. Reduce = below SMA with positive
        momentum. Exit = below SMA and negative momentum. Signals are causal; the backtest only reads points dated on or before the
        rebalance.
      </p>
    </div>
  );
}

export function CorrView({ run, onSelect }: { run: RunArtifact; onSelect: (s: string) => void }) {
  const corr = run.corr;
  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="assets" value={String(corr.order.length)} />
        <Stat label="clusters" value={String(corr.clusters.length)} />
        <Stat label="window" value={`${run.config.windowWeeks}w`} />
        <Stat label="shrinkage" value={num(0, 2)} />
      </div>
      <div className="scroll-x">
        <Heatmap order={corr.order} matrix={corr.matrix} onSelect={onSelect} />
      </div>
      <div className="two-col">
        <div>
          <h4 className="h4">risk clusters</h4>
          {corr.clusters.map((c, i) => (
            <div key={i} className="cluster">
              <span className="cluster-idx">C{i + 1}</span>
              <span className="dim">{c.join(' · ')}</span>
            </div>
          ))}
        </div>
        <div>
          <h4 className="h4">window sensitivity · top 5</h4>
          {corr.sensitivity.map((s) => (
            <div key={s.window} className="sens-row">
              <span className="mono dim">{s.window}w</span>
              <span className="mono">{s.top.map(([k, v]) => `${k} ${pct(v, 0)}`).join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="note">Correlations are weekly, shrunk toward a constant-correlation target (Ledoit-Wolf). Clusters are formed on correlation distance; caps are applied per cluster, not per label.</p>
    </div>
  );
}

export function BuildView({ run, onSelect }: { run: RunArtifact; onSelect: (s: string) => void }) {
  const rows = Object.entries(run.weights).sort((a, b) => b[1] - a[1]);
  const buildLayer = run.layers.find((l) => l.id === 'build');
  const sleeveBlocked = buildLayer?.events.some((e) => e.msg.includes('blocked'));
  return (
    <div className="stack">
      <Treemap weights={run.weights} clusters={run.corr.clusters} onSelect={onSelect} />
      <div className="stats-row">
        <Stat label="positions" value={String(rows.length)} />
        <Stat label="top" value={rows[0] ? `${rows[0][0]} ${pct(rows[0][1])}` : '—'} />
        <Stat label="cash" value={pct(run.cash)} />
        <Stat label="overlay" value={sleeveBlocked ? 'blocked' : '2% cap'} tone={sleeveBlocked ? '#fbbf24' : undefined} />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>symbol</th>
            <th className="right">weight</th>
            <th className="right">cluster</th>
            <th className="right">signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([s, w]) => (
            <tr key={s} onClick={() => onSelect(s)} className="row-click">
              <td className="mono">{s}</td>
              <td className="right mono">{pct(w)}</td>
              <td className="right mono dim">{run.corr.clusters.findIndex((c) => c.includes(s)) + 1}</td>
              <td className="right">
                <Badge tone={STATE_TONE[run.signals[s]?.at(-1)?.state ?? 'hold']}>{run.signals[s]?.at(-1)?.state ?? 'n/a'}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="two-col">
        <div className="callout">
          <strong>Event contracts</strong>
          <div className="dim">
            {sleeveBlocked
              ? 'Source unreachable from this environment. Fail-closed: sleeve weight = 0, never priced from a fixture.'
              : '2% policy cap. Binary terminal payoff, excluded from the covariance solve.'}
          </div>
        </div>
        <div className="callout">
          <strong>Options overlay</strong>
          <div className="dim">Synthetic Black-Scholes overlay priced from realised vol. Reported separately, never in the HRP weights.</div>
        </div>
      </div>
    </div>
  );
}

export function BacktestView({ run }: { run: RunArtifact }) {
  const bt = run.backtest;
  const rows = Object.entries(bt.stats);
  return (
    <div className="stack">
      <LineChart
        dates={bt.dates}
        series={[
          { label: run.strategyLabel ?? 'Strategy', values: bt.strategy, color: '#f97316', width: 2.2 },
          { label: `${run.strategyLabel ?? 'Strategy'} + trend units`, values: bt.strategyTrend, color: '#fbbf24', width: 1.4, dashed: true },
          ...(Object.keys(bt.stats).some((k) => k.startsWith('60/40')) ? [{ label: '60/40', values: bt.sixtyForty, color: '#38bdf8', width: 1.4 }] : []),
          { label: 'SPY', values: run.weekly.returns.SPY ?? [], color: '#94a3b8', width: 1.2 },
          { label: 'Equal weight', values: bt.equalWeight, color: '#a78bfa', width: 1.2, dashed: true },
        ]}
      />
      <DrawdownChart values={bt.drawdown} />
      <table className="table">
        <thead>
          <tr>
            <th>portfolio</th>
            <th className="right">CAGR</th>
            <th className="right">vol</th>
            <th className="right">max DD</th>
            <th className="right">Sharpe</th>
            <th className="right">Calmar</th>
            <th className="right">worst 12m</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k === 'HRP core' ? run.strategyLabel ?? k : k}</td>
              <td className="right mono pos">{pct(v.cagr)}</td>
              <td className="right mono">{pct(v.vol)}</td>
              <td className="right mono neg">{pct(v.maxDD)}</td>
              <td className="right mono">{num(v.sharpe, 2)}</td>
              <td className="right mono">{num(v.calmar, 2)}</td>
              <td className="right mono neg">{pct(v.worst12m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="h4">options overlay · synthetic, 4-week blocks</h4>
      <div className="overlay-grid">
        {bt.overlays.map((o) => (
          <div key={o.label} className="overlay-card">
            <div className="overlay-title">{o.label}</div>
            <div className="overlay-nums">
              <span>
                CAGR <b>{pct(o.cagr)}</b>
              </span>
              <span>
                vol <b>{pct(o.vol)}</b>
              </span>
              <span className="neg">
                maxDD <b>{pct(o.maxDD)}</b>
              </span>
            </div>
            <div className="overlay-note">{o.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssetPassport({ run, symbol }: { run: RunArtifact; symbol: string }) {
  const spec = run.universe.find((u) => u.symbol === symbol);
  const m = run.metrics[symbol];
  const w = run.weights[symbol];
  const sig = run.signals[symbol]?.at(-1);
  const prov = run.provenance[symbol];
  if (!spec) return null;
  return (
    <div className="passport">
      <div className="passport-head">
        <span className="passport-sym">{symbol}</span>
        <Badge tone="info">{spec.cls}</Badge>
        <Badge tone="muted">{spec.role}</Badge>
      </div>
      <p className="passport-why">{spec.rationale}</p>
      <div className="passport-grid">
        <span>
          weight <b>{w != null ? pct(w) : '0%'}</b>
        </span>        <span>
          CAGR <b>{m ? pct(m.cagr) : '—'}</b>
        </span>
        <span>
          vol <b>{m ? pct(m.vol) : '—'}</b>
        </span>
        <span>
          maxDD <b className="neg">{m ? pct(m.maxDD) : '—'}</b>
        </span>
        <span>
          beta <b>{m ? num(m.beta, 2) : '—'}</b>
        </span>
        <span>
          signal <b>{sig?.state ?? 'n/a'}</b>
        </span>
      </div>
      <div className="passport-flow">
        raw {prov?.bars.toLocaleString() ?? 0} bars → weekly panel → {m ? pct(m.cagr) : '—'} CAGR → {w != null ? pct(w) : '0%'} weight
      </div>
    </div>
  );
}

export function LayerView({
  run,
  layer,
  selectedSymbol,
  onSelect,
}: {
  run: RunArtifact;
  layer: LayerId;
  selectedSymbol: string | null;
  onSelect: (s: string) => void;
}) {
  switch (layer) {
    case 'sources':
      return <SourcesView run={run} />;
    case 'clean':
      return <CleanView run={run} />;
    case 'metrics':
      return <MetricsView run={run} onSelect={onSelect} />;
    case 'screen':
      return <ScreenView run={run} />;
    case 'signal':
      return <SignalView run={run} onSelect={onSelect} />;
    case 'corr':
      return <CorrView run={run} onSelect={onSelect} />;
    case 'build':
      return <BuildView run={run} onSelect={onSelect} />;
    case 'backtest':
      return <BacktestView run={run} />;
    default:
      return null;
  }
}
