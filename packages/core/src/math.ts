/** Small, dependency-free statistics used by every layer. */

export const mean = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);

export function variance(x: number[]): number {
  if (x.length < 2) return 0;
  const m = mean(x);
  return x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1);
}

export const stdev = (x: number[]): number => Math.sqrt(variance(x));

export function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

export function correlation(x: number[], y: number[]): number {
  const sx = stdev(x);
  const sy = stdev(y);
  if (!sx || !sy) return 0;
  return covariance(x, y) / (sx * sy);
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function beta(asset: number[], bench: number[]): number {
  const v = variance(bench);
  return v ? covariance(asset, bench) / v : 0;
}

export function skewness(x: number[]): number {
  const m = mean(x);
  const s = stdev(x);
  if (!s) return 0;
  return (x.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / x.length) || 0;
}

export function kurtosis(x: number[]): number {
  const m = mean(x);
  const s = stdev(x);
  if (!s) return 0;
  return (x.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / x.length) - 3;
}

export function cumulative(returns: number[]): number[] {
  let v = 1;
  return returns.map((r) => (v *= 1 + r));
}

export function drawdownSeries(returns: number[]): number[] {
  let v = 1;
  let peak = 1;
  return returns.map((r) => {
    v *= 1 + r;
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

export function maxDrawdown(returns: number[]): number {
  return Math.min(0, ...drawdownSeries(returns));
}

export function annualize(returns: number[], periodsPerYear = 52): { cagr: number; vol: number; sharpe: number; sortino: number } {
  if (!returns.length) return { cagr: 0, vol: 0, sharpe: 0, sortino: 0 };
  const total = returns.reduce((a, r) => a * (1 + r), 1);
  const years = returns.length / periodsPerYear;
  const cagr = total > 0 ? total ** (1 / years) - 1 : 0;
  const vol = stdev(returns) * Math.sqrt(periodsPerYear);
  const downs = returns.filter((r) => r < 0);
  const dvol = stdev(downs) * Math.sqrt(periodsPerYear);
  return { cagr, vol, sharpe: vol ? cagr / vol : 0, sortino: dvol ? cagr / dvol : 0 };
}

/** Worst rolling 12-month compound return. */
export function worst12m(returns: number[], periodsPerYear = 52): number {
  const w = periodsPerYear;
  if (returns.length < w) return 0;
  let worst = 0;
  for (let i = 0; i + w <= returns.length; i++) {
    let c = 1;
    for (let j = i; j < i + w; j++) c *= 1 + returns[j];
    worst = Math.min(worst, c - 1);
  }
  return worst;
}

/** Weeks from max-drawdown trough back to the prior peak (0 when not recovered). */
export function recoveryWeeks(returns: number[]): number {
  let v = 1;
  let peak = 1;
  let peakIdx = 0;
  let worst = 0;
  let worstIdx = 0;
  returns.forEach((r, i) => {
    v *= 1 + r;
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = v / peak - 1;
    if (dd < worst) {
      worst = dd;
      worstIdx = i;
    }
  });
  if (worst === 0) return 0;
  for (let i = worstIdx; i < returns.length; i++) {
    let c = 1;
    for (let j = peakIdx; j <= i; j++) c *= 1 + returns[j];
    if (c >= 1) return i - worstIdx;
  }
  return 0;
}

/**
 * Ledoit-Wolf shrinkage towards a constant-correlation target.
 * Returns a shrunk covariance matrix (PSD by convex combination).
 */
export function ledoitWolf(rows: number[][]): { cov: number[][]; shrink: number } {
  const T = rows.length;
  const N = rows[0]?.length ?? 0;
  if (T < 3 || N < 2) return { cov: rows.map(() => new Array(N).fill(0)), shrink: 0 };

  const means = new Array(N).fill(0).map((_, j) => mean(rows.map((r) => r[j])));
  const X = rows.map((r) => r.map((v, j) => v - means[j]));

  const S: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += X[t][i] * X[t][j];
      S[i][j] = s / (T - 1);
    }
  }

  let rbar = 0;
  let pairs = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const denom = Math.sqrt(S[i][i] * S[j][j]);
      if (denom) {
        rbar += S[i][j] / denom;
        pairs++;
      }
    }
  }
  rbar = pairs ? rbar / pairs : 0;
  // Keep the target usable in stressed samples.
  rbar = clamp(rbar, -0.2, 0.9);

  const F: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (i === j ? S[i][i] : rbar * Math.sqrt(S[i][i] * S[j][j]))),
  );

  let pi = 0;
  let rho = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let t = 0; t < T; t++) acc += (X[t][i] * X[t][j] - S[i][j]) ** 2;
      const pij = acc / T;
      pi += pij;
      if (i !== j) rho += pij;
    }
  }
  let gamma = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) gamma += (F[i][j] - S[i][j]) ** 2;

  const shrink = gamma > 0 ? clamp((pi - rho) / gamma / T, 0, 1) : 0;
  const cov = S.map((row, i) => row.map((v, j) => shrink * F[i][j] + (1 - shrink) * v));
  return { cov, shrink };
}

