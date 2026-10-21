import React, { useEffect, useState } from 'react';

interface ClassRow {
  symbol: string;
  name: string;
  group: string;
  cagr: number;
  vol: number;
  maxDD: number;
  sharpe: number;
  beta: number;
  corrSpy: number;
  corrRates: number;
  corrGold: number;
  stress: number;
}
interface Mix {
  name: string;
  weights: Record<string, number>;
  cagr: number;
  vol: number;
  maxDD: number;
  sharpe: number;
}
interface Classes {
  period: string;
  classes: ClassRow[];
  mixes: Mix[];
  hedges: {
    equity: { symbol: string; corr: number; stress: number }[];
    rates: { symbol: string; corr: number }[];
    debasement: { symbol: string; corr: number }[];
  };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export default function ClassesView() {
  const [data, setData] = useState<Classes | null>(null);
  const [mix, setMix] = useState('Balanced');

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}classes.json`)
      .then((r) => r.json() as Promise<Classes>)
      .then(setData)
      .catch(() => undefined);
  }, []);

  if (!data) return <div className="empty"><div className="empty-card"><h1>classes.json missing</h1></div></div>;

  const selected = data.mixes.find((m) => m.name === mix) ?? data.mixes[0];
  const byName = new Map(data.classes.map((c) => [c.symbol, c]));

  return (
    <div className="classes">
      <div className="sheet-head">
        <div>
          <div className="kicker">asset classes · hedge structure · annual rebalance</div>
          <h1>What to own, and what hedges what</h1>
          <p>{data.period} · 17 liquid asset classes · no stock picking, no daily signals</p>
        </div>
      </div>

      <div className="mix-cards">
        {data.mixes.map((m) => (
          <button key={m.name} className={`mix-card ${m.name === mix ? 'on' : ''}`} onClick={() => setMix(m.name)}>
            <span className="mix-name">{m.name}</span>
            <b className="pos">{pct(m.cagr)}</b>
            <span className="mix-meta">
              DD {pct(m.maxDD)} · Sharpe {m.sharpe.toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      <div className="result-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>{selected.name} mix</h3>
            <span className="dim">annual rebalance · strategic weights</span>
          </div>
          <div className="wlist">
            {Object.entries(selected.weights)
              .sort((a, b) => b[1] - a[1])
              .map(([s, w]) => (
                <div key={s} className="wrow static">
                  <span className="mono">{s}</span>
                  <span className="wbar">
                    <i style={{ width: `${(w / Math.max(...Object.values(selected.weights))) * 100}%` }} />
                  </span>
                  <b>{pct(w)}</b>
                </div>
              ))}
          </div>
          <div className="notes">
            <span>CAGR {pct(selected.cagr)}</span>
            <span>vol {pct(selected.vol)}</span>
            <span>max DD {pct(selected.maxDD)}</span>
            <span>Sharpe {selected.sharpe.toFixed(2)}</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Hedges</h3>
            <span className="dim">low correlation + positive stress = hedge</span>
          </div>
          <div className="hedge-block">
            <h4>equity crash</h4>
            {data.hedges.equity.map((h) => (
              <div key={h.symbol} className="hedge-row">
                <span className="mono">{h.symbol}</span>
                <span className="dim">{byName.get(h.symbol)?.name}</span>
                <b className={h.corr < 0.2 ? 'pos' : ''}>{h.corr.toFixed(2)}</b>
                <i className={h.stress > 0 ? 'pos' : 'neg'}>stress {pct(h.stress, 1)}</i>
              </div>
            ))}
          </div>
          <div className="hedge-block">
            <h4>rates / inflation</h4>
            {data.hedges.rates.slice(0, 4).map((h) => (
              <div key={h.symbol} className="hedge-row">
                <span className="mono">{h.symbol}</span>
                <span className="dim">{byName.get(h.symbol)?.name}</span>
                <b className={h.corr < 0 ? 'pos' : ''}>{h.corr.toFixed(2)}</b>
              </div>
            ))}
          </div>
          <div className="hedge-block">
            <h4>debasement / inflation</h4>
            {['GLD', 'DBC', 'TIP', 'BTC-USD'].map((s) => {
              const c = byName.get(s);
              return (
                <div key={s} className="hedge-row">
                  <span className="mono">{s}</span>
                  <span className="dim">{c?.name}</span>
                  <b className="pos">{c ? c.corrGold.toFixed(2) : '—'}</b>
                  <i className="dim">corr gold</i>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Class quality</h3>
          <span className="dim">10y weekly · USD · total return where available</span>
        </div>
        <table className="table class-table">
          <thead>
            <tr>
              <th>class</th>
              <th>group</th>
              <th className="right">CAGR</th>
              <th className="right">vol</th>
              <th className="right">max DD</th>
              <th className="right">Sharpe</th>
              <th className="right">β SPY</th>
              <th className="right">corr SPY</th>
              <th className="right">corr rates</th>
              <th className="right">corr gold</th>
              <th className="right">SPY worst 10%</th>
            </tr>
          </thead>
          <tbody>
            {data.classes.map((c) => (
              <tr key={c.symbol}>
                <td>
                  <span className="mono strong">{c.symbol}</span> <span className="dim">{c.name}</span>
                </td>
                <td className="dim">{c.group}</td>
                <td className="right mono pos">{pct(c.cagr)}</td>
                <td className="right mono">{pct(c.vol)}</td>
                <td className="right mono neg">{pct(c.maxDD)}</td>
                <td className="right mono">{c.sharpe.toFixed(2)}</td>
                <td className="right mono">{c.beta.toFixed(2)}</td>
                <td className={`right mono ${c.corrSpy < 0.2 ? 'pos' : ''}`}>{c.corrSpy.toFixed(2)}</td>
                <td className={`right mono ${c.corrRates < 0 ? 'pos' : ''}`}>{c.corrRates.toFixed(2)}</td>
                <td className={`right mono ${c.corrGold < 0.2 ? 'pos' : ''}`}>{c.corrGold.toFixed(2)}</td>
                <td className={`right mono ${c.stress >= 0 ? 'pos' : 'neg'}`}>{pct(c.stress, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Quality is measured over one 10-year window, not promised. “SPY worst 10%” is the average weekly return in the worst 10% of equity
          weeks — the real test of a hedge. Gold is the debasement hedge; long Treasuries and cash hedge equity crashes; commodities hedge
          rates/inflation.
        </p>
      </section>
    </div>
  );
}
