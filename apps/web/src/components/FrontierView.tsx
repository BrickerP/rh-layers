import React, { useEffect, useState } from 'react';

export interface Stat {
  cagr: number;
  maxDD: number;
  vol: number;
}
export interface Sleeve {
  id: string;
  label: string;
  members: string[];
  color: string;
}
export interface OptRule {
  target: number;
  w: number[];
  is: Stat;
  oos: Stat;
  efficient: boolean;
}
export interface RobustRule {
  target: number;
  lambda: number;
  w: number[];
  is: Stat;
  oos: Stat;
}
export interface FrontierData {
  generatedAt: string;
  window: { start: string; end: string; weeks: number };
  oosWindow: { start: string; end: string; weeks: number };
  cap: number;
  targets: number[];
  sleeves: Sleeve[];
  configs: Record<'gold' | 'thesis' | 'hindsight', { curve: (Stat & { w: number[] })[]; rules: OptRule[]; knee: number }>;
  robust: Record<BasketId, { basket: number[]; curve: (Stat & { lambda: number })[]; rules: RobustRule[] }>;
  benchmarks: { id: string; label: string; kind: string; w: number[]; full: Stat; oos: Stat }[];
  vehicles: Record<string, { price: number | null; asOf: string | null; basis: string }>;
}
export type BasketId = 'ewGold' | 'ew' | 'mix';
export type Family = 'opt' | BasketId;
export interface Pick {
  family: Family;
  k: number;
}

export const BASKETS: { id: BasketId; label: string; note: string }[] = [
  { id: 'ewGold', label: 'Equal weight + gold', note: '10 risky sleeves at 10% each, no forecasts' },
  { id: 'ew', label: 'Equal weight', note: '9 thesis sleeves at 1/9 each, no gold' },
  { id: 'mix', label: 'Thesis mix', note: 'hand weights 30/18/12/12/6/5/5 — set with hindsight' },
];

export const FAMILIES: { id: Family; label: string; note: string }[] = [
  { id: 'opt', label: 'Optimized', note: 'frontier weights, re-estimated yearly' },
  ...BASKETS.map((b) => ({ id: b.id as Family, label: `Robust · ${b.label}`, note: b.note })),
];

export interface ResolvedRule {
  target: number;
  w: number[];
  is: Stat;
  oos: Stat;
  cashShare: number;
  title: string;
}

export function resolveRule(data: FrontierData, pick: Pick): ResolvedRule {
  if (pick.family === 'opt') {
    const r = data.configs.gold.rules[pick.k];
    const cash = r.w[data.sleeves.findIndex((s) => s.id === 'CASH')] ?? 0;
    return { target: r.target, w: r.w, is: r.is, oos: r.oos, cashShare: cash, title: `Optimized frontier point · ${pct(1 - cash, 0)} risky + ${pct(cash, 0)} cash` };
  }
  const r = data.robust[pick.family].rules[pick.k];
  const label = BASKETS.find((b) => b.id === pick.family)!.label;
  return { target: r.target, w: r.w, is: r.is, oos: r.oos, cashShare: 1 - r.lambda, title: `${pct(r.lambda, 0)} ${label} + ${pct(1 - r.lambda, 0)} cash` };
}

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const PICK_KEY = 'rh-frontier-pick';

export function loadPick(data: FrontierData): Pick {
  try {
    const p = JSON.parse(localStorage.getItem(PICK_KEY) ?? '') as Pick;
    if (p.family === 'opt' ? data.configs.gold.rules[p.k] : data.robust[p.family]?.rules[p.k]) return p;
  } catch {
    /* default below */
  }
  return { family: 'ewGold', k: Math.max(0, data.targets.indexOf(0.25)) };
}

/** Best realised CAGR among rules whose realised drawdown stayed within `limit`. */
function bestWithin(rules: { oos: Stat }[], limit: number): number | null {
  const ok = rules.filter((r) => -r.oos.maxDD <= limit + 1e-9);
  return ok.length ? Math.max(...ok.map((r) => r.oos.cagr)) : null;
}

export function savePick(p: Pick) {
  localStorage.setItem(PICK_KEY, JSON.stringify(p));
}

