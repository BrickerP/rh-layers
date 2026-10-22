/**
 * Long-only Pareto frontier search over sleeve portfolios.
 * Path-based metrics (max drawdown) are not convex, so the frontier is found by
 * evaluating a deterministic candidate pool (corners, pairs, sparse random mixes,
 * mean-variance seeds) and refining around the current non-dominated set.
 */

export interface FrontierMetrics {
  cagr: number;
  vol: number;
  maxDD: number;
  sharpe: number;
}

export interface Candidate extends FrontierMetrics {
  w: Float64Array;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PortfolioEngine {
  readonly T: number;
  readonly N: number;
  private readonly R: Float64Array;
  private readonly rebalance: number;
  private readonly cashCagr: number;
  private readonly h: Float64Array;

  /** returns: N arrays of length T (weekly simple returns). */
  constructor(returns: number[][], opts: { rebalance?: number; cashCagr?: number } = {}) {
    this.N = returns.length;
    this.T = returns[0]?.length ?? 0;
    this.R = new Float64Array(this.T * this.N);
    for (let i = 0; i < this.N; i++) for (let t = 0; t < this.T; t++) this.R[t * this.N + i] = returns[i][t] ?? 0;
    this.rebalance = opts.rebalance ?? 52;
    this.cashCagr = opts.cashCagr ?? 0;
    this.h = new Float64Array(this.N);
  }

  evaluate(w: ArrayLike<number>): FrontierMetrics {
    const { T, N, R, h } = this;
    let V = 1;
    let peak = 1;
    let mdd = 0;
    let s = 0;
    let s2 = 0;
    for (let t = 0; t < T; t++) {
      if (t % this.rebalance === 0) for (let i = 0; i < N; i++) h[i] = w[i] * V;
      let nv = 0;
      const base = t * N;
      for (let i = 0; i < N; i++) {
        if (h[i] !== 0) {
          h[i] *= 1 + R[base + i];
          nv += h[i];
        }
      }
      const r = nv / V - 1;
      s += r;
      s2 += r * r;
      V = nv;
      if (V > peak) peak = V;
      const dd = V / peak - 1;
      if (dd < mdd) mdd = dd;
    }
    const cagr = V > 0 ? V ** (52 / T) - 1 : -1;
    const vol = T > 1 ? Math.sqrt(Math.max(0, (s2 - (s * s) / T) / (T - 1))) * Math.sqrt(52) : 0;
    return { cagr, vol, maxDD: mdd, sharpe: vol > 0 ? (cagr - this.cashCagr) / vol : 0 };
  }

  series(w: ArrayLike<number>): number[] {
    const { T, N, R } = this;
    const h = new Float64Array(N);
    const out: number[] = [];
    let V = 1;
    for (let t = 0; t < T; t++) {
      if (t % this.rebalance === 0) for (let i = 0; i < N; i++) h[i] = w[i] * V;
      let nv = 0;
      for (let i = 0; i < N; i++) {
        h[i] *= 1 + R[t * N + i];
        nv += h[i];
      }
      out.push(nv / V - 1);
      V = nv;
    }
    return out;
  }

  /** Weekly mean vector and covariance matrix. */
  moments(): { mu: number[]; cov: number[][] } {
    const { T, N, R } = this;
    const mu = new Array(N).fill(0);
    for (let t = 0; t < T; t++) for (let i = 0; i < N; i++) mu[i] += R[t * N + i] / T;
    const cov = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < N; i++) {
        const di = R[t * N + i] - mu[i];
        for (let j = i; j < N; j++) cov[i][j] += (di * (R[t * N + j] - mu[j])) / (T - 1);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
    return { mu, cov };
  }
}

function projectSimplex(v: number[]): number[] {
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let theta = 0;
  for (let k = 0; k < u.length; k++) {
    css += u[k];
    const t = (css - 1) / (k + 1);
    if (u[k] - t > 0) theta = t;
  }
  return v.map((x) => Math.max(0, x - theta));
}

export const riskDD = (c: FrontierMetrics): number => -c.maxDD;
export const riskVol = (c: FrontierMetrics): number => c.vol;

export function paretoFront(pool: Candidate[], risk: (c: FrontierMetrics) => number): Candidate[] {
  const sorted = [...pool].sort((a, b) => risk(a) - risk(b) || b.cagr - a.cagr);
  const out: Candidate[] = [];
  let best = -Infinity;
  for (const c of sorted) {
    if (c.cagr > best + 1e-7) {
      out.push(c);
      best = c.cagr;
    }
  }
  return out;
}

/** Evenly spaced points in risk; each is the best return achievable within that risk. */
export function thin(front: Candidate[], n: number, risk: (c: FrontierMetrics) => number): Candidate[] {
  if (front.length <= n) return front;
  const lo = risk(front[0]);
  const hi = risk(front[front.length - 1]);
  const out: Candidate[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = lo + ((hi - lo) * k) / (n - 1);
    while (j + 1 < front.length && risk(front[j + 1]) <= target + 1e-12) j++;
    if (out[out.length - 1] !== front[j]) out.push(front[j]);
  }
  if (out[out.length - 1] !== front[front.length - 1]) out.push(front[front.length - 1]);
  return out;
}

export function knee(front: FrontierMetrics[], risk: (c: FrontierMetrics) => number): number {
  if (front.length < 3) return 0;
  const x0 = risk(front[0]);
  const x1 = risk(front[front.length - 1]);
  const y0 = front[0].cagr;
  const y1 = front[front.length - 1].cagr;
  let best = 0;
  let bestScore = -Infinity;
  front.forEach((p, i) => {
    const x = (risk(p) - x0) / Math.max(1e-12, x1 - x0);
    const y = (p.cagr - y0) / Math.max(1e-12, y1 - y0);
    if (y - x > bestScore) {
      bestScore = y - x;
      best = i;
    }
  });
  return best;
}

export interface SearchOptions {
  seed?: number;
  random?: number;
  refineRounds?: number;
  neighbors?: number;
  /** Max weight per sleeve (1 = unconstrained). */
  cap?: number;
  /** Sleeves exempt from the cap (e.g. cash). */
  uncapped?: number[];
}

/** Clip weights at their caps and hand the excess to the sleeves still below theirs. */
export function capProject(w: Float64Array, caps: ArrayLike<number>): Float64Array {
  for (let pass = 0; pass < w.length; pass++) {
    let excess = 0;
    for (let i = 0; i < w.length; i++) {
      if (w[i] > caps[i]) {
        excess += w[i] - caps[i];
        w[i] = caps[i];
      }
    }
    if (excess < 1e-12) break;
    const free = [...w.keys()].filter((i) => w[i] < caps[i] - 1e-12);
    if (!free.length) break;
    const base = free.reduce((a, i) => a + w[i], 0);
    for (const i of free) w[i] += base > 0 ? (excess * w[i]) / base : excess / free.length;
  }
  return w;
}

export function searchPool(engine: PortfolioEngine, opts: SearchOptions = {}): Candidate[] {
  const N = engine.N;
  const cap = opts.cap ?? 1;
  const free = new Set(opts.uncapped ?? []);
  const caps = Float64Array.from({ length: N }, (_, i) => (free.has(i) ? 1 : cap));
  const capped = cap < 1;
  const rng = mulberry32(opts.seed ?? 7);
  const pool: Candidate[] = [];
  const add = (w: Float64Array) => {
    if (capped) {
      capProject(w, caps);
      for (let i = 0; i < N; i++) if (w[i] > caps[i] + 1e-9) return;
    }
    pool.push({ w, ...engine.evaluate(w) });
  };

  for (let i = 0; i < N; i++) {
    const w = new Float64Array(N);
    w[i] = 1;
    add(w);
  }
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      for (let k = 1; k < 20; k++) {
        const w = new Float64Array(N);
        w[i] = k / 20;
        w[j] = 1 - k / 20;
        add(w);
      }
    }
  }
  const minAssets = capped && !free.size ? Math.max(2, Math.ceil(1 / cap - 1e-9)) : 2;
  const random = opts.random ?? 30000;
  for (let n = 0; n < random; n++) {
    const span = Math.max(1, Math.min(5, N - minAssets + 1));
    const m = Math.min(N, minAssets + Math.floor(rng() * span));
    const idx = new Set<number>();
    while (idx.size < m) idx.add(Math.floor(rng() * N));
    const w = new Float64Array(N);
    let sum = 0;
    for (const i of idx) {
      w[i] = -Math.log(1 - rng());
      sum += w[i];
    }
    for (const i of idx) w[i] /= sum;
    add(w);
  }

  const { mu, cov } = engine.moments();
  const trace = cov.reduce((a, row, i) => a + row[i], 0);
  for (let k = 0; k < 36; k++) {
    const lambda = 10 ** (-1 + (k / 35) * 3.5);
    let w = new Array(N).fill(1 / N);
    const eta = 0.5 / (lambda * trace + 1e-9);
    for (let it = 0; it < 400; it++) {
      const g = mu.map((m, i) => m - lambda * cov[i].reduce((a, c, j) => a + c * w[j], 0));
      w = projectSimplex(w.map((x, i) => x + eta * g[i]));
    }
    add(Float64Array.from(w));
  }

  const steps = [0.01, 0.025, 0.05, 0.1];
  for (let round = 0; round < (opts.refineRounds ?? 4); round++) {
    const seeds = new Set<Candidate>([...thin(paretoFront(pool, riskDD), 70, riskDD), ...thin(paretoFront(pool, riskVol), 50, riskVol)]);
    for (const p of seeds) {
      for (let m = 0; m < (opts.neighbors ?? 24); m++) {
        const held = [...p.w.keys()].filter((i) => p.w[i] > 1e-9);
        const i = held[Math.floor(rng() * held.length)];
        let j = Math.floor(rng() * N);
        if (j === i) j = (j + 1) % N;
        const w = Float64Array.from(p.w);
        const d = Math.min(w[i], steps[Math.floor(rng() * steps.length)], Math.max(0, caps[j] - w[j]));
        if (d <= 1e-9) continue;
        w[i] -= d;
        w[j] += d;
        add(w);
      }
    }
  }
  return pool;
}
