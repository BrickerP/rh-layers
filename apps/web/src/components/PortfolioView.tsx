import React, { useEffect, useMemo, useState } from 'react';
import { FAMILIES, loadPick, pct, resolveRule, useFrontier, type Pick } from './FrontierView';

const money = (x: number) => `$${Math.round(x).toLocaleString()}`;

export default function PortfolioView({ onBack }: { onBack: () => void }) {
  const data = useFrontier();
  const [capital, setCapital] = useState(100000);
  const [pick, setPick] = useState<Pick | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem('rh-layers-capital'));
    if (saved > 0) setCapital(saved);
  }, []);
  useEffect(() => {
    if (data) setPick(loadPick(data));
  }, [data]);

  const rows = useMemo(() => {
    if (!data || !pick) return [];
    const rule = resolveRule(data, pick);
    const out: { symbol: string; sleeve: string; color: string; weight: number; price: number; crypto: boolean; amount: number; shares: number; spent: number }[] = [];
    rule.w.forEach((w, i) => {
      if (w <= 0.0005) return;
      const s = data.sleeves[i];
      for (const m of s.members) {
        const weight = w / s.members.length;
        const price = data.vehicles[m]?.price ?? 0;
        const crypto = m.endsWith('-USD');
        const amount = weight * capital;
        const raw = price > 0 ? amount / price : 0;
        const shares = crypto ? Math.floor(raw * 10000) / 10000 : Math.floor(raw);
        out.push({ symbol: m, sleeve: s.label, color: s.color, weight, price, crypto, amount, shares, spent: shares * price });
      }
    });
    return out.sort((a, b) => b.weight - a.weight);
  }, [data, pick, capital]);

  if (!data || !pick) return <div className="empty"><div className="empty-card"><h1>Loading portfolio…</h1></div></div>;
  const rule = resolveRule(data, pick);
  const family = FAMILIES.find((f) => f.id === pick.family)!;
  const spy = data.benchmarks.find((b) => b.id === 'SPY')!;
  const invested = rows.reduce((a, r) => a + r.spent, 0);
  const quoteDate = Object.values(data.vehicles)
    .map((v) => v.asOf)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div>
          <div className="kicker">
            implementation · {family.label} · drawdown target ≤ {pct(rule.target, 0)}
          </div>
          <h1>{rule.title}</h1>
          <p>
            {family.note}. Prices as of {quoteDate}. <button className="linklike" onClick={onBack}>change point on the frontier</button>
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
          <span>walk-forward CAGR</span>
          <b className="pos">{pct(rule.oos.cagr)}</b>
          <i>
            {data.oosWindow.start} → {data.oosWindow.end}
          </i>
        </div>
        <div className="kpi">
          <span>walk-forward max drawdown</span>
          <b className="neg">{pct(rule.oos.maxDD)}</b>
          <i>estimated {pct(rule.is.maxDD)}</i>
        </div>
        <div className="kpi">
          <span>SPY, same weeks</span>
          <b>{pct(spy.oos.cagr)}</b>
          <i>drawdown {pct(spy.oos.maxDD)}</i>
        </div>
        <div className="kpi">
          <span>capital</span>
          <b>{money(capital)}</b>
          <i>
            invested {money(invested)} · rounding cash {money(capital - invested)}
          </i>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Orders to place</h3>
          <span className="dim">sleeve weight split equally across its tickers · ETFs/stocks rounded down, crypto fractional</span>
        </div>
        <table className="table sheet-table">
          <thead>
            <tr>
              <th>ticker</th>
              <th>sleeve</th>
              <th className="right">target</th>
              <th className="right">amount</th>
              <th className="right">price</th>
              <th className="right">shares</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="mono strong">
                  <i className="swatch" style={{ background: r.color }} />
                  {r.symbol}
                </td>
                <td className="dim">{r.sleeve}</td>
                <td className="right mono">{pct(r.weight)}</td>
                <td className="right mono">{money(r.amount)}</td>
                <td className="right mono">{r.price > 0 ? r.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
                <td className="right mono strong">{r.shares.toLocaleString(undefined, { maximumFractionDigits: r.crypto ? 4 : 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Rules</h3>
          <span className="dim">annual cadence</span>
        </div>
        <ol className="checklist">
          <li>{pick.family === 'opt' ? 'Weights come from the frontier re-estimated once a year on all data to date.' : 'The basket weights are fixed. Only the cash share is re-estimated once a year from all data to date.'}</li>
          <li>Rebalance once a year back to these weights; in between, only act if the drawdown target is breached by more than 5 points.</li>
          <li>Put new money into whatever is furthest below target before selling anything.</li>
          <li>Use limit orders; avoid the first and last 15 minutes of the session.</li>
          <li>The expectation is the walk-forward number, not the estimate. The theme itself can stop working; that risk is not in these numbers.</li>
          <li>Planning sheet only — no orders are placed and prices move between generation and execution.</li>
        </ol>
      </section>
    </div>
  );
}
