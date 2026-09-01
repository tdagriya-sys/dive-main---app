import { Holding } from "../models/Holding";
import { User } from "../models/User";
import { AssetClass } from "../models/Instrument";
import { fetchMarketFactor, resolveHoldingReturns, HoldingReturnSeries } from "./priceHistoryService";
import { mean, stdev, correlation, betaAgainst, scoreFromRange } from "./stats";
import { computeLookthroughOverlap, Connection } from "./lookthroughService";
import { resolveContext, CorpusTier, PersonaBracket, PERSONA_BRACKETS } from "./contextEngine";

/**
 * Dive Score v2 — the reference doc's "real resilience math on top of the
 * existing concentration engine". `frontend/src/lib/diveEngine.js` keeps its
 * own fast, client-side diveScore() for the instant-feedback "simulate this
 * change" slider on Suggestions (a hypothetical, unsaved state the backend
 * has no way to price), but the CONCENTRATION concept underneath both engines
 * — apparent diversification (spread across asset classes) as the dominant
 * signal, real diversification bounded by it (never higher), and per-name
 * spread as a minor bonus — is the exact same formula and weights in both
 * places, not two independently-invented definitions. This composite then
 * layers heavier resilience math (volatility/drawdown/VaR/liquidity/beta/
 * correlation) on top, which the fast client path can't compute.
 *
 * Every sub-score is normalized to 0-100 (documented mapping below) and
 * combined via DIVE_SCORE_V2_WEIGHTS, which sum to 1.0.
 */

// contextFit (Layer D) and stockCountFit each took a proportional slice from
// every existing weight rather than replacing one specific dimension —
// they're genuinely new, orthogonal signals, not a replacement for any of the
// resilience math.
export const DIVE_SCORE_V2_WEIGHTS = {
  concentration: 0.17,
  volatility: 0.12,
  drawdown: 0.12,
  var: 0.08,
  liquidity: 0.12,
  beta: 0.08,
  correlation: 0.08,
  diversificationRatio: 0.04,
  contextFit: 0.11,
  stockCountFit: 0.08,
} as const;

// 0 (illiquid, locked-up) - 100 (liquid, exit anytime at close to fair value).
// Approximate, class-level tiers — not a per-instrument liquidity model.
const LIQUIDITY_TIER: Record<AssetClass, number> = {
  CRYPTO: 95,
  EQUITY: 95,
  ETF: 90,
  MUTUAL_FUND: 70,
  GOLD: 75,
  SILVER: 65,
  REIT: 60,
  INVIT: 55,
  BOND: 50,
  ULIP_INSURANCE: 20,
  FD: 15,
  // Below FD, not tied with it: FD is breakable any time (with an interest
  // penalty) — full principal access is never in question. PF has no such
  // unconditional exit — PPF's 15-year hard lock (partial withdrawal only
  // from FY7, capped at 50% of the balance 4 years prior) and EPF's
  // retirement/2-month-unemployment/purpose-specific-after-12-months gating
  // are both strictly worse than a breakable FD. Not 0 — real, if narrow,
  // partial-access routes exist (PPF's year 3-6 loan facility, EPF's
  // purpose-based partial withdrawals), so an instrument with truly no
  // access route at all still reads as meaningfully worse.
  PF: 8,
};

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Bands (rather than rewards indefinitely) the number of DISTINCT equity
 * holdings against the classic stock-count diversification literature:
 * Evans & Archer (1968) found portfolio risk "exhausted" by roughly 10
 * stocks; Statman (1987) revised the minimum for a well-diversified,
 * randomly-selected portfolio to ~30; later studies range anywhere from 20 to
 * 50+ depending on market and method. Practically: too few (<10-12) is
 * genuine concentration risk; too many (>30-40) for a retail investor brings
 * diminishing/negative marginal benefit (unmanageable overlap, index-hugging)
 * rather than further diversification benefit — so this tapers on BOTH sides
 * of a ~15-30 ideal band, unlike a flat HHI which keeps improving toward 100
 * as you add names indefinitely. Anchor points below are illustrative
 * (piecewise-linear interpolation between them), not fitted to a dataset.
 */
