/**
 * Small shared statistics helpers used across the Dive Score v2 sub-scores
 * (volatility, correlation matrix, beta, diversification ratio) — kept as one
 * module since all four need mean/variance/covariance on daily-return series.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Sample variance (n-1 denominator) — standard for a finite historical sample.
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
}

export function stdev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

export function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const a = xs.slice(0, n);
  const b = ys.slice(0, n);
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  const sx = stdev(xs.slice(0, n));
  const sy = stdev(ys.slice(0, n));
  if (sx === 0 || sy === 0) return 0;
  return covariance(xs, ys) / (sx * sy);
}

// Regression slope of `assetReturns` against `marketReturns` — the standard
// beta definition (Cov(asset, market) / Var(market)).
export function betaAgainst(assetReturns: number[], marketReturns: number[]): number {
  const n = Math.min(assetReturns.length, marketReturns.length);
  const marketVar = variance(marketReturns.slice(0, n));
  if (marketVar === 0) return 0;
  return covariance(assetReturns.slice(0, n), marketReturns.slice(0, n)) / marketVar;
}

// Linearly maps `value` between `worstAt` (-> 0) and `bestAt` (-> 100),
// clamped to [0, 100]. Works for "higher is better" metrics (bestAt > worstAt)
// and "lower is better" metrics (bestAt < worstAt) with the same function.
export function scoreFromRange(value: number, worstAt: number, bestAt: number): number {
  if (bestAt === worstAt) return 50;
  const t = (value - worstAt) / (bestAt - worstAt);
  return Math.max(0, Math.min(100, Math.round(t * 100)));
}
