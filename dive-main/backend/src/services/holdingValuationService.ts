import { Types } from "mongoose";
import { Holding } from "../models/Holding";
import { AssetClass } from "../models/Instrument";
import { computeFdValues, computePfValues, FdHoldingInput, PfHoldingInput } from "../validators/holdings";
import { resolveHoldingLatestPrice, MARKET_PRICEABLE_CLASSES, LatestPriceInput } from "./priceHistoryService";
import { invalidateDiveScoreCache } from "./diveScoreService";
import { getPremiumUserIds } from "./entitlementService";
import { logger } from "../lib/logger";

/**
 * Keeps every holding's `currentValue` fresh on a daily cadence instead of
 * only ever moving at create/edit/AA-sync time (see
 * docs/PRODUCTION_READINESS_AUDIT.md's entry for this job for the full bug
 * report this was built for). Two independent passes:
 *
 *  1. FD/PF — re-runs the exact same compound-interest formulas
 *     (computeFdValues/computePfValues, validators/holdings.ts) that already
 *     run at create/edit time, just against today's date instead of whenever
 *     the holding was last touched. Pure math, no network, always available.
 *  2. Market-priced (EQUITY/ETF/GOLD/SILVER/MUTUAL_FUND/CRYPTO) — fetches
 *     each DISTINCT linked instrument's latest real price/NAV once (deduped
 *     across every holding and every user that references it, not once per
 *     holding) and writes currentValue = quantity × price. Only holdings
 *     with both a resolvable instrumentId AND a quantity can be repriced
 *     this way — a holding entered as a plain manual value (no linked
 *     instrument) has no price to multiply against and is left exactly as
 *     it was, same as before this job existed. CRYPTO's price comes from
 *     the exact same CoinGecko INR feed (vs_currency: "inr") that already
 *     powers Ask DIVVE's own crypto detail card — genuinely INR-denominated
 *     at the source, not a USD figure converted by this app. Every other
 *     asset class (BOND/REIT/INVIT/ULIP_INSURANCE) has no real-in-INR price
 *     source at all — see MARKET_PRICEABLE_CLASSES's own comment.
 *
 * Deliberately does NOT call invalidateReportPurchase/bump portfolioVersion
 * — a product decision (confirmed with the user, not assumed): routine
 * daily price/interest drift alone must not force a previously-paid
 * resilience-score report to go stale and need a fresh purchase.
 * Only a genuine portfolio composition change (holdings added/edited/
 * deleted, an AA sync, an age change) does that, via the existing call
 * sites in holdingsController.ts/aaController.ts/userController.ts — this
 * job only clears the (5-min-TTL, in-memory) Dive Score cache so the score
 * itself reflects today's values immediately, everywhere else in the app.
 */

export interface ValuationRefreshSummary {
  fdPfUpdated: number;
  marketPricedUpdated: number;
  distinctInstrumentsPriced: number;
  usersTouched: number;
  // Holdings skipped because their recomputed value wasn't a real number
  // (see isUsableValue) — left exactly as they were, and logged by id.
  invalidSkipped: number;
}

