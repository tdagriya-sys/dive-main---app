import axios from "axios";
import { env } from "../config/env";
import { AssetClass } from "../models/Instrument";

/**
 * Resolves a daily-return history for one holding, for the Dive Score v2
 * resilience math (volatility/correlation/drawdown/VaR/beta). Two tiers:
 *
 *  1. Real prices, where a cheap/free public source exists: NSE-listed
 *     equities, ETFs, and gold/silver ETFs (all resolvable via Yahoo
 *     Finance's `<SYMBOL>.NS` chart endpoint — free, keyless), crypto
 *     (CoinGecko's `market_chart` endpoint — free, keyless for this volume),
 *     and mutual funds with a resolvable AMFI scheme code (real daily NAV
 *     history via MFAPI.in — free, keyless, community-run).
 *  2. Deterministic seeded synthetic returns for everything else (bonds,
 *     REIT/InvIT units not separately NSE-listed, ULIP/insurance, FD, and
 *     any mutual fund/equity/crypto whose real fetch fails or isn't
 *     resolvable) — there's no cheap public daily-price API for these in
 *     India. Synthetic series are tied to the same shared Nifty 50 "market
 *     factor" used for real beta calculations, so correlation/beta math stays
 *     coherent instead of every synthetic holding being an independent random
 *     walk. Every synthetic series is clearly labeled as such in the response
 *     — never presented as real historical data.
 *
 * Real-price network calls are skipped in the test environment (always
 * synthetic there) so the test suite stays hermetic and fast.
 */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — real prices don't need to be fresher than that for this use case
