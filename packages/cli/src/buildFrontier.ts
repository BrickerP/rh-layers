import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  PortfolioEngine,
  alignToCalendar,
  knee,
  paretoFront,
  riskDD,
  searchPool,
  thin,
  toWeekly,
  type Candidate,
  type PriceSeries,
} from '@rh-layers/core';

const ROOT = resolve(process.cwd(), '../..');
const SLEEVE_DIR = join(ROOT, 'data/sleeves');
const OUT = join(ROOT, 'apps/web/public/frontier.json');

interface SleeveFile {
  symbol: string;
  kind: 'etf' | 'stock' | 'crypto';
  adjusted: boolean;
  appendedFrom?: string;
  divYield: number;
  source: string;
  bars: { d: string; c: number }[];
  quote?: { price: number; asOf: string; source: string };
}

const SLEEVES = [
  { id: 'SPY', label: 'S&P 500', members: ['SPY'], color: '#94a3b8' },
  { id: 'COMPUTE', label: 'AI compute', members: ['SMH'], color: '#2dd4bf' },
  { id: 'MEMORY', label: 'Memory & storage', members: ['MU', 'WDC', 'STX'], color: '#0ea5e9' },
  { id: 'POWER', label: 'Power', members: ['VST', 'CEG', 'ETN', 'PWR', 'NEE'], color: '#f59e0b' },
  { id: 'MODELS', label: 'Model platforms', members: ['MSFT', 'GOOGL', 'META', 'AMZN'], color: '#6366f1' },
  { id: 'SPACE', label: 'Space', members: ['UFO'], color: '#38bdf8' },
  { id: 'ROBOTS', label: 'Robotics', members: ['BOTZ'], color: '#a78bfa' },
  { id: 'BTC', label: 'Bitcoin', members: ['BTC-USD'], color: '#fb923c' },
  { id: 'ETH', label: 'Ethereum', members: ['ETH-USD'], color: '#e879f9' },
  { id: 'CASH', label: 'Cash (1–3y UST)', members: ['VGSH'], color: '#64748b' },
  { id: 'GOLD', label: 'Gold', members: ['GLD'], color: '#eab308' },
] as const;

const GOLD = SLEEVES.findIndex((s) => s.id === 'GOLD');
const SPY = SLEEVES.findIndex((s) => s.id === 'SPY');
const CASH = SLEEVES.findIndex((s) => s.id === 'CASH');
const TARGETS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6];
const FIRST_TEST = 156;
const REBALANCE = 52;

const THESIS_MIX: Record<string, number> = { SPY: 0.3, COMPUTE: 0.13, MEMORY: 0.05, POWER: 0.12, MODELS: 0.12, SPACE: 0.05, ROBOTS: 0.05, BTC: 0.04, ETH: 0.02, CASH: 0.12 };

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

function stats(r: number[]) {
  let V = 1;
  let peak = 1;
  let mdd = 0;
  for (const x of r) {
    V *= 1 + x;
    peak = Math.max(peak, V);
    mdd = Math.min(mdd, V / peak - 1);
  }
  const m = mean(r);
  const vol = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, r.length - 1)) * Math.sqrt(52);
  return { cagr: round(V > 0 ? V ** (52 / Math.max(1, r.length)) - 1 : -1), vol: round(vol), maxDD: round(mdd) };
}

function corr(a: number[], b: number[]) {
  const ma = mean(a);
  const mb = mean(b);
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? c / Math.sqrt(va * vb) : 0;
}

/** Keep half of each sleeve's historical alpha over a CAPM prior (beta to SPY, cash as the risk-free leg). */
function haircut(all: number[][], kappa = 0.5): number[][] {
  const muS = mean(all[SPY]);
  const muC = mean(all[CASH]);
  const varS = all[SPY].reduce((a, x) => a + (x - muS) ** 2, 0);
  return all.map((r) => {
    const mu = mean(r);
    const cov = r.reduce((a, x, t) => a + (x - mu) * (all[SPY][t] - muS), 0);
    const beta = varS ? cov / varS : 0;
    const shift = (1 - kappa) * (mu - (muC + beta * (muS - muC)));
    return r.map((x) => x - shift);
  });
}