// A recomputed value is only safe to WRITE if it's a real, finite number. A
// holding with a missing/garbled field (say an FD with no startMonth) makes
// the compound-interest math come out NaN, and one NaN in a bulkWrite makes
// Mongoose reject the ENTIRE batch — so a single bad holding used to stop
// every other holding from being repriced, for everyone, and (because the
// error escaped the job) the market-price pass never ran either. Such a
// holding is skipped and logged instead; everything else still updates.
function isUsableValue(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function skipInvalidHolding(kind: string, h: { _id: unknown; userId: unknown }, values: Record<string, unknown>): void {
  logger.warn({ holdingId: String(h._id), userId: String(h.userId), kind, values }, "[valuationRefresh] skipped a holding whose recomputed value isn't a real number — left unchanged; check its fields");
}

export interface FdPfHoldingLean {
  _id: unknown;
  userId: unknown;
  assetClass: "FD" | "PF";
  investedValue: number;
  currentValue: number;
  extraFields: Record<string, unknown>;
}

// The ONE place an FD/PF holding's stored fields are turned back into inputs
// for the compound-interest maths — used by the daily job below AND by
// scripts/listBrokenFdPfHoldings.ts, so the audit can never disagree with what
// the job would actually do.
export function recomputeFdPfHolding(h: FdPfHoldingLean): { currentValue: number; investedToDate: number } {
  if (h.assetClass === "FD") {
    const input: FdHoldingInput = {
      assetClass: "FD",
      bank: h.extraFields.bank as string,
      // extraFields.principal (the pure lump sum) first, falling back to
      // investedValue only for an FD holding created before this field
      // existed — see holdingsController.ts's own identical fallback
      // comment for why that's safe (investedValue === principal exactly
      // for every such holding, since monthlyContribution didn't exist
      // yet to make them diverge).
      principal: (h.extraFields.principal as number | undefined) ?? h.investedValue,
      tenureMonths: h.extraFields.tenureMonths as number,
      startMonth: h.extraFields.startMonth as number,
      startYear: h.extraFields.startYear as number,
      interestRate: h.extraFields.interestRate as number,
      monthlyContribution: h.extraFields.monthlyContribution as number | undefined,
    };
    // maturityValue/maturityDate are constants of (start, tenureMonths,
    // principal, monthlyContribution) alone — they never change with
    // elapsed time the way currentValue/investedToDate do — so only those
    // two are worth rewriting. investedToDate grows as monthlyContribution
    // accrues (an RD-style FD) — must move alongside currentValue, or a
    // growing contribution would silently read as "gain" (currentValue minus
    // investedValue) it isn't; a no-op for a plain FD with no
    // monthlyContribution (investedToDate stays exactly `principal`).
    const { currentValue, investedToDate } = computeFdValues(input);
    return { currentValue, investedToDate };
  }
  const input: PfHoldingInput = {
    assetClass: "PF",
    subType: h.extraFields.subType as PfHoldingInput["subType"],
    institution: h.extraFields.institution as string,
    openingBalance: h.extraFields.openingBalance as number,
    monthlyContribution: h.extraFields.monthlyContribution as number,
    startMonth: h.extraFields.startMonth as number,
    startYear: h.extraFields.startYear as number,
    interestRatePercent: h.extraFields.interestRatePercent as number,
  };
  // investedToDate grows as monthlyContribution accrues — must move
  // alongside currentValue, or a growing contribution would silently read as
  // "gain" (currentValue minus investedValue) it isn't. Same reasoning as
  // computePfValues's own doc comment.
  const { currentValue, investedToDate } = computePfValues(input);
  return { currentValue, investedToDate };
}

// Whether a recomputed value can safely be written (see isUsableValue).
export function isFdPfHoldingBroken(h: FdPfHoldingLean): boolean {
  const { currentValue, investedToDate } = recomputeFdPfHolding(h);
  return !isUsableValue(currentValue) || !isUsableValue(investedToDate);
}

// Which stored fields make the maths come out NaN — a human-readable hint for
// whoever has to fix the record. (monthlyContribution is optional for both
// types, so it's never listed.)
export function fdPfFieldProblems(h: FdPfHoldingLean): string[] {
  const fields: Array<[string, unknown]> =
    h.assetClass === "FD"
      ? [
          ["principal", (h.extraFields.principal as number | undefined) ?? h.investedValue],
          ["tenureMonths", h.extraFields.tenureMonths],
          ["startMonth", h.extraFields.startMonth],
          ["startYear", h.extraFields.startYear],
          ["interestRate", h.extraFields.interestRate],
        ]
      : [
          ["openingBalance", h.extraFields.openingBalance],
          ["startMonth", h.extraFields.startMonth],
          ["startYear", h.extraFields.startYear],
          ["interestRatePercent", h.extraFields.interestRatePercent],
        ];
  const problems: string[] = [];
  for (const [name, value] of fields) {
    if (isUsableValue(value)) continue;
    problems.push(value === undefined || value === null ? `${name} is missing` : `${name} is not a valid number (${JSON.stringify(value)})`);
  }
  return problems;
}

async function refreshFdPfValuations(touchedUserIds: Set<string>, premiumUserIds: Types.ObjectId[]): Promise<{ updated: number; skipped: number }> {
  const holdings = (await Holding.find({ assetClass: { $in: ["FD", "PF"] }, userId: { $in: premiumUserIds } }).lean()) as unknown as FdPfHoldingLean[];
  const ops: Array<{ updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } } }> = [];
  let skipped = 0;

  for (const h of holdings) {
    const { currentValue, investedToDate } = recomputeFdPfHolding(h);
    if (!isUsableValue(currentValue) || !isUsableValue(investedToDate)) {
      skipInvalidHolding(h.assetClass, h, { currentValue, investedToDate, problems: fdPfFieldProblems(h) });
      skipped += 1;
      continue;
    }
    if (currentValue !== h.currentValue || investedToDate !== h.investedValue) {
      ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { currentValue, investedValue: investedToDate } } } });
      touchedUserIds.add(String(h.userId));
    }
  }

  if (ops.length) await Holding.bulkWrite(ops);
  return { updated: ops.length, skipped };
}

interface MarketPricedHoldingLean {
  _id: unknown;
  userId: unknown;
  assetClass: AssetClass;
  quantity?: number;
  currentValue: number;
  instrumentId?: { _id: unknown; symbol?: string; metadata?: Record<string, unknown> } | null;
}

interface InstrumentGroup {
  assetClass: AssetClass;
  symbol?: string;
  coingeckoId?: string;
  holdings: Array<{ _id: unknown; userId: unknown; quantity: number; currentValue: number }>;
}

