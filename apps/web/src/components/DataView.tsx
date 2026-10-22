import React from 'react';
import type { RunArtifact } from '@rh-layers/core';
import { Badge } from './charts';

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export default function DataView({ run }: { run: RunArtifact }) {
  const steps = [
    ['discovered', run.discovery.discovered, 'US-listed stocks & ETFs + USD crypto pairs'],
    ['candidates', run.discovery.candidates, 'liquidity / market-cap screen'],
    ['history', run.discovery.fetched, '10y adjusted daily bars fetched'],
    ['pool', run.screen.pool.length, 'class quotas + quality gates'],
    ['positions', Object.keys(run.weights).length, 'weights after the build layer'],
  ];
  const sources = Object.entries(run.provenance);
  const bySource = sources.reduce<Record<string, number>>((a, [_, p]) => {
    a[p.source] = (a[p.source] ?? 0) + 1;
    return a;
  }, {});

  return (
    <div className="data-view">
      <div className="funnel-big">
        {steps.map(([label, v, note], i) => (
          <React.Fragment key={String(label)}>
            <div className="funnel-step">
              <b>{Number(v).toLocaleString()}</b>
              <span>{label}</span>
              <i>{note}</i>
            </div>
            {i < steps.length - 1 && <span className="funnel-arrow">→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="result-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Gates</h3>
            <span className="dim">fail-closed by stage</span>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>stage</th>
                <th>status</th>
                <th className="right">checks</th>
                <th>summary</th>
              </tr>
            </thead>
            <tbody>
              {run.layers.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.id}</td>
                  <td>
                    <span className={`chip-dot ${l.gate.level}`} /> {l.gate.level}
                  </td>
                  <td className="right mono">
                    {l.gate.checks.filter((c) => c.ok).length}/{l.gate.checks.length}
                  </td>
                  <td className="dim">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Sources</h3>
            <span className="dim">{sources.length} series</span>
          </div>
          {Object.entries(bySource).map(([s, n]) => (
            <div key={s} className="source-row">
              <span className="mono">{s}</span>
              <b>{n}</b>
            </div>
          ))}
          <div className="notes vertical">
            <span>US stocks/ETFs: Eastmoney full market list + backward-adjusted klines.</span>
            <span>Crypto: Binance USDT pairs, daily klines.</span>
            <span>Options: synthetic Black-Scholes overlay, not live chains.</span>
            <span>Event contracts: source unreachable → weight 0 (fail-closed).</span>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Coverage</h3>
          <span className="dim">discovered vs calculated</span>
        </div>
        <div className="coverage">
          <div>
            <b>{run.discovery.stocks.toLocaleString()}</b>
            <span>stocks discovered</span>
          </div>
          <div>
            <b>{run.discovery.etfs.toLocaleString()}</b>
            <span>ETFs discovered</span>
          </div>
          <div>
            <b>{run.discovery.crypto}</b>
            <span>crypto candidates</span>
          </div>
          <div>
            <b>{run.discovery.fetched}</b>
            <span>series with history</span>
          </div>
          <div>
            <b>{pct(run.cash)}</b>
            <span>cash after caps</span>
          </div>
        </div>
        <p className="note">
          Discovery scans the full tradable list; calculation uses the liquid candidates. 10y × 14k symbols is not a daily job, and a
          14k-dimensional covariance matrix is not investable. The funnel is the explicit trade-off.
        </p>
      </section>
    </div>
  );
}