export function useFrontier(): FrontierData | null {
  const [data, setData] = useState<FrontierData | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}frontier.json`)
      .then((r) => r.json() as Promise<FrontierData>)
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data;
}

const W = 600;
const H = 360;
const PAD = { l: 46, r: 14, t: 14, b: 34 };

function Chart({
  title,
  sub,
  xMax,
  yMax,
  lines,
  dots,
  selected,
  onPick,
}: {
  title: string;
  sub: string;
  xMax: number;
  yMax: number;
  lines: { pts: Stat[]; color: string; width: number; dash?: string; label: string; markers?: boolean; hollow?: boolean; pickable?: boolean }[];
  dots: { s: Stat; label: string; color: string; dx?: number; dy?: number; end?: boolean }[];
  selected?: Stat;
  onPick?: (k: number) => void;
}) {
  const x = (dd: number) => PAD.l + (Math.min(-dd, xMax) / xMax) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + (1 - Math.max(0, Math.min(c, yMax)) / yMax) * (H - PAD.t - PAD.b);
  const xt = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].filter((v) => v <= xMax + 1e-9);
  const yt = Array.from({ length: Math.floor(yMax / 0.1) + 1 }, (_, i) => i * 0.1);
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="dim">{sub}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pareto">
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="axis">
              {pct(v, 0)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={x(-v)} y={H - 14} textAnchor="middle" className="axis">
            {v === 0 ? '0' : `−${(v * 100).toFixed(0)}%`}
          </text>
        ))}
        <text x={W - PAD.r} y={H - 2} textAnchor="end" className="axis">
          max drawdown →
        </text>
        <text x={PAD.l} y={PAD.t - 2} className="axis">
          CAGR
        </text>
        {lines.map((l) => (
          <g key={l.label}>
            <path
              d={l.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.maxDD)},${y(p.cagr)}`).join(' ')}
              fill="none"
              stroke={l.color}
              strokeWidth={l.width}
              strokeDasharray={l.dash}
              opacity={0.9}
            />
            {l.markers &&
              l.pts.map((p, i) => (
                <circle
                  key={i}
                  cx={x(p.maxDD)}
                  cy={y(p.cagr)}
                  r={3.2}
                  fill={l.hollow ? '#0a0f16' : l.color}
                  stroke={l.color}
                  strokeWidth={1.4}
                  className={l.pickable ? 'pick' : undefined}
                  onClick={l.pickable && onPick ? () => onPick(i) : undefined}
                />
              ))}
          </g>
        ))}
        {dots.map((d) => (
          <g key={d.label}>
            <circle cx={x(d.s.maxDD)} cy={y(d.s.cagr)} r={3.4} fill={d.color} />
            {d.label && (
              <text x={x(d.s.maxDD) + (d.dx ?? 6)} y={y(d.s.cagr) + (d.dy ?? -5)} textAnchor={d.end ? 'end' : 'start'} className="dot-label">
                {d.label}
              </text>
            )}
          </g>
        ))}
        {selected && <circle cx={x(selected.maxDD)} cy={y(selected.cagr)} r={8} fill="none" stroke="#fff" strokeWidth={1.6} />}
      </svg>
      <div className="legend-row">
        {lines.map((l) => (
          <span key={l.label}>
            <i style={{ background: l.color, opacity: l.dash ? 0.6 : 1 }} />
            {l.label}
          </span>
        ))}
      </div>
    </section>
  );
}

const DOT_STYLE: Record<string, { label: string; dx?: number; dy?: number; end?: boolean }> = {
  SPY: { label: 'SPY', dx: 6, dy: -6 },
  GOLD: { label: 'Gold', dx: 6, dy: 12 },
  CASH: { label: 'Cash', dx: 6, dy: -6 },
  SPYGLD: { label: 'SPY/Gold', dx: -6, dy: -6, end: true },
};