export function covToCorr(cov: number[][]): number[][] {
  const N = cov.length;
  const sd = cov.map((_, i) => Math.sqrt(cov[i][i]));
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (sd[i] && sd[j] ? clamp(cov[i][j] / (sd[i] * sd[j]), -1, 1) : 0)),
  );
}

/**
 * Hierarchical Risk Parity (López de Prado): average-linkage clustering on
 * correlation distance, quasi-diagonalisation, recursive bisection.
 */
export function hrp(cov: number[][]): { order: number[]; weights: number[] } {
  const N = cov.length;
  if (N === 0) return { order: [], weights: [] };
  if (N === 1) return { order: [0], weights: [1] };
  const corr = covToCorr(cov);
  const dist = corr.map((row) => row.map((c) => Math.sqrt(Math.max(0, 0.5 * (1 - c)))));

  let clusters: number[][] = Array.from({ length: N }, (_, i) => [i]);
  const distBetween = (a: number[], b: number[]): number => {
    let s = 0;
    let n = 0;
    for (const i of a) for (const j of b) {
      s += dist[i][j];
      n++;
    }
    return n ? s / n : 0;
  };
  while (clusters.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = distBetween(clusters[i], clusters[j]);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    const merged = [...clusters[bi], ...clusters[bj]];
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  const order = clusters[0];

  const clusterVar = (idx: number[]): number => {
    const iv = idx.map((i) => 1 / Math.max(cov[i][i], 1e-12));
    const s = iv.reduce((a, b) => a + b, 0);
    const w = iv.map((v) => v / s);
    let q = 0;
    for (let a = 0; a < idx.length; a++) for (let b = 0; b < idx.length; b++) q += w[a] * w[b] * cov[idx[a]][idx[b]];
    return q;
  };

  const rec = (idx: number[]): number[] => {
    if (idx.length === 1) {
      const w = new Array(N).fill(0);
      w[idx[0]] = 1;
      return w;
    }
    const half = Math.floor(idx.length / 2);
    const left = idx.slice(0, half);
    const right = idx.slice(half);
    const v1 = clusterVar(left);
    const v2 = clusterVar(right);
    const split = v1 + v2 > 0 ? v1 / (v1 + v2) : 0.5;
    const wl = rec(left);
    const wr = rec(right);
    return wl.map((v, i) => v * split + wr[i] * (1 - split));
  };
  return { order, weights: rec(order) };
}

/** Iterative weight caps, renormalising after each clip. */
export function applyCaps(weights: Record<string, number>, caps: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...weights };
  const keys = Object.keys(out);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const k of keys) {
      const cap = caps[k];
      if (cap != null && out[k] > cap) {
        out[k] = cap;
        changed = true;
      }
    }
    const sum = keys.reduce((a, k) => a + out[k], 0);
    if (sum <= 0) break;
    for (const k of keys) out[k] /= sum;
    if (!changed) break;
  }
  return out;
}

/** Black-Scholes call/put price; used only for the synthetic option overlay. */
export function bsPrice(type: 'call' | 'put', S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const cdf = (x: number) => {
    // Abramowitz-Stegun approximation.
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-0.5 * x * x);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  };
  if (type === 'call') return S * cdf(d1) - K * Math.exp(-r * T) * cdf(d2);
  return K * Math.exp(-r * T) * cdf(-d2) - S * cdf(-d1);
}