const STOCK_COUNT_BREAKPOINTS: Array<[count: number, score: number]> = [
  [1, 10],
  [3, 25],
  [8, 60],
  [12, 90],
  [15, 100],
  [30, 100],
  [40, 75],
  [50, 60],
  [75, 45],
  [100, 40],
];
function scoreStockCountBand(n: number): number {
  if (n <= STOCK_COUNT_BREAKPOINTS[0][0]) return STOCK_COUNT_BREAKPOINTS[0][1];
  for (let i = 1; i < STOCK_COUNT_BREAKPOINTS.length; i++) {
    const [x1, y1] = STOCK_COUNT_BREAKPOINTS[i - 1];
    const [x2, y2] = STOCK_COUNT_BREAKPOINTS[i];
    if (n <= x2) {
      const t = (n - x1) / (x2 - x1);
      return Math.round(y1 + t * (y2 - y1));
    }
  }
  return STOCK_COUNT_BREAKPOINTS[STOCK_COUNT_BREAKPOINTS.length - 1][1];
}

interface HoldingForScoring {
  id: string;
  name: string;
  assetClass: AssetClass;
  value: number;
  weight: number;
  series: HoldingReturnSeries;
  beta: number;
  sector?: string;
  marketCapTier?: "Large" | "Mid" | "Small"; // EQUITY only, from NSE Nifty 100/Midcap150/Smallcap250
  maturityYearMonth?: string; // FD only, "YYYY-MM", for tenure-laddering
}

export interface DiveScoreBreakdown {
  hasHoldings: boolean;
  compositeScore: number;
  weights: typeof DIVE_SCORE_V2_WEIGHTS;
  apparentDiversificationPct: number;
  realDiversificationPct: number;
  // ALL detected connections, both scopes (see Connection.scope) — cross-class
  // ones are what actually pulled real diversification below apparent;
  // same-class ones (e.g. two bank stocks) instead discount the concentration
  // sub-score's per-name spread term and have no effect on apparent/real.
  // Surfaced together so the user can see WHY, not just the numbers — but a
  // consumer rendering a "why real is below apparent" section specifically
  // must filter to scope === "cross-class", or it'll show entries that had no
  // effect on that particular gap.
  connections: Connection[];
  subScores: {
    concentration: SubScore;
    volatility: SubScore;
    drawdown: SubScore;
    var: SubScore;
    liquidity: SubScore;
    beta: SubScore;
    correlation: SubScore;
    diversificationRatio: SubScore;
    contextFit: SubScore;
    stockCountFit: SubScore;
  };
  drawdownDetail: { maxDrawdownPct: number; recovered: boolean; recoveryDays: number | null };
  varDetail: { oneDayPct: number; oneDayINR: number; oneMonthPct: number; oneMonthINR: number };
  correlationMatrix: { labels: string[]; matrix: number[][] };
  dataQuality: {
    realPriceCoveragePct: number;
    marketFactorIsSynthetic: boolean;
    holdings: Array<{ name: string; assetClass: AssetClass; isSynthetic: boolean; label: string }>;
  };
  // Layer D — Context Engine (see contextEngine.ts / docs/DIVE_SCORE_MODEL.md
  // §15): which asset classes it's sensible to expect this user to hold RIGHT
  // NOW, given their corpus size and age, so the score and its messaging never
  // penalize someone for something that doesn't make sense at their situation.
  context: {
    corpusTier: { id: CorpusTier["id"]; label: string; reasoning: string };
    persona: { id: PersonaBracket["id"]; label: string; reasoning: string };
    expectedAssetClasses: AssetClass[];
    missingExpectedAssetClasses: AssetClass[];
  };
}

interface SubScore {
  score: number;
  value: number;
  label: string;
}

