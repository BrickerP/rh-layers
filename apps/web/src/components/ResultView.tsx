import React from 'react';
import type { LayerId, RunArtifact } from '@rh-layers/core';
import { Badge, LineChart } from './charts';
import { LAYERS } from '../lib/meta';

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export default function ResultView({
  run,
  onStage,
  onSymbol,
}: {
  run: RunArtifact;
  onStage: (id: LayerId) => void;
  onSymbol: (s: string) => void;
}) {
  const hrp = run.backtest.stats['HRP core'];
  const bench = run.backtest.stats['60/40'];
  const positions = Object.entries(run.weights).sort((a, b) => b[1] - a[1]);
  const cls = Object.fromEntries(run.universe.map((u) => [u.symbol, u.cls]));
  const clsTotals: Record<string, number> = {};
  for (const [s, w] of Object.entries(run.weights)) {
    const c = cls[s] ?? 'Other';
    clsTotals[c] = (clsTotals[c] ?? 0) + w;
  }
  const classes = Object.entries(clsTotals).sort((a, b) => b[1] - a[1]);
  const maxCls = Math.max(...classes.map(([, v]) => v), 0.01);
  const positionsCount = positions.length;
  const top = positions.slice(0, 12);
  const topMax = Math.max(...top.map(([, w]) => w), 0.01);

  return (
    <div className="result">
      <div className="kpis">
        <div className="kpi">
          <span>backtest CAGR</span>
          <b className="pos">{pct(hrp.cagr)}</b>
          <i>walk-forward, USD, net of costs</i>
        </div>
        <div className="kpi">
          <span>max drawdown</span>
          <b className="neg">{pct(hrp.maxDD)}</b>
          <i>walk-forward, 2010–2026</i>
        </div>
        <div className="kpi">
          <span>Sharpe</span>
          <b>{hrp.sharpe.toFixed(2)}</b>
          <i>60/40: {bench.sharpe.toFixed(2)}</i>
        </div>
        <div className="kpi">
          <span>vs 60/40</span>
          <b className={hrp.cagr >= bench.cagr ? 'pos' : 'neg'}>{(hrp.cagr * 100 - bench.cagr * 100).toFixed(1)}pp</b>
          <i>{positionsCount} positions · {pct(run.cash)} cash</i>
        </div>
      </div>

      <div className="result-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Portfolio</h3>
            <span className="dim">weights from HRP + hard caps</span>
          </div>
          <div className="wlist">
            {top.map(([s, w]) => (
              <button key={s} className="wrow" onClick={() => onSymbol(s)}>
                <span className="mono">{s}</span>
                <span className="wbar">
                  <i style={{ width: `${(w / topMax) * 100}%` }} />
                </span>
                <b>{pct(w)}</b>
              </button>
            ))}
            <div className="wfoot">{positionsCount - top.length} smaller positions · {pct(positions.slice(12).reduce((a, [, w]) => a + w, 0))}</div>
          </div>
          <div className="class-bars">
            {classes.map(([c, v]) => (
              <div key={c} className="class-row">
                <span>{c}</span>
                <div className="bar">
                  <i style={{ width: `${(v / maxCls) * 100}%` }} />
                </div>
                <b>{pct(v)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Result vs 60/40</h3>
            <span className="dim">cumulative, costs included</span>
          </div>
          <LineChart
            dates={run.backtest.dates}
            height={210}
            series={[
              { label: 'HRP core', values: run.backtest.strategy, color: '#2dd4bf', width: 2 },
              { label: '60/40', values: run.backtest.sixtyForty, color: '#64748b', width: 1.4 },
              { label: 'Equal weight', values: run.backtest.equalWeight, color: '#475569', width: 1.1, dashed: true },
            ]}
          />
          <table className="table compact">
            <thead>
              <tr>
                <th>portfolio</th>
                <th className="right">CAGR</th>
                <th className="right">vol</th>
                <th className="right">max DD</th>
                <th className="right">Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {['HRP core', '60/40', 'Equal weight'].map((k) => {
                const s = run.backtest.stats[k];
                return (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="right mono">{pct(s.cagr)}</td>
                    <td className="right mono">{pct(s.vol)}</td>
                    <td className="right mono neg">{pct(s.maxDD)}</td>
                    <td className="right mono">{s.sharpe.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <div className="result-grid lower">
        <section className="panel">
          <div className="panel-head">
            <h3>Top holdings</h3>
            <span className="dim">{positionsCount} positions · click for detail</span>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>symbol</th>
                <th>class</th>
                <th className="right">weight</th>
                <th className="right">signal</th>
              </tr>
            </thead>
            <tbody>
              {positions.slice(0, 10).map(([s, w]) => (
                <tr key={s} className="row-click" onClick={() => onSymbol(s)}>
                  <td className="mono">{s}</td>
                  <td className="dim">{cls[s]}</td>
                  <td className="right mono">{pct(w)}</td>
                  <td className="right">
                    <span className={`sig ${run.signals[s]?.at(-1)?.state ?? 'hold'}`}>{run.signals[s]?.at(-1)?.state ?? 'n/a'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Process</h3>
            <span className="dim">8 governed stages · click to open</span>
          </div>
          <div className="stage-strip">
            {LAYERS.map((l, i) => {
              const layer = run.layers.find((x) => x.id === l.id)!;
              return (
                <button key={l.id} className="stage-chip" onClick={() => onStage(l.id)}>
                  <span className="chip-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="chip-name">{l.label}</span>
                  <span className={`chip-dot ${layer.gate.level}`} />
                </button>
              );
            })}
          </div>
          <div className="funnel-row">
            {[
              ['discovered', run.discovery.discovered],
              ['candidates', run.discovery.candidates],
              ['history', run.discovery.fetched],
              ['pool', run.screen.pool.length],
              ['positions', positionsCount],
            ].map(([label, v], i, arr) => (
              <React.Fragment key={String(label)}>
                <div className="funnel-cell">
                  <b>{Number(v).toLocaleString()}</b>
                  <span>{label}</span>
                </div>
                {i < arr.length - 1 && <span className="funnel-arrow">→</span>}
              </React.Fragment>
            ))}
          </div>
          <div className="notes">
            <Badge tone="muted">US stocks + ETFs + crypto</Badge>
            <span>adjusted daily history · 26w rebalance · 10bp costs</span>
            {run.layers.filter((l) => l.gate.level !== 'pass').length > 0 && (
              <Badge tone="warn">{run.layers.filter((l) => l.gate.level !== 'pass').map((l) => l.id).join(' · ')} warn</Badge>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