interface CacheEntry {
  returns: number[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function getCached(key: string): number[] | null {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.returns;
  return null;
}
function setCached(key: string, returns: number[]) {
  cache.set(key, { returns, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchYahooDailyReturns(symbol: string): Promise<number[] | null> {
  const cacheKey = `yahoo:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  try {
    const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      params: { range: "1y", interval: "1d" },
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const result = data?.chart?.result?.[0];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close || [];
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1];
      const cur = closes[i];
      if (prev == null || cur == null || prev === 0) continue;
      returns.push((cur - prev) / prev);
    }
    if (returns.length < 30) return null; // too little real data to be meaningful — fall back to synthetic
    setCached(cacheKey, returns);
    return returns;
  } catch {
    return null;
  }
}

async function fetchCoinGeckoDailyReturns(coingeckoId: string): Promise<number[] | null> {
  const cacheKey = `coingecko:${coingeckoId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  try {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}/market_chart`, {
      params: { vs_currency: "usd", days: 365, interval: "daily" },
      timeout: 8000,
    });
    const prices: Array<[number, number]> = data?.prices || [];
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1][1];
      const cur = prices[i][1];
      if (!prev) continue;
      returns.push((cur - prev) / prev);
    }
    if (returns.length < 30) return null;
    setCached(cacheKey, returns);
    return returns;
  } catch {
    return null;
  }
}

interface MfApiResponse {
  data?: Array<{ date: string; nav: string }>;
}

async function fetchMfApiRaw(schemeCode: string) {
  return axios.get<MfApiResponse>(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
    timeout: 8000,
    // This host resolves an IPv6 (NAT64-synthesized) address alongside its
    // real IPv4 one — on networks where that IPv6 path is a black hole
    // rather than a clean refusal, Node's default dual-stack lookup can hang
    // for the full timeout before trying IPv4 (see instrumentDetailService.ts,
    // where this was first diagnosed).
    family: 4,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dive-app" },
  });
}

async function fetchMfApiDailyReturns(schemeCode: string): Promise<number[] | null> {
  const cacheKey = `mfapi:${schemeCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let data: MfApiResponse | undefined;
  try {
    ({ data } = await fetchMfApiRaw(schemeCode));
  } catch {
    // Observed in testing: this host's FIRST connection from a long-running
    // process occasionally hangs/fails even with family:4 forced, then
    // succeeds immediately on retry — a connection-level flake, not a
    // persistent outage. One immediate retry before giving up to synthetic.
    try {
      ({ data } = await fetchMfApiRaw(schemeCode));
    } catch {
      return null;
    }
  }

  const rows: Array<{ date: string; nav: string }> = data?.data || [];
  if (rows.length < 30) return null;
  // MFAPI returns newest-first and can carry years of history — take the
  // most recent ~400 calendar days (comfortably more than the 252 trading
  // days this module aligns to) and reverse to oldest-first, matching the
  // ascending convention fetchYahooDailyReturns/fetchCoinGeckoDailyReturns
  // use, so every real series lines up the same way for alignment/beta.
  const chronological = rows.slice(0, 400).reverse();
  const returns: number[] = [];
  for (let i = 1; i < chronological.length; i++) {
    const prev = parseFloat(chronological[i - 1].nav);
    const cur = parseFloat(chronological[i].nav);
    if (!prev || !isFinite(prev) || !isFinite(cur)) continue;
    returns.push((cur - prev) / prev);
  }
  if (returns.length < 30) return null;
  setCached(cacheKey, returns);
  return returns;
}

let syntheticNiftyCache: number[] | null = null;

/**
 * The shared "market factor" — real Nifty 50 daily returns when reachable,
 * otherwise a deterministic synthetic index series. Used both as the beta
 * benchmark for real-priced holdings and as the correlated base for every
 * synthetic holding series, so the whole portfolio's correlation/beta picture
 * stays internally consistent rather than arbitrary.
 */
export async function fetchMarketFactor(): Promise<{ returns: number[]; isSynthetic: boolean }> {
  if (env.nodeEnv !== "test") {
    const real = await fetchYahooDailyReturns("^NSEI");
    if (real) return { returns: real, isSynthetic: false };
  }
  if (!syntheticNiftyCache) syntheticNiftyCache = generateSyntheticReturns("NIFTY50-MARKET-FACTOR", 0.12, 0.16, 252, 1, null);
  return { returns: syntheticNiftyCache, isSynthetic: true };
}

// seeded PRNG (mulberry32) — deterministic per string seed so the same
// holding always produces the same synthetic series across requests.
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function boxMullerNormal(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Deterministic synthetic daily-return series: drift + a beta-scaled slice of
 * the shared market factor + idiosyncratic noise at the target annual vol.
 * This slightly overstates total volatility versus a strict CAPM decomposition
 * (the idiosyncratic term isn't reduced to account for the market component),
 * which is an acceptable simplification for a clearly-labeled illustrative
 * fallback — not a promise of matching the target vol exactly.
 */
function generateSyntheticReturns(
  seedKey: string,
  annualDrift: number,
  annualVol: number,
  length: number,
  beta: number | null,
  marketFactor: number[] | null
): number[] {
  const rand = seededRandom(hashString(seedKey));
  const dailyDrift = annualDrift / 252;
  const dailyVol = annualVol / Math.sqrt(252);
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const idiosyncratic = boxMullerNormal(rand) * dailyVol;
    const marketComponent = beta != null && marketFactor && marketFactor.length ? beta * marketFactor[i % marketFactor.length] : 0;
    out.push(dailyDrift + marketComponent + idiosyncratic);
  }
  return out;
}

// Illustrative annual (drift, vol, beta-vs-Nifty) assumptions for asset
// classes with no cheap public daily-price source, plus fallbacks for
// EQUITY/ETF/CRYPTO when a real fetch fails (delisted symbol, API down,
// rate-limited, etc.). Not investment research, and not fitted to any single
// dataset — but the ORDERING and SIGN of each value is grounded in widely
// documented, qualitative asset-allocation relationships (cited per-row
// below), not invented. Where a real daily price series is available
// (EQUITY/ETF/GOLD/SILVER/CRYPTO with live Yahoo/CoinGecko data), correlation
// and volatility are computed empirically from it instead — these
// assumptions only govern the synthetic fallback path.
//
// vol: typical annualized volatility ranges commonly cited in Indian
// mutual-fund fact sheets (AMFI/CRISIL risk-o-meter bands), NSE/international
// index/ETF volatility data, and gold/silver commodity volatility indices.
// beta: this asset class's typical co-movement with broad equity (Nifty 50),
// grounded in standard multi-asset allocation literature —
//   - BOND: sovereign/high-quality debt has historically shown low-to-negative
//     correlation with equity during equity stress/flight-to-quality episodes
//     (a relationship that can invert during synchronized high-inflation
//     regimes, e.g. 2022 — a well-documented regime-dependent caveat, not a
//     permanent negative correlation).
//   - GOLD: the well-documented "safe-haven" property — low-to-negative
//     correlation with equity, most pronounced in risk-off periods (World
//     Gold Council research, standard multi-asset allocation guides).
//   - SILVER: shares gold's monetary-hedge role but carries a meaningful
//     industrial-demand component, tying it more closely to growth/equity
//     cycles than gold — hence a higher (less negative) equity-beta than gold.
//   - REIT / INVIT: a hybrid profile — equity-like development/occupancy
//     risk plus bond-like yield/duration sensitivity — commonly placed at a
//     moderate equity-beta in REIT/InvIT allocation literature; InvIT
//     slightly lower than REIT given typically more contracted, stable
//     infrastructure cash flows.
//   - CRYPTO: academic literature on crypto-asset correlation (e.g. Corbet,
//     Meegan, Larkin, Lucey & Yarovaya 2018, "Exploring the dynamic
//     relationships between cryptocurrencies and other financial assets",
//     Economics Letters; Baur & Dimpfl 2021 on Bitcoin's excess volatility)
//     documents a LOW and UNSTABLE correlation with traditional equities in
//     normal periods (commonly ~0.1-0.3), with occasional spikes during
//     systemic stress — not a strong, stable positive correlation. Crypto
//     should NOT be treated as a "free" diversifier despite this low
//     correlation, because its own volatility (60% annualized here) dominates
//     any diversification benefit on the volatility axis.
//   - PF (PPF/EPF/VPF): beta 0, same as FD — no market co-movement visible
//     to the account holder (EPFO's own internal ~15%-into-equity-ETF
//     allocation since 2015 is smoothed away entirely before the annual
//     rate is declared to members, so it isn't a real per-holding beta
//     signal). vol deliberately set ABOVE FD's 0.003, not equal to it: FD's
//     near-zero vol reflects a rate locked for the deposit's whole tenure at
//     issuance (genuinely fixed once opened); PF's government-declared rate
//     is instead periodically revised for the WHOLE balance going forward —
//     PPF has moved from 8.7% (FY2015-16) down to a 7.1% floor unchanged
//     since Apr-Jun 2020 (Ministry of Finance), EPF from 8.1%-8.65% over the
//     last 6 years (EPFO Central Board of Trustees) — real, if slow,
//     rate-revision variability FD doesn't have. This is an illustrative
//     judgment call (not literature-cited the way the beta signs above are)
//     calibrated to that observed 0.4-1.6 percentage-point historical
//     rate-revision range, kept well below BOND's 0.04 since PF is still far
//     more stable than market-priced debt.
const SYNTHETIC_PARAMS: Record<AssetClass, { drift: number; vol: number; beta: number; label: string }> = {
  EQUITY: { drift: 0.12, vol: 0.2, beta: 1.0, label: "Equity" },
  MUTUAL_FUND: { drift: 0.12, vol: 0.16, beta: 0.75, label: "Mutual Fund" },
  ETF: { drift: 0.11, vol: 0.18, beta: 0.9, label: "ETF" },
  BOND: { drift: 0.07, vol: 0.04, beta: -0.05, label: "Bond" },
  REIT: { drift: 0.09, vol: 0.15, beta: 0.5, label: "REIT" },
  INVIT: { drift: 0.09, vol: 0.13, beta: 0.45, label: "InvIT" },
  GOLD: { drift: 0.08, vol: 0.14, beta: -0.15, label: "Gold" },
  SILVER: { drift: 0.08, vol: 0.2, beta: 0.15, label: "Silver" },
  ULIP_INSURANCE: { drift: 0.08, vol: 0.09, beta: 0.35, label: "ULIP/Insurance" },
  FD: { drift: 0.07, vol: 0.003, beta: 0, label: "Fixed Deposit" },
  CRYPTO: { drift: 0.25, vol: 0.6, beta: 0.3, label: "Crypto" },
  // Blended PPF(7.1%)/EPF(8.25%) fallback drift — superseded by the actual
  // holding's own declared rate below (pfInterestRatePercent) whenever it's
  // known, same override pattern as FD.
  PF: { drift: 0.075, vol: 0.01, beta: 0, label: "Provident Fund (PPF/EPF)" },
};

export interface HoldingReturnInput {
  assetClass: AssetClass;
  name: string;
  instrumentId?: string;
  symbol?: string;
  coingeckoId?: string;
  fdInterestRatePercent?: number;
  // Unlike fdInterestRatePercent (a bank's freely-chosen rate, genuinely
  // user-entered), PPF/EPF/VPF rates are public and government-declared —
  // see config/pfRates.ts. Still stored per-holding (not looked up fresh
  // every time) so an old holding keeps the rate that was actually in force
  // when it was entered, and stays user-editable if the declared rate moves.
  pfInterestRatePercent?: number;
}

export interface HoldingReturnSeries {
  returns: number[];
  isSynthetic: boolean;
  label: string;
  assumedBeta?: number; // only present for synthetic series — the beta used to generate them
}

// Live-priceable via Yahoo's `<SYMBOL>.NS` endpoint (NSE-listed).
const NSE_PRICEABLE_CLASSES: AssetClass[] = ["EQUITY", "ETF", "GOLD", "SILVER"];

export async function resolveHoldingReturns(holding: HoldingReturnInput, marketFactor: number[]): Promise<HoldingReturnSeries> {
  const useNetwork = env.nodeEnv !== "test";

  if (useNetwork && NSE_PRICEABLE_CLASSES.includes(holding.assetClass) && holding.symbol) {
    const real = await fetchYahooDailyReturns(`${holding.symbol}.NS`);
    if (real) return { returns: real, isSynthetic: false, label: `NSE (${holding.symbol})` };
  }
  if (useNetwork && holding.assetClass === "CRYPTO" && holding.coingeckoId) {
    const real = await fetchCoinGeckoDailyReturns(holding.coingeckoId);
    if (real) return { returns: real, isSynthetic: false, label: `CoinGecko (${holding.coingeckoId})` };
  }
  if (useNetwork && holding.assetClass === "MUTUAL_FUND" && holding.symbol) {
    const real = await fetchMfApiDailyReturns(holding.symbol);
    if (real) return { returns: real, isSynthetic: false, label: `AMFI NAV (via MFAPI.in, scheme ${holding.symbol})` };
  }

  const params = SYNTHETIC_PARAMS[holding.assetClass] ?? SYNTHETIC_PARAMS.EQUITY;
  const drift =
    holding.assetClass === "FD" && holding.fdInterestRatePercent
      ? holding.fdInterestRatePercent / 100
      : holding.assetClass === "PF" && holding.pfInterestRatePercent
      ? holding.pfInterestRatePercent / 100
      : params.drift;
  const seedKey = `${holding.assetClass}:${holding.instrumentId || holding.name}`;
  const length = marketFactor.length || 252;
  const returns = generateSyntheticReturns(seedKey, drift, params.vol, length, params.beta, marketFactor);
  return { returns, isSynthetic: true, label: `Synthetic — ${params.label} assumption`, assumedBeta: params.beta };
}