function emptyBreakdown(context: DiveScoreBreakdown["context"]): DiveScoreBreakdown {
  const zero: SubScore = { score: 0, value: 0, label: "No holdings yet" };
  return {
    hasHoldings: false,
    compositeScore: 0,
    weights: DIVE_SCORE_V2_WEIGHTS,
    apparentDiversificationPct: 0,
    realDiversificationPct: 0,
    connections: [],
    subScores: {
      concentration: zero,
      volatility: zero,
      drawdown: zero,
      var: zero,
      liquidity: zero,
      beta: zero,
      correlation: zero,
      diversificationRatio: zero,
      contextFit: zero,
      stockCountFit: zero,
    },
    drawdownDetail: { maxDrawdownPct: 0, recovered: true, recoveryDays: null },
    varDetail: { oneDayPct: 0, oneDayINR: 0, oneMonthPct: 0, oneMonthINR: 0 },
    correlationMatrix: { labels: [], matrix: [] },
    dataQuality: { realPriceCoveragePct: 0, marketFactorIsSynthetic: false, holdings: [] },
    context,
  };
}

function buildContextField(totalInvestedAmount: number, age: number, heldClasses: Set<AssetClass>): DiveScoreBreakdown["context"] {
  const { corpusTier, persona, expectedAssetClasses } = resolveContext(totalInvestedAmount, age);
  return {
    corpusTier: { id: corpusTier.id, label: corpusTier.label, reasoning: corpusTier.reasoning },
    persona: { id: persona.id, label: persona.label, reasoning: persona.reasoning },
    expectedAssetClasses,
    missingExpectedAssetClasses: expectedAssetClasses.filter((c) => !heldClasses.has(c)),
  };
}

// The underlying price-history fetches (priceHistoryService.ts) are already
// cached — what wasn't is the pure-CPU work on top: the correlation matrix,
// drawdown/VaR simulation, and O(n²) look-through overlap, all recomputed
// from scratch on every single /score/breakdown call even though nothing
// relevant had changed since the last one. Same in-memory Map + TTL shape as
// priceHistoryService.ts's own cache, keyed per user rather than per
// symbol/scheme. Freshness is driven primarily by explicit invalidation
// (invalidateDiveScoreCache, called from every holdings/profile mutation
// path below) — the TTL here is just a safety net in case some path is ever
// added that changes a scoring input without remembering to invalidate.
const CACHE_TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  breakdown: DiveScoreBreakdown;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

// Called from every place a user's holdings or age (the two scoring inputs
// that live outside the already-cached price-history layer) can change:
// holdingsController's create/update/delete, aaController's AA sync, and
// userController's profile update. Also called on account deletion, purely
// for hygiene — a leftover entry for a deleted user is harmless (never read
// again) but there's no reason to let it sit until its TTL expires.
export function invalidateDiveScoreCache(userId: string): void {
  cache.delete(userId);
}

export async function computeDiveScoreBreakdown(userId: string): Promise<DiveScoreBreakdown> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.breakdown;
  const breakdown = await computeDiveScoreBreakdownUncached(userId);
  cache.set(userId, { breakdown, expiresAt: Date.now() + CACHE_TTL_MS });
  return breakdown;
}