async function refreshMarketPricedValuations(
  touchedUserIds: Set<string>,
  priceResolver: (input: LatestPriceInput) => Promise<number | null>,
  premiumUserIds: Types.ObjectId[]
): Promise<{ updated: number; distinctInstruments: number; skipped: number }> {
  const holdings = (await Holding.find({
    assetClass: { $in: MARKET_PRICEABLE_CLASSES },
    instrumentId: { $ne: null },
    quantity: { $gt: 0 },
    userId: { $in: premiumUserIds },
  })
    .populate("instrumentId", "symbol metadata")
    .lean()) as unknown as MarketPricedHoldingLean[];

  // Group by (assetClass, resolveKey) so an instrument held by 500 users is
  // priced exactly once, not 500 times — the whole reason this is a
  // separate grouping pass rather than a plain per-holding loop. CRYPTO's
  // resolveKey is metadata.coingeckoId (CoinGecko's own API id, e.g.
  // "bitcoin") rather than Instrument.symbol (a plain ticker, e.g. "BTC") —
  // same split diveScoreService.ts already uses for the same reason.
  const groups = new Map<string, InstrumentGroup>();
  for (const h of holdings) {
    if (!h.quantity) continue;
    const isCrypto = h.assetClass === "CRYPTO";
    const coingeckoId = isCrypto ? (h.instrumentId?.metadata?.coingeckoId as string | undefined) : undefined;
    const symbol = isCrypto ? undefined : h.instrumentId?.symbol;
    const resolveKey = coingeckoId ?? symbol;
    if (!resolveKey) continue; // no resolvable instrument — nothing to reprice against
    const key = `${h.assetClass}:${resolveKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { assetClass: h.assetClass, symbol, coingeckoId, holdings: [] };
      groups.set(key, group);
    }
    group.holdings.push({ _id: h._id, userId: h.userId, quantity: h.quantity, currentValue: h.currentValue });
  }

  const ops: Array<{ updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } } }> = [];
  let skipped = 0;
  // Sequential, not parallel — same known, accepted tradeoff as
  // diveScoreService.ts's own per-holding price fetches (see
  // docs/PRODUCTION_READINESS_AUDIT.md #30): simplest correct thing at
  // today's instrument count, would need a concurrency limit or a circuit
  // breaker if this ever grows large enough for external API rate limits
  // to matter here specifically.
  for (const group of groups.values()) {
    const price = await priceResolver({ assetClass: group.assetClass, symbol: group.symbol, coingeckoId: group.coingeckoId });
    if (price == null) continue; // unresolvable today — every holding in this group is left exactly as it was
    for (const h of group.holdings) {
      const newValue = Math.round(price * h.quantity);
      if (!isUsableValue(newValue)) {
        skipInvalidHolding(group.assetClass, { _id: h._id, userId: h.userId }, { price, quantity: h.quantity, newValue });
        skipped += 1;
        continue;
      }
      if (newValue !== h.currentValue) {
        ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { currentValue: newValue } } } });
        touchedUserIds.add(String(h.userId));
      }
    }
  }

  if (ops.length) await Holding.bulkWrite(ops);
  return { updated: ops.length, distinctInstruments: groups.size, skipped };
}

async function runDailyValuationRefreshInternal(
  priceResolver: (input: LatestPriceInput) => Promise<number | null>
): Promise<ValuationRefreshSummary> {
  // Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.1/§3.2 — daily revaluation is a
  // Premium-only entitlement; a Freemium holding's currentValue stays
  // exactly as entered (or last edited) until this job has a reason to
  // touch it, i.e. never. "Auto-updated Dive Score: Off" for Freemium is a
  // natural consequence of this filter, not separate logic — see
  // entitlementService.ts's own comment on getPremiumUserIds.
  const premiumUserIds = await getPremiumUserIds();
  const touchedUserIds = new Set<string>();
  const { updated: fdPfUpdated, skipped: fdPfSkipped } = await refreshFdPfValuations(touchedUserIds, premiumUserIds);
  const { updated: marketPricedUpdated, distinctInstruments, skipped: marketSkipped } = await refreshMarketPricedValuations(touchedUserIds, priceResolver, premiumUserIds);

  for (const userId of touchedUserIds) invalidateDiveScoreCache(userId);

  return { fdPfUpdated, marketPricedUpdated, distinctInstrumentsPriced: distinctInstruments, usersTouched: touchedUserIds.size, invalidSkipped: fdPfSkipped + marketSkipped };
}

// In-flight dedup — same reasoning/shape as instrumentService.ts's
// runInstrumentRefresh: without this, an overlapping manual `--once` run
// (or a tsx-watch dev restart racing the cron) could start a second pass
// while one's already running, doubling up on external price-API calls.
let refreshInFlight: Promise<ValuationRefreshSummary> | null = null;

// `priceResolver` defaults to the real network-backed resolver — tests
// inject a stub instead of relying on env.nodeEnv==="test" gating (which
// resolveHoldingLatestPrice also has, but that would make the dedup/
// apply-to-every-holding-in-the-group logic below untestable without a real
// network call).
export function runDailyValuationRefresh(
  priceResolver: (input: LatestPriceInput) => Promise<number | null> = resolveHoldingLatestPrice
): Promise<ValuationRefreshSummary> {
  if (!refreshInFlight) {
    refreshInFlight = runDailyValuationRefreshInternal(priceResolver).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