const expand = (w: ArrayLike<number>, idx: readonly number[]) => {
  const out = new Array(SLEEVES.length).fill(0);
  idx.forEach((i, j) => (out[i] = round(w[j])));
  return out;
};

const pickAt = (front: Candidate[], target: number) => {
  const ok = front.filter((c) => -c.maxDD <= target);
  return ok.length ? ok[ok.length - 1] : front[0];
};

async function main() {
  const files = new Map<string, SleeveFile>();
  for (const s of SLEEVES) for (const m of s.members) if (!files.has(m)) files.set(m, JSON.parse(await readFile(join(SLEEVE_DIR, `${m}.json`), 'utf8')));

  const calendar = files.get('SPY')!.bars.map((b) => b.d).filter((d) => d >= '2019-01-01');
  const list = [...files.values()];
  const { dates, closes } = toWeekly(calendar, alignToCalendar(list as unknown as PriceSeries[], calendar, 7));

  const vehicleRet = new Map<string, (number | null)[]>();
  for (const f of list) {
    const px = closes[f.symbol];
    const out: (number | null)[] = [null];
    for (let i = 1; i < dates.length; i++) {
      const a = px[i - 1];
      const b = px[i];
      if (a == null || b == null || a <= 0 || b <= 0) {
        out.push(null);
        continue;
      }
      const accrue = f.kind !== 'crypto' && (!f.adjusted || (f.appendedFrom != null && dates[i] > f.appendedFrom));
      out.push(b / a - 1 + (accrue ? f.divYield / 52 : 0));
    }
    vehicleRet.set(f.symbol, out);
  }
  const sleeveRaw = SLEEVES.map((s) =>
    dates.map((_, i) => {
      const xs = s.members.map((m) => vehicleRet.get(m)![i]).filter((x): x is number => x != null);
      return xs.length ? mean(xs) : null;
    }),
  );
  let start = 1;
  while (start < dates.length && sleeveRaw.some((r) => r[start] == null)) start++;
  const ret = sleeveRaw.map((r) => r.slice(start).map((x) => x ?? 0));
  const weeks = ret[0].length;
  const window = { start: dates[start - 1], end: dates[dates.length - 1], weeks };
  const oosWindow = { start: dates[start - 1 + FIRST_TEST], end: window.end, weeks: weeks - FIRST_TEST };
  const cashCagr = stats(ret[CASH]).cagr;
  console.log(`window ${window.start} → ${window.end} (${weeks}w) · walk-forward from ${oosWindow.start} (${oosWindow.weeks}w)`);

  const universes = { gold: [...SLEEVES.keys()], thesis: [...SLEEVES.keys()].filter((i) => i !== GOLD) } as const;
  const transformed = { haircut: haircut(ret), hindsight: ret };
  const configs: Record<string, unknown> = {};

  // Primary: haircut estimate, 25% cap per risky sleeve (cash uncapped), with and without gold.
  // Reference: the hindsight estimate, to show how much an in-sample frontier over-promises.
  const CAP = 0.25;
  const runs = [
    { key: 'gold', method: 'haircut', uni: 'gold' },
    { key: 'thesis', method: 'haircut', uni: 'thesis' },
    { key: 'hindsight', method: 'hindsight', uni: 'gold' },
  ] as const;
  for (const run of runs) {
    {
      {
        const { key, method } = run;
        const cap = CAP;
        const idx = universes[run.uni];
        const t0 = Date.now();
        const full = new PortfolioEngine(idx.map((i) => transformed[method][i]), { rebalance: REBALANCE, cashCagr });
        const uncapped = [idx.indexOf(CASH)];
        const pool = searchPool(full, { seed: 29, random: 30000, refineRounds: 4, cap, uncapped });
        const front = paretoFront(pool, riskDD);
        const curve = thin(front, 60, riskDD);

        const realised = TARGETS.map(() => [] as number[]);
        for (let s = FIRST_TEST; s < weeks; s += 52) {
          const e = Math.min(weeks, s + 52);
          const trainAll = ret.map((r) => r.slice(0, s));
          const trainData = method === 'haircut' ? haircut(trainAll) : trainAll;
          const train = new PortfolioEngine(idx.map((i) => trainData[i]), { rebalance: REBALANCE });
          const test = new PortfolioEngine(idx.map((i) => ret[i].slice(s, e)), { rebalance: REBALANCE });
          const trainFront = paretoFront(searchPool(train, { seed: 17 + s, random: 12000, refineRounds: 2, neighbors: 16, cap, uncapped }), riskDD);
          TARGETS.forEach((t, k) => realised[k].push(...test.series(pickAt(trainFront, t).w)));
        }

        const rules = TARGETS.map((t, k) => {
          const today = pickAt(front, t);
          return { target: t, w: expand(today.w, idx), is: { cagr: round(today.cagr), maxDD: round(today.maxDD), vol: round(today.vol) }, oos: stats(realised[k]) };
        });
        // Realised Pareto set across targets: a rule is efficient if no other rule realised more return with less drawdown.
        const efficient = rules.map((r) => !rules.some((o) => o !== r && o.oos.cagr >= r.oos.cagr && o.oos.maxDD >= r.oos.maxDD && (o.oos.cagr > r.oos.cagr || o.oos.maxDD > r.oos.maxDD)));
        const effIdx = rules.map((_, i) => i).filter((i) => efficient[i]).sort((a, b) => rules[b].oos.maxDD - rules[a].oos.maxDD);
        const effPts = effIdx.map((i) => ({ cagr: rules[i].oos.cagr, maxDD: rules[i].oos.maxDD, vol: rules[i].oos.vol, sharpe: 0 }));
        const kneeRule = effIdx[knee(effPts, riskDD)] ?? 0;

        configs[key] = {
          curve: curve.map((c) => ({ w: expand(c.w, idx), cagr: round(c.cagr), vol: round(c.vol), maxDD: round(c.maxDD) })),
          rules: rules.map((r, i) => ({ ...r, efficient: efficient[i] })),
          knee: kneeRule,
        };
        const kr = rules[kneeRule];
        console.log(`${key.padEnd(22)} ${Date.now() - t0}ms · knee DD≤${kr.target * 100}% → realised ${(kr.oos.cagr * 100).toFixed(1)}% / ${(kr.oos.maxDD * 100).toFixed(1)}% (in-sample ${(kr.is.cagr * 100).toFixed(1)}%)`);
      }
    }
  }

  // Robust family: a fixed diversified risky basket blended with cash. The only estimated
  // parameter is the risky share λ, chosen on past data to stay within the drawdown target.
  const RISKY = SLEEVES.map((s, i) => i).filter((i) => i !== CASH && i !== GOLD);
  const baskets = {
    ew: SLEEVES.map((_, i) => (RISKY.includes(i) ? 1 / RISKY.length : 0)),
    ewGold: SLEEVES.map((_, i) => (i === CASH ? 0 : 1 / (SLEEVES.length - 1))),
    mix: (() => {
      const w = SLEEVES.map((s) => (s.id === 'CASH' ? 0 : THESIS_MIX[s.id] ?? 0));
      const t = w.reduce((a, b) => a + b, 0);
      return w.map((x) => x / t);
    })(),
  };
  const lambdas = Array.from({ length: 41 }, (_, i) => i / 40);
  const blend = (b: number[], l: number) => b.map((x, i) => x * l + (i === CASH ? 1 - l : 0));
  const robust: Record<string, unknown> = {};
  for (const [name, b] of Object.entries(baskets)) {
    const fullEngine = new PortfolioEngine(ret, { rebalance: REBALANCE, cashCagr });
    const curve = lambdas.map((l) => ({ lambda: l, ...fullEngine.evaluate(blend(b, l)) }));
    const realised = TARGETS.map(() => [] as number[]);
    const todays: number[] = [];
    for (let s = FIRST_TEST; s < weeks; s += 52) {
      const e = Math.min(weeks, s + 52);
      const train = new PortfolioEngine(ret.map((r) => r.slice(0, s)), { rebalance: REBALANCE });
      const test = new PortfolioEngine(ret.map((r) => r.slice(s, e)), { rebalance: REBALANCE });
      const fits = lambdas.map((l) => ({ l, dd: -train.evaluate(blend(b, l)).maxDD }));
      TARGETS.forEach((t, k) => {
        const ok = fits.filter((f) => f.dd <= t);
        const l = ok.length ? ok[ok.length - 1].l : 0;
        realised[k].push(...test.series(blend(b, l)));
      });
    }
    const rules = TARGETS.map((t, k) => {
      const ok = curve.filter((c) => -c.maxDD <= t);
      const today = ok.length ? ok[ok.length - 1] : curve[0];
      todays.push(today.lambda);
      return { target: t, lambda: today.lambda, w: blend(b, today.lambda).map((x) => round(x)), is: { cagr: round(today.cagr), maxDD: round(today.maxDD), vol: round(today.vol) }, oos: stats(realised[k]) };
    });
    robust[name] = { basket: b.map((x) => round(x)), curve: curve.map((c) => ({ lambda: c.lambda, cagr: round(c.cagr), vol: round(c.vol), maxDD: round(c.maxDD) })), rules };
    console.log(`robust ${name}:`);
    for (const r of rules) console.log(`  DD≤${String(r.target * 100).padStart(2)}% λ=${r.lambda.toFixed(3)}  in-sample ${(r.is.cagr * 100).toFixed(1).padStart(5)}% / ${(r.is.maxDD * 100).toFixed(1)}%  →  realised ${(r.oos.cagr * 100).toFixed(1).padStart(5)}% / ${(r.oos.maxDD * 100).toFixed(1)}%`);
  }

  const fixed = (w: number[], slice?: [number, number]) => {
    const data = slice ? ret.map((r) => r.slice(slice[0], slice[1])) : ret;
    return stats(new PortfolioEngine(data, { rebalance: REBALANCE }).series(w));
  };
  const benchList = [
    ...SLEEVES.map((s, i) => ({ id: s.id, label: s.label, kind: 'sleeve', w: SLEEVES.map((_, j) => (j === i ? 1 : 0)) })),
    { id: 'MIX', label: 'Thesis mix 30/18/12/12/6/5/5/12', kind: 'mix', w: SLEEVES.map((s) => THESIS_MIX[s.id] ?? 0) },
    { id: 'SPYGLD', label: 'SPY 60 / Gold 40', kind: 'mix', w: SLEEVES.map((s) => (s.id === 'SPY' ? 0.6 : s.id === 'GOLD' ? 0.4 : 0)) },
    { id: 'EQUAL', label: 'Equal weight (11 sleeves)', kind: 'mix', w: SLEEVES.map(() => 1 / SLEEVES.length) },
  ];
  const benchmarks = benchList.map((b) => ({ ...b, full: fixed(b.w), oos: fixed(b.w, [FIRST_TEST, weeks]) }));

  const sleeveStats = SLEEVES.map((s, i) => ({ id: s.id, beta: round(corr(ret[i], ret[SPY]) * (Math.sqrt(ret[i].reduce((a, x) => a + (x - mean(ret[i])) ** 2, 0)) / Math.sqrt(ret[SPY].reduce((a, x) => a + (x - mean(ret[SPY])) ** 2, 0))), 2), corrSpy: round(corr(ret[i], ret[SPY]), 2) }));
  const vehicles = Object.fromEntries(
    list.map((f) => [f.symbol, { price: f.quote?.price ?? null, asOf: f.quote?.asOf ?? null, basis: f.kind === 'crypto' ? 'spot' : f.adjusted ? 'total return' : `price + ${(f.divYield * 100).toFixed(1)}% yield` }]),
  );

  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      window,
      oosWindow,
      rebalance: 'annual',
      cap: CAP,
      targets: TARGETS,
      sleeves: SLEEVES.map((s) => ({ ...s, members: [...s.members] })),
      sleeveStats,
      configs,
      robust,
      benchmarks,
      vehicles,
    }),
  );
  const spy = benchmarks.find((b) => b.id === 'SPY')!;
  console.log(`SPY full ${(spy.full.cagr * 100).toFixed(1)}% / ${(spy.full.maxDD * 100).toFixed(1)}% · SPY walk-forward window ${(spy.oos.cagr * 100).toFixed(1)}% / ${(spy.oos.maxDD * 100).toFixed(1)}%`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
