import { Holding } from "../models/Holding";
import { AssetClass } from "../models/Instrument";
import { computeFdValues, computePfValues, FdHoldingInput, PfHoldingInput } from "../validators/holdings";
import { resolveHoldingLatestPrice, MARKET_PRICEABLE_CLASSES, LatestPriceInput } from "./priceHistoryService";
import { invalidateDiveScoreCache } from "./diveScoreService";

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
 * resilience-score report to go stale and need a fresh Rs. 99 purchase.
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
}

interface FdPfHoldingLean {
  _id: unknown;
  userId: unknown;
  assetClass: "FD" | "PF";
  investedValue: number;
  currentValue: number;
  extraFields: Record<string, unknown>;
}

async function refreshFdPfValuations(touchedUserIds: Set<string>): Promise<number> {
  const holdings = (await Holding.find({ assetClass: { $in: ["FD", "PF"] } }).lean()) as unknown as FdPfHoldingLean[];
  const ops: Array<{ updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } } }> = [];

  for (const h of holdings) {
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
      // two are worth rewriting here. investedToDate grows as
      // monthlyContribution accrues (an RD-style FD) — must move alongside
      // currentValue, or a growing contribution would silently read as
      // "gain" (currentValue minus investedValue) it isn't; same reasoning
      // as the PF branch below, and a no-op for a plain FD with no
      // monthlyContribution (investedToDate stays exactly `principal`).
      const { currentValue, investedToDate } = computeFdValues(input);
      if (currentValue !== h.currentValue || investedToDate !== h.investedValue) {
        ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { currentValue, investedValue: investedToDate } } } });
        touchedUserIds.add(String(h.userId));
      }
    } else {
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
      // alongside currentValue, or a growing contribution would silently
      // read as "gain" (currentValue minus investedValue) it isn't. Same
      // reasoning as computePfValues's own doc comment.
      const { currentValue, investedToDate } = computePfValues(input);
      if (currentValue !== h.currentValue || investedToDate !== h.investedValue) {
        ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { currentValue, investedValue: investedToDate } } } });
        touchedUserIds.add(String(h.userId));
      }
    }
  }

  if (ops.length) await Holding.bulkWrite(ops);
  return ops.length;
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
  priceResolver: (input: LatestPriceInput) => Promise<number | null>
): Promise<{ updated: number; distinctInstruments: number }> {
  const holdings = (await Holding.find({
    assetClass: { $in: MARKET_PRICEABLE_CLASSES },
    instrumentId: { $ne: null },
    quantity: { $gt: 0 },
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
      if (newValue !== h.currentValue) {
        ops.push({ updateOne: { filter: { _id: h._id }, update: { $set: { currentValue: newValue } } } });
        touchedUserIds.add(String(h.userId));
      }
    }
  }

  if (ops.length) await Holding.bulkWrite(ops);
  return { updated: ops.length, distinctInstruments: groups.size };
}

async function runDailyValuationRefreshInternal(
  priceResolver: (input: LatestPriceInput) => Promise<number | null>
): Promise<ValuationRefreshSummary> {
  const touchedUserIds = new Set<string>();
  const fdPfUpdated = await refreshFdPfValuations(touchedUserIds);
  const { updated: marketPricedUpdated, distinctInstruments } = await refreshMarketPricedValuations(touchedUserIds, priceResolver);

  for (const userId of touchedUserIds) invalidateDiveScoreCache(userId);

  return { fdPfUpdated, marketPricedUpdated, distinctInstrumentsPriced: distinctInstruments, usersTouched: touchedUserIds.size };
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
