import React, { useEffect, useMemo, useState } from 'react';

interface Position {
  symbol: string;
  name: string;
  cls: string;
  weight: number;
  price: number;
  crypto: boolean;
  live: boolean;
}
interface Portfolio {
  asOf: string;
  runId: string;
  dataDate: string;
  capitalDefault: number;
  pricesLive: boolean;
  classes: { cls: string; weight: number }[];
  positions: Position[];
  stats: { cagr: number; maxDD: number; sharpe: number; benchCagr: number; benchMaxDD: number; spyCagr?: number; spyMaxDD?: number };
  rules: string[];
  checklist: string[];
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const money = (x: number) => `$${Math.round(x).toLocaleString()}`;

export default function PortfolioView() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [capital, setCapital] = useState(100000);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem('rh-layers-capital'));
    if (saved > 0) setCapital(saved);
    fetch(`${import.meta.env.BASE_URL}portfolio.json`)
      .then((r) => {
        if (!r.ok) throw new Error('portfolio.json missing — run pnpm portfolio');
        return r.json() as Promise<Portfolio>;
      })
      .then((p) => {
        setData(p);
        if (!saved) setCapital(p.capitalDefault);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.positions.map((p) => {
      const amount = p.weight * capital;
      const rawShares = p.price > 0 ? amount / p.price : 0;
      const shares = p.crypto ? Math.floor(rawShares * 10000) / 10000 : Math.floor(rawShares);
      const spent = shares * p.price;
      return { ...p, amount, shares, spent, leftover: amount - spent };
    });
  }, [data, capital]);

  if (err || !data) {
    return (
      <div className="empty">
        <div className="empty-card">
          <div className="kicker">RH LAYERS</div>
          <h1>Portfolio sheet not generated</h1>
          <p>
            Run <code>pnpm portfolio</code> to build it from the latest run.
          </p>
          {err && <div className="callout warn">{err}</div>}
        </div>
      </div>
    );
  }

  const invested = rows.reduce((a, r) => a + r.spent, 0);
  const leftover = capital - invested;

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div>
          <div className="kicker">implementation portfolio · {data.positions.length} positions</div>
          <h1>One portfolio, one page</h1>
          <p>
            Built from the {data.dataDate} run · prices as of {data.asOf}
            {data.pricesLive ? ' (live)' : ' (last known; refresh before trading)'}
          </p>
        </div>
        <div className="sheet-controls">
          <label>
            capital
            <input
              type="number"
              min={1000}
              step={1000}
              value={capital}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setCapital(v);
                localStorage.setItem('rh-layers-capital', String(v));
              }}
            />
          </label>
          <button className="print" onClick={() => window.print()}>
            print
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>backtest CAGR</span>
          <b className="pos">{pct(data.stats.cagr)}</b>
          <i>SPY: {pct(data.stats.spyCagr ?? 0)}</i>
        </div>
        <div className="kpi">
          <span>max drawdown</span>
          <b className="neg">{pct(data.stats.maxDD)}</b>
          <i>60/40: {pct(data.stats.benchMaxDD)}</i>
        </div>
        <div className="kpi">
          <span>Sharpe</span>
          <b>{data.stats.sharpe.toFixed(2)}</b>
          <i>walk-forward, net of 10bp costs</i>
        </div>
        <div className="kpi">
          <span>capital</span>
          <b>{money(capital)}</b>
          <i>
            invested {money(invested)} · cash {money(leftover)}
          </i>
        </div>
      </div>

      <div className="sheet-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Target portfolio</h3>
            <span className="dim">strategic class mix · annual rebalance · shares rounded down</span>
          </div>
          <table className="table sheet-table">
            <thead>
              <tr>
                <th>symbol</th>
                <th>name</th>
                <th>class</th>
                <th className="right">target</th>
                <th className="right">amount</th>
                <th className="right">price</th>
                <th className="right">shares</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className="mono strong">{r.symbol}</td>
                  <td className="dim">{r.name}</td>
                  <td className="dim">{r.cls}</td>
                  <td className="right mono">{pct(r.weight)}</td>
                  <td className="right mono">{money(r.amount)}</td>
                  <td className="right mono">{r.price > 0 ? r.price.toFixed(2) : '—'}</td>
                  <td className="right mono strong">
                    {r.shares.toLocaleString(undefined, { maximumFractionDigits: r.crypto ? 4 : 0 })}
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>total</td>
                <td className="right mono">100.0%</td>
                <td className="right mono">{money(invested)}</td>
                <td />
                <td className="right mono">cash {money(leftover)}</td>
              </tr>
            </tbody>
          </table>
          <p className="note">
            ETFs are rounded to whole shares; crypto is fractional. The leftover is the rounding cash. This is a planning sheet, not an
            order ticket — prices move between generation and execution.
          </p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Allocation</h3>
            <span className="dim">class weights</span>
          </div>
          <div className="class-bars big">
            {data.classes.map((c) => (
              <div key={c.cls} className="class-row">
                <span>{c.cls}</span>
                <div className="bar">
                  <i style={{ width: `${(c.weight / Math.max(...data.classes.map((x) => x.weight), 0.01)) * 100}%` }} />
                </div>
                <b>{pct(c.weight)}</b>
              </div>
            ))}
          </div>

          <h4 className="h4 spaced">rules</h4>
          <ul className="rules">
            {data.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Semi-annual rebalance checklist</h3>
          <span className="dim">run this twice a year, or when a class drifts &gt; 5pp</span>
        </div>
        <ol className="checklist">
          {data.checklist.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </section>

      <div className="sheet-foot">
        <span>run {data.runId}</span>
        <span>prices {data.pricesLive ? 'live' : 'last known'} · data {data.dataDate}</span>
        <span>not investment advice · no orders placed</span>
      </div>
    </div>
  );
}