async function computeDiveScoreBreakdownUncached(userId: string): Promise<DiveScoreBreakdown> {
  const user = await User.findById(userId).select("age").lean();
  const age = user?.age ?? 30; // fallback for the (test-only) case a caller passes a userId with no User doc

  const holdingDocs = await Holding.find({ userId }).populate("instrumentId").lean();
  if (holdingDocs.length === 0) return emptyBreakdown(buildContextField(0, age, new Set()));

  const totalValue = holdingDocs.reduce((s, h) => s + (h.currentValue || h.investedValue || 0), 0);
  if (totalValue <= 0) return emptyBreakdown(buildContextField(0, age, new Set()));

  const { returns: marketFactor, isSynthetic: marketFactorIsSynthetic } = await fetchMarketFactor();

  const resolved: HoldingForScoring[] = [];
  for (const h of holdingDocs) {
    const value = h.currentValue || h.investedValue || 0;
    if (value <= 0) continue;
    const instrument = h.instrumentId as unknown as { symbol?: string; metadata?: Record<string, unknown> } | null;
    const series = await resolveHoldingReturns(
      {
        assetClass: h.assetClass,
        name: h.name,
        instrumentId: instrument ? String((h.instrumentId as any)._id || h.instrumentId) : undefined,
        symbol: instrument?.symbol,
        coingeckoId: instrument?.metadata?.coingeckoId as string | undefined,
        fdInterestRatePercent: typeof h.extraFields?.interestRate === "number" ? h.extraFields.interestRate : undefined,
        pfInterestRatePercent: typeof h.extraFields?.interestRatePercent === "number" ? h.extraFields.interestRatePercent : undefined,
      },
      marketFactor
    );
    const beta = series.assumedBeta ?? betaAgainst(series.returns, marketFactor);
    const sector = typeof instrument?.metadata?.sector === "string" ? (instrument.metadata.sector as string) : undefined;
    const marketCapTierRaw = instrument?.metadata?.marketCapTier;
    const marketCapTier =
      marketCapTierRaw === "Large" || marketCapTierRaw === "Mid" || marketCapTierRaw === "Small" ? marketCapTierRaw : undefined;
    const maturityDate = h.assetClass === "FD" && h.extraFields?.maturityDate ? new Date(h.extraFields.maturityDate as string) : undefined;
    const maturityYearMonth =
      maturityDate && !isNaN(maturityDate.getTime())
        ? `${maturityDate.getFullYear()}-${String(maturityDate.getMonth() + 1).padStart(2, "0")}`
        : undefined;
    resolved.push({
      id: String(h._id),
      name: h.name,
      assetClass: h.assetClass,
      value,
      weight: value / totalValue,
      series,
      beta,
      sector,
      marketCapTier,
      maturityYearMonth,
    });
  }
  if (resolved.length === 0) return emptyBreakdown(buildContextField(0, age, new Set()));

  // Align every series to the shortest common length (most recent days),
  // so weighted portfolio returns and correlations compare like-for-like days.
  const alignLength = Math.min(TRADING_DAYS_PER_YEAR, ...resolved.map((r) => r.series.returns.length), marketFactor.length);
  const aligned = resolved.map((r) => ({ ...r, alignedReturns: r.series.returns.slice(-alignLength) }));
  const alignedMarket = marketFactor.slice(-alignLength);

  // Layer D — Context Engine: resolved early, before volatility/drawdown, so
  // this user's persona can inform the risk-capacity thresholds below (§8/§12
  // of docs/DIVE_SCORE_MODEL.md). Which asset classes make sense to expect
  // from THIS user right now also feeds the contextFit sub-score and softens
  // the single-class correlation floor further down — see contextEngine.ts.
  const heldClasses = new Set(aligned.map((h) => h.assetClass));
  const context = buildContextField(totalValue, age, heldClasses);
  const personaBounds = PERSONA_BRACKETS.find((p) => p.id === context.persona.id) ?? PERSONA_BRACKETS[PERSONA_BRACKETS.length - 1];

  // ---- Portfolio daily returns ----
  const portfolioReturns: number[] = [];
  for (let t = 0; t < alignLength; t++) {
    let r = 0;
    for (const h of aligned) r += h.weight * h.alignedReturns[t];
    portfolioReturns.push(r);
  }

  // ---- Volatility & Drawdown risk-capacity thresholds: persona-adjusted
  // (Layer D + C crossover). The "best" end (low vol/drawdown is good for
  // everyone) is unchanged across personas; only the "worst" end — how much
  // downside counts as a failure — shifts with risk CAPACITY (a function of
  // time horizon), not just age for its own sake. See contextEngine.ts's
  // PersonaBracket.volatilityWorstAt/drawdownWorstAt for the reasoning per
  // bracket. ----
  const annualizedVol = stdev(portfolioReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const volatilityScore = scoreFromRange(annualizedVol, personaBounds.volatilityWorstAt, 0.03);

  // ---- Concentration: apparent diversification (spread across asset
  // classes) as the dominant signal, real diversification bounded by it
  // (never higher — real can only reveal MORE hidden concentration via a
  // detected cross-class issuer overlap, never less), and per-name spread
  // within a class as a small bonus. Same formula, same weights, as
  // frontend/src/lib/diveEngine.js's diveScore() — one methodology, not two
  // independently-invented ones. ----
  const byClass = new Map<AssetClass, number>();
  for (const h of aligned) byClass.set(h.assetClass, (byClass.get(h.assetClass) || 0) + h.value);
  const classHhi = Array.from(byClass.values()).reduce((s, v) => s + Math.pow(v / totalValue, 2), 0);
  const apparentDiversificationPct = Math.max(0, Math.min(100, Math.round((1 - classHhi) * 100)));

  // context and heldClasses were already resolved earlier (before volatility),
  // so persona could inform the risk-capacity thresholds above.
  const expectedHeldCount = context.expectedAssetClasses.filter((c) => heldClasses.has(c)).length;
  const contextFitScore =
    context.expectedAssetClasses.length === 0 ? 100 : Math.round(100 * Math.min(1, expectedHeldCount / context.expectedAssetClasses.length));

  const byName = new Map<string, number>();
  for (const h of aligned) byName.set(h.name.trim().toLowerCase(), (byName.get(h.name.trim().toLowerCase()) || 0) + h.value);
  const nameHhi = Array.from(byName.values()).reduce((s, v) => s + Math.pow(v / totalValue, 2), 0);
  const nameDiversificationScore = Math.max(0, Math.min(100, Math.round((1 - nameHhi) * 100)));

  // ---- Within-class HHI: a genuinely different signal from the portfolio-
  // wide name spread above. A portfolio can hold 3 distinct names — one
  // stock, one bond, one gold unit — and look well-spread by name overall
  // (nameHhi ~0.33) while being 100% concentrated WITHIN each class it
  // actually holds. This computes HHI separately per asset class (by name,
  // within that class only), then combines value-weighted across classes —
  // so a concentrated class only drags the score down in proportion to how
  // much of the portfolio it represents.
  //
  // On top of the raw name-HHI, three class-specific quality adjustments
  // apply (a modest step toward Layer B's "don't use one generic formula for
  // all 11 classes" — the rest are documented as deferred in
  // docs/DIVE_SCORE_MODEL.md, gated on data this app doesn't have a free
  // source for yet):
  //   - CRYPTO: capped at 70, however well name-spread — most crypto assets
  //     are documented to move together (especially in stress), so spreading
  //     across N coins doesn't reduce risk anywhere near as much as spreading
  //     across N genuinely distinct equities.
  //   - FD: blended with a maturity-laddering score — distinct FDs maturing
  //     in the same month is a real, different risk (reinvestment/rate risk
  //     concentrated at one point in time) from distinct FDs laddered across
  //     different months, even if issuer/name spread looks identical.
  //   - EQUITY: blended with sector spread (distinct NSE industries among the
  //     equity names held) and market-cap tier blend (Large/Mid/Small,
  //     avoiding 100% concentration in one tier) — both skipped gracefully
  //     when the underlying classification data isn't available for a
  //     holding, never guessed. ----
  const byClassHoldings = new Map<AssetClass, HoldingForScoring[]>();
  for (const h of aligned) {
    const list = byClassHoldings.get(h.assetClass) || [];
    list.push(h);
    byClassHoldings.set(h.assetClass, list);
  }
  let withinClassWeightedScore = 0;
  for (const [cls, holdings] of byClassHoldings) {
    const classTotal = byClass.get(cls) || 0;
    const byNameInClass = new Map<string, number>();
    for (const h of holdings) byNameInClass.set(h.name.trim().toLowerCase(), (byNameInClass.get(h.name.trim().toLowerCase()) || 0) + h.value);
    const classHhiWithin = Array.from(byNameInClass.values()).reduce((s, v) => s + Math.pow(v / classTotal, 2), 0);
    let classScore = Math.max(0, Math.min(100, Math.round((1 - classHhiWithin) * 100)));

    if (cls === "CRYPTO") {
      classScore = Math.min(classScore, 70);
    } else if (cls === "FD") {
      const distinctFds = byNameInClass.size;
      if (distinctFds > 1) {
        const distinctMonths = new Set(holdings.map((h) => h.maturityYearMonth).filter((m): m is string => !!m));
        // Only scoreable when every FD has a resolvable maturity month — a
        // partial read (some FDs missing the field) would understate laddering.
        if (distinctMonths.size > 0) {
          const ladderScore = Math.round((100 * distinctMonths.size) / distinctFds);
          classScore = Math.round((classScore + ladderScore) / 2);
        }
      }
    } else if (cls === "EQUITY") {
      const distinctSectors = new Set(holdings.map((h) => h.sector).filter((s): s is string => !!s));
      const sectorSpreadScore = distinctSectors.size > 0 ? Math.round(100 * Math.min(1, distinctSectors.size / 5)) : null;

      const byTier = new Map<string, number>();
      for (const h of holdings) if (h.marketCapTier) byTier.set(h.marketCapTier, (byTier.get(h.marketCapTier) || 0) + h.value);
      const tierTotal = Array.from(byTier.values()).reduce((s, v) => s + v, 0);
      const tierBlendScore =
        tierTotal > 0 ? Math.round(100 * (1 - Array.from(byTier.values()).reduce((s, v) => s + Math.pow(v / tierTotal, 2), 0))) : null;

      const qualitySignals = [sectorSpreadScore, tierBlendScore].filter((s): s is number => s !== null);
      if (qualitySignals.length > 0) {
        const qualityScore = Math.round(qualitySignals.reduce((s, v) => s + v, 0) / qualitySignals.length);
        classScore = Math.round((classScore + qualityScore) / 2);
      }
    }

    withinClassWeightedScore += (classTotal / totalValue) * classScore;
  }
  const withinClassConcentrationScore = Math.round(withinClassWeightedScore);

  // ---- Stock count fit: distinct EQUITY holdings, banded per the classic
  // diversification literature (see scoreStockCountBand) rather than scored
  // as "more is always better" — 100 (not applicable / nothing to penalize)
  // when the user holds no equity at all, since this dimension is
  // specifically about equity stock-picking breadth. ----
  const equityNames = new Set(aligned.filter((h) => h.assetClass === "EQUITY").map((h) => h.name.trim().toLowerCase()));
  const stockCountFitScore = equityNames.size === 0 ? 100 : scoreStockCountBand(equityNames.size);

  // Layered look-through model: exact issuer match (full overlap) -> mutual
  // fund top-holdings (weighted by the fund's disclosed %) -> curated
  // keyword affinity (e.g. jewelry retailer <-> gold) -> broad NSE industry
  // affinity (e.g. Realty <-> REIT) -> same-sector, same-class (e.g. two
  // different bank stocks). See lookthroughService.ts for the tiers.
  const { overlapShare, sameClassOverlapShare, connections } = computeLookthroughOverlap(
    aligned.map((h) => ({ name: h.name, assetClass: h.assetClass, value: h.value, sector: h.sector })),
    totalValue
  );
  const realDiversificationPct =
    apparentDiversificationPct <= 0 ? 0 : Math.max(0, Math.min(apparentDiversificationPct, Math.round(apparentDiversificationPct * (1 - overlapShare))));

  // Same-sector connections within one asset class can't move apparent/real
  // (both are floored at 0 for a single-class portfolio by design), so they
  // discount the per-name spread score instead — the only concentration
  // lever still active in that case. sameClassOverlapShare is already capped
  // per class at that class's own weight in the portfolio (see
  // lookthroughService.ts), so this can never move the score by more than
  // the affected asset class actually represents.
  const sectorAdjustedNameDiversificationScore = Math.max(0, Math.min(100, Math.round(nameDiversificationScore * (1 - sameClassOverlapShare))));

  // Apparent (cross-class HHI) stays the dominant term — diversifying into
  // NEW asset classes is what should move this the most. Real and per-name
  // spread are secondary corrections; within-class HHI is a genuinely
  // distinct concentration signal (see above), not a duplicate of per-name.
  const concentrationScore = Math.round(
    apparentDiversificationPct * 0.5 +
      realDiversificationPct * 0.15 +
      sectorAdjustedNameDiversificationScore * 0.2 +
      withinClassConcentrationScore * 0.15
  );

  // ---- Correlation matrix (grouped by asset class present) ----
  const classGroups = new Map<AssetClass, { returns: number[]; value: number }>();
  for (const h of aligned) {
    const existing = classGroups.get(h.assetClass);
    if (!existing) {
      classGroups.set(h.assetClass, { returns: h.alignedReturns.map((r) => r * h.value), value: h.value });
    } else {
      for (let t = 0; t < alignLength; t++) existing.returns[t] += h.alignedReturns[t] * h.value;
      existing.value += h.value;
    }
  }
  const classLabels = Array.from(classGroups.keys());
  const classSeries = classLabels.map((label) => {
    const g = classGroups.get(label)!;
    return g.returns.map((sum) => sum / g.value); // back to a weighted-average return series for that class
  });
  const correlationMatrixValues: number[][] = classSeries.map((a) => classSeries.map((b) => Math.round(correlation(a, b) * 100) / 100));
  // Value-weighted, not a flat average of pairs — a correlation between two
  // classes that together make up 90% of the portfolio should matter more to
  // the overall picture than one between two classes that are 2% of it each.
  let avgCorrelation = 0;
  if (classLabels.length > 1) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < classLabels.length; i++) {
      for (let j = i + 1; j < classLabels.length; j++) {
        const wi = (classGroups.get(classLabels[i])!.value) / totalValue;
        const wj = (classGroups.get(classLabels[j])!.value) / totalValue;
        const pairWeight = wi * wj;
        weightedSum += correlationMatrixValues[i][j] * pairWeight;
        weightTotal += pairWeight;
      }
    }
    avgCorrelation = weightTotal > 0 ? weightedSum / weightTotal : 0;
  }
  // A single-asset-class portfolio has achieved zero cross-asset-class
  // diversification — that's a real resilience gap, not a neutral outcome,
  // so it scores low (20) rather than a neutral 50 by default. (Previously
  // defaulted to a neutral 50, which combined with a high per-name
  // concentration score and equity's high liquidity score let an all-equity,
  // multi-stock portfolio score deceptively high overall.)
  //
  // EXCEPTION — Layer D: if the Context Engine says 1 class is exactly what's
  // expected for this user right now (e.g. a Starter-corpus portfolio), that
  // single class isn't a resilience mistake to punish — score it neutral (50)
  // instead of low (20). If more than 1 class is expected and the user still
  // only holds 1, the low (20) score still applies — that IS a genuine gap
  // relative to what's achievable for their own situation.
  const singleClassCorrelationScore = context.expectedAssetClasses.length <= 1 ? 50 : 20;
  const correlationScore = classLabels.length > 1 ? scoreFromRange(avgCorrelation, 1, -0.2) : singleClassCorrelationScore;

  // ---- Drawdown resilience ----
  let peak = 100;
  let index = 100;
  let maxDrawdownPct = 0;
  let troughIdx = -1;
  const indexSeries: number[] = [];
  for (let t = 0; t < alignLength; t++) {
    index *= 1 + portfolioReturns[t];
    indexSeries.push(index);
    if (index > peak) peak = index;
    const dd = (index - peak) / peak;
    if (dd < maxDrawdownPct) {
      maxDrawdownPct = dd;
      troughIdx = t;
    }
  }
  let recovered = false;
  let recoveryDays: number | null = null;
  if (troughIdx >= 0) {
    const preDrawdownPeak = Math.max(...indexSeries.slice(0, troughIdx + 1));
    for (let t = troughIdx + 1; t < alignLength; t++) {
      if (indexSeries[t] >= preDrawdownPeak) {
        recovered = true;
        recoveryDays = t - troughIdx;
        break;
      }
    }
  } else {
    recovered = true;
  }
  const drawdownScoreBase = scoreFromRange(maxDrawdownPct, personaBounds.drawdownWorstAt, -0.02);
  const drawdownScore = recovered ? drawdownScoreBase : Math.max(0, drawdownScoreBase - 15);

  // ---- VaR (historical simulation) ----
  const sorted = [...portfolioReturns].sort((a, b) => a - b);
  const pctlIdx = Math.max(0, Math.floor(0.05 * sorted.length) - 1);
  const oneDayPct = sorted[pctlIdx] ?? 0;
  // 1-month VaR approximated by scaling the 1-day figure by sqrt(21 trading
  // days) — a standard parametric extension, used here because the aligned
  // history usually isn't long enough for a robust rolling-21-day empirical
  // distribution. An approximation, not a precise monthly simulation.
  const oneMonthPct = oneDayPct * Math.sqrt(21);
  const varDetail = {
    oneDayPct,
    oneDayINR: Math.abs(oneDayPct * totalValue),
    oneMonthPct,
    oneMonthINR: Math.abs(oneMonthPct * totalValue),
  };
  const varScore = scoreFromRange(oneDayPct, -0.08, -0.005);

  // ---- Liquidity ----
  let liquidityWeighted = 0;
  for (const h of aligned) liquidityWeighted += h.weight * (LIQUIDITY_TIER[h.assetClass] ?? 50);
  const liquidityScore = Math.round(liquidityWeighted);

  // ---- Beta vs Nifty 50 ----
  let portfolioBeta = 0;
  for (const h of aligned) portfolioBeta += h.weight * h.beta;
  const betaScore = scoreFromRange(portfolioBeta, 1.8, 0.2);

  // ---- Diversification ratio: weighted avg individual vol / portfolio vol ----
  let weightedIndividualVol = 0;
  for (const h of aligned) weightedIndividualVol += h.weight * stdev(h.alignedReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const diversificationRatio = annualizedVol > 0 ? weightedIndividualVol / annualizedVol : 1;
  const diversificationRatioScore = scoreFromRange(diversificationRatio, 1.0, 2.2);

  const subScores = {
    concentration: { score: concentrationScore, value: classHhi, label: "Concentration (apparent + real diversification)" },
    volatility: { score: volatilityScore, value: annualizedVol, label: "Annualized volatility" },
    drawdown: { score: drawdownScore, value: maxDrawdownPct, label: "Max drawdown" },
    var: { score: varScore, value: oneDayPct, label: "1-day 95% VaR" },
    liquidity: { score: liquidityScore, value: liquidityWeighted, label: "Liquidity" },
    beta: { score: betaScore, value: portfolioBeta, label: "Beta vs Nifty 50" },
    correlation: { score: correlationScore, value: avgCorrelation, label: "Avg. cross-asset-class correlation" },
    diversificationRatio: { score: diversificationRatioScore, value: diversificationRatio, label: "Diversification ratio" },
    contextFit: {
      score: contextFitScore,
      value: expectedHeldCount / Math.max(1, context.expectedAssetClasses.length),
      label: `Coverage of what's expected for a ${context.corpusTier.label.toLowerCase()} portfolio (${context.persona.label})`,
    },
    stockCountFit: {
      score: stockCountFitScore,
      value: equityNames.size,
      label: "Equity stock-count band (too few = concentration risk, too many = diminishing benefit)",
    },
  };

  const compositeScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Object.entries(DIVE_SCORE_V2_WEIGHTS).reduce((sum, [key, weight]) => sum + weight * subScores[key as keyof typeof subScores].score, 0)
      )
    )
  );

  const realCoverageValue = aligned.filter((h) => !h.series.isSynthetic).reduce((s, h) => s + h.value, 0);

  return {
    hasHoldings: true,
    compositeScore,
    weights: DIVE_SCORE_V2_WEIGHTS,
    apparentDiversificationPct,
    realDiversificationPct,
    connections,
    subScores,
    drawdownDetail: { maxDrawdownPct, recovered, recoveryDays },
    varDetail,
    correlationMatrix: { labels: classLabels, matrix: correlationMatrixValues },
    dataQuality: {
      realPriceCoveragePct: Math.round((realCoverageValue / totalValue) * 100),
      marketFactorIsSynthetic,
      holdings: aligned.map((h) => ({ name: h.name, assetClass: h.assetClass, isSynthetic: h.series.isSynthetic, label: h.series.label })),
    },
    context,
  };
}