export default function FrontierView({ onImplement }: { onImplement: () => void }) {
  const data = useFrontier();
  const [pick, setPick] = useState<Pick | null>(null);
  useEffect(() => {
    if (data) setPick(loadPick(data));
  }, [data]);

  if (!data || !pick) return <div className="empty"><div className="empty-card"><h1>Loading frontier…</h1></div></div>;

  const choose = (p: Pick) => {
    setPick(p);
    savePick(p);
  };
  const rule = resolveRule(data, pick);
  const shownBasket: BasketId = pick.family === 'opt' ? 'ewGold' : pick.family;
  const robust = data.robust[shownBasket];
  const optRules = data.configs.gold.rules;
  const opt = optRules[pick.k];
  const bench = (id: string) => data.benchmarks.find((b) => b.id === id)!;
  const spy = bench('SPY');
  const dots = (which: 'full' | 'oos', labels: boolean) =>
    Object.entries(DOT_STYLE).map(([id, st]) => ({ s: bench(id)[which], color: '#94a3b8', ...st, label: labels ? st.label : '' }));
  const yMaxFull = Math.ceil(Math.max(...data.configs.gold.curve.map((p) => p.cagr), ...robust.curve.map((p) => p.cagr)) * 10 + 0.5) / 10;
  const yMaxOos =
    Math.ceil(Math.max(...robust.rules.map((r) => r.oos.cagr), ...optRules.map((r) => r.oos.cagr), spy.oos.cagr) * 10 + 0.5) / 10;
  const held = rule.w.map((w, i) => ({ w, s: data.sleeves[i] })).filter((x) => x.w > 0.0005).sort((a, b) => b.w - a.w);
  const maxW = Math.max(...held.map((h) => h.w), 0.01);
  const basketLabel = BASKETS.find((b) => b.id === shownBasket)!.label;
  const lowOpt = bestWithin(optRules, 0.15);
  const lowRob = bestWithin(robust.rules, 0.15);
  const hiOpt = bestWithin(optRules, 0.3);
  const hiRob = bestWithin(robust.rules, 0.3);
  const ewG = data.robust.ewGold.rules[pick.k].oos;
  const ew = data.robust.ew.rules[pick.k].oos;
  const mix = data.robust.mix.rules[pick.k];
  const fmt = (v: number | null) => (v == null ? 'n/a' : pct(v));

  return (
    <div className="frontier">
      <div className="sheet-head">
        <div>
          <div className="kicker">
            pareto frontier · {data.window.start} → {data.window.end} · {data.sleeves.length} sleeves · annual rebalance · ≤{pct(data.cap, 0)} per risky sleeve
          </div>
          <h1>The optimal curve on paper, and the one that held up</h1>
          <p>Every point is a mix where you cannot get more return without a deeper drawdown. Left: estimated on all data. Right: what following each rule actually delivered.</p>
        </div>
      </div>

      <div className="chart-grid">
        <Chart
          title="Estimated frontier"
          sub={`${data.window.start} → ${data.window.end}`}
          xMax={0.6}
          yMax={yMaxFull}
          lines={[
            { pts: data.configs.gold.curve, color: '#2dd4bf', width: 2, label: 'optimized (alpha haircut 50%)' },
            { pts: data.configs.thesis.curve, color: '#475569', width: 1.2, label: 'optimized, no gold' },
            { pts: robust.curve, color: '#f8fafc', width: 1.6, dash: '5 4', label: `robust: ${basketLabel} ↔ cash` },
            pick.family === 'opt'
              ? { pts: optRules.map((r) => r.is), color: '#2dd4bf', width: 0, label: 'targets', markers: true, hollow: true, pickable: true }
              : { pts: robust.rules.map((r) => r.is), color: '#f8fafc', width: 0, label: 'targets', markers: true, pickable: true },
          ]}
          dots={dots('full', true)}
          selected={rule.is}
          onPick={(k) => choose({ ...pick, k })}
        />
        <Chart
          title="Walk-forward reality"
          sub={`${data.oosWindow.start} → ${data.oosWindow.end} · re-estimated yearly on past data only`}
          xMax={0.6}
          yMax={yMaxOos}
          lines={[
            { pts: optRules.map((r) => r.oos), color: '#2dd4bf', width: 1.4, label: 'optimized rules, realised', markers: true, hollow: true },
            { pts: robust.rules.map((r) => r.oos), color: '#f8fafc', width: 1.6, label: `robust ${basketLabel}, realised`, markers: true },
          ]}
          dots={dots('oos', false)}
          selected={rule.oos}
        />
      </div>

      <div className="controls">
        <div className="seg">
          <span className="seg-label">rule</span>
          {FAMILIES.map((f) => (
            <button key={f.id} className={f.id === pick.family ? 'on' : ''} title={f.note} onClick={() => choose({ ...pick, family: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="seg">
          <span className="seg-label">drawdown target</span>
          {data.targets.map((t, k) => (
            <button key={t} className={k === pick.k ? 'on' : ''} onClick={() => choose({ ...pick, k })}>
              {pct(t, 0)}
            </button>
          ))}
        </div>
      </div>

      <div className="result-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>{rule.title}</h3>
            <span className="dim">target drawdown ≤ {pct(rule.target, 0)}</span>
          </div>
          <div className="trio">
            <div>
              <span>estimated</span>
              <b>{pct(rule.is.cagr)}</b>
              <i>DD {pct(rule.is.maxDD)}</i>
            </div>
            <div>
              <span>walk-forward</span>
              <b className="pos">{pct(rule.oos.cagr)}</b>
              <i>DD {pct(rule.oos.maxDD)}</i>
            </div>
            <div>
              <span>SPY, same weeks</span>
              <b>{pct(spy.oos.cagr)}</b>
              <i>DD {pct(spy.oos.maxDD)}</i>
            </div>
          </div>
          <div className="wlist">
            {held.map(({ w, s }) => (
              <div key={s.id} className="wrow static">
                <span>{s.label}</span>
                <span className="wbar">
                  <i style={{ width: `${(w / maxW) * 100}%`, background: s.color }} />
                </span>
                <b>{pct(w)}</b>
                <span className="mono dim vehicles">{s.members.join(' ')}</span>
              </div>
            ))}
          </div>
          <button className="implement" onClick={onImplement}>
            Implement on Portfolio →
          </button>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>What the curve says</h3>
            <span className="dim">computed from this run</span>
          </div>
          <ul className="takeaways">
            <li>
              At a {pct(rule.target, 0)} target the optimized frontier promised <b>{pct(opt.is.cagr)}</b>; walk-forward it delivered <b>{pct(opt.oos.cagr)}</b> with a{' '}
              <b>{pct(opt.oos.maxDD)}</b> drawdown. Estimates on history over-promise.
            </li>
            <li>
              Matched on realised risk — within a 15% drawdown: optimized <b>{fmt(lowOpt)}</b>, robust {basketLabel} <b>{fmt(lowRob)}</b>. Within 30%: optimized{' '}
              <b>{fmt(hiOpt)}</b>, robust <b>{fmt(hiRob)}</b>.{' '}
              {lowOpt != null && lowRob != null && hiOpt != null && hiRob != null && lowOpt > lowRob && hiRob > hiOpt
                ? 'Optimizing helped at low risk (cash, gold and power tilts held up) and hurt at high risk, where it concentrated into recent winners.'
                : 'Neither method wins everywhere; pick the rule by the drawdown you want, not by the estimate.'}
            </li>
            <li>
              Gold as the hedge: equal weight with gold realised {pct(ewG.cagr)} / {pct(ewG.maxDD)} at this target, without gold {pct(ew.cagr)} / {pct(ew.maxDD)}.
            </li>
            <li>
              The thesis mix scaled with cash realised {pct(mix.oos.cagr)} / {pct(mix.oos.maxDD)} here — the best line on the chart, but I set those weights in 2026 with hindsight. The sleeves
              themselves are post-AI-run picks too: walk-forward tests the weighting rule, not whether the theme keeps working.
            </li>
          </ul>
        </section>
      </div>

      <div className="sheet-foot">
        <span>weekly data · annual rebalance · SMH/UFO/BOTZ/GLD/VST price + yield, others total return</span>
        <span>generated {data.generatedAt.slice(0, 10)}</span>
        <span>not investment advice · no orders placed</span>
      </div>
    </div>
  );
}
