// Divve Planner — pure computation module (no React). Answers a forward-
// looking question Suggestions/Ask DIVVE don't: given money about to be
// invested (a lump sum, or an ongoing SIP), how should it split across asset
// classes to build (or extend) an ideal portfolio — considering what's
// already held, the user's risk profile, and their preferences. Asset-class
// level only, same as the rest of the app — never a specific instrument.

import {
  CORE_CATEGORIES,
  IDEAL_RANGES,
  ASSET_CLASS_LABELS,
  totalInvested,
  segmentBreakdown,
  RETURN_TIER,
  RETURN_TIER_SCORE,
  RETURN_BIAS,
  DIVERSIFICATION_CAP,
} from "./diveEngine";

// ---------------------------------------------------------------------------
// Ported from backend/src/services/contextEngine.ts — keep these two in
// sync. Duplicated (not imported) because, unlike scoreBreakdown.context
// (resolved once server-side over a user's real, persisted holdings), the
// Planner needs this resolved against hypothetical totals that never round-
// trip: a lumpsum slider tick recomputes instantly on every change, and a
// SIP plan calls it up to ~360 times (month-by-month over decades) in one
// client-side loop — the same reasoning diveEngine.js's normalizeIssuer()
// mirror already documents for independently-duplicated logic over
// synthetic, never-persisted data.
// ---------------------------------------------------------------------------
const CORPUS_TIERS = [
  { id: "starter", maxAmount: 25000, expectedClassCount: 1 },
  { id: "growing", maxAmount: 200000, expectedClassCount: 3 },
  { id: "established", maxAmount: 1000000, expectedClassCount: 5 },
  { id: "substantial", maxAmount: 5000000, expectedClassCount: 8 },
  { id: "large", maxAmount: Infinity, expectedClassCount: 11 },
];

function resolveCorpusTier(totalInvestedAmount) {
  return CORPUS_TIERS.find((t) => totalInvestedAmount < t.maxAmount) || CORPUS_TIERS[CORPUS_TIERS.length - 1];
}

const PERSONA_BRACKETS = [
  { id: "earlyCareer", minAge: 18, maxAge: 28, priorityClasses: ["EQUITY", "MUTUAL_FUND", "GOLD", "CRYPTO"], deprioritizedClasses: ["FD", "BOND", "ULIP_INSURANCE", "REIT", "INVIT"] },
  { id: "buildingPhase", minAge: 29, maxAge: 40, priorityClasses: ["EQUITY", "MUTUAL_FUND", "GOLD", "BOND"], deprioritizedClasses: ["ULIP_INSURANCE", "REIT", "INVIT"] },
  { id: "peakEarning", minAge: 41, maxAge: 55, priorityClasses: ["EQUITY", "MUTUAL_FUND", "BOND", "FD", "GOLD", "REIT", "INVIT"], deprioritizedClasses: [] },
  { id: "preRetirement", minAge: 56, maxAge: 64, priorityClasses: ["BOND", "FD", "MUTUAL_FUND", "GOLD", "ULIP_INSURANCE", "EQUITY"], deprioritizedClasses: ["CRYPTO"] },
  { id: "retired", minAge: 65, maxAge: null, priorityClasses: ["FD", "BOND", "ULIP_INSURANCE", "GOLD", "MUTUAL_FUND", "EQUITY"], deprioritizedClasses: ["CRYPTO"] },
];

function resolvePersona(age) {
  return (
    PERSONA_BRACKETS.find((p) => age >= p.minAge && (p.maxAge === null || age <= p.maxAge)) ||
    PERSONA_BRACKETS[PERSONA_BRACKETS.length - 1]
  );
}

const DEFAULT_CLASS_ORDER = ["EQUITY", "MUTUAL_FUND", "GOLD", "BOND", "FD", "ETF", "SILVER", "REIT", "INVIT", "CRYPTO", "ULIP_INSURANCE"];

function fullPersonaOrder(persona) {
  const ordered = [];
  const seen = new Set();
  const push = (c) => {
    if (!seen.has(c)) {
      seen.add(c);
      ordered.push(c);
    }
  };
  persona.priorityClasses.forEach(push);
  DEFAULT_CLASS_ORDER.filter((c) => !persona.deprioritizedClasses.includes(c)).forEach(push);
  persona.deprioritizedClasses.forEach(push);
  return ordered;
}

// Returns both the corpus-tier-restricted set (the honest "what's expected
// right now" answer) and the full 11-class persona order (used as a
// fallback — see resolveCandidates below — when the restricted set turns
// out to be entirely excluded).
function resolveContext(totalInvestedAmount, age) {
  const corpusTier = resolveCorpusTier(totalInvestedAmount);
  const persona = resolvePersona(age ?? 30); // fall back to a mid-range age rather than crash if unknown
  const orderedAll = fullPersonaOrder(persona);
  return { corpusTier, persona, expectedAssetClasses: orderedAll.slice(0, corpusTier.expectedClassCount), orderedAll };
}

// ---------------------------------------------------------------------------
// Category selection + weighting
// ---------------------------------------------------------------------------

// Maps the 11-way asset-class enum (some entries collapse to the same label,
// e.g. REIT+INVIT -> "REIT/InvIT") down to the unique CORE_CATEGORIES labels
// the rest of the app operates on, preserving first-seen order.
function toCoreCategoryOrder(assetClasses) {
  const out = [];
  const seen = new Set();
  assetClasses.forEach((ac) => {
    const label = ASSET_CLASS_LABELS[ac];
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  });
  return out;
}

function idealMidpoint(cat, risk) {
  const [lo, hi] = (IDEAL_RANGES[risk] || IDEAL_RANGES.Balanced)[cat] || [0, 0];
  return (lo + hi) / 2;
}

// Turns a corpus/persona-eligible CANDIDATE set into the ACTUAL funded set.
// NOTE: DIVERSIFICATION_CAP is reused from diveEngine.js but with a
// DIFFERENT semantic than personalizeSuggestions() — there it only soft-
// notes a card (never removes it); here it genuinely decides which
// categories receive new money, since the Planner's whole job is to produce
// real personalized numbers, unlike Suggestions where personalization must
// stay presentation-only to keep the DIVE Score's own math honest.
export function resolveActiveCategories(candidateCategories, prefs, risk) {
  const excluded = new Set(prefs?.excluded || []);
  const preferredSet = new Set(prefs?.preferred || []);
  const remaining = candidateCategories.filter((c) => !excluded.has(c));

  const preferredInC = remaining.filter((c) => preferredSet.has(c));
  const othersInC = remaining
    .filter((c) => !preferredSet.has(c))
    .sort((a, b) => idealMidpoint(b, risk) - idealMidpoint(a, risk));

  const cap = DIVERSIFICATION_CAP[prefs?.diversificationPriority] ?? Infinity;
  // Preferred is a FLOOR, not a further trim: if the user has more preferred
  // categories than the cap allows, all of them are still kept — the cap
  // only limits how many ADDITIONAL non-preferred categories get pulled in.
  const remainingSlots = Math.max(0, cap - preferredInC.length);
  return [...preferredInC, ...othersInC.slice(0, remainingSlots)];
}

// A small corpus tier can legitimately expect just 1-3 categories — if the
// ONE category a Starter-tier portfolio would expect happens to be user-
// excluded, resolveActiveCategories on the tier-restricted candidates alone
// would strand that period's money with nowhere to go, even though the user
// hasn't excluded anywhere near all 9 categories overall. Falls back to the
// full persona-ordered 9-category set before giving up.
function resolveCandidatesWithFallback(context, prefs, risk) {
  const tierCandidates = toCoreCategoryOrder(context.expectedAssetClasses);
  const active = resolveActiveCategories(tierCandidates, prefs, risk);
  if (active.length > 0) return active;
  const widenedCandidates = toCoreCategoryOrder(context.orderedAll);
  return resolveActiveCategories(widenedCandidates, prefs, risk);
}

// Normalized ideal-% weights (sum to 100) across an already-resolved active
// set. A modest RETURN_BIAS nudge shifts weight toward growth-tier
// categories for "High" return expectation (and away for "Modest") — a REAL
// numeric adjustment, unlike personalizeSuggestions()'s pure re-ranking,
// because the Planner is meant to produce genuinely personalized
// allocations, not just re-order/annotate an already-honest number.
const BIAS_STRENGTH = 0.15; // modest nudge — never lets return bias dominate the risk-tier ideal ranges
export function computeActiveWeights(activeCategories, risk, prefs) {
  if (activeCategories.length === 0) return {};
  const returnBias = RETURN_BIAS[prefs?.returnExpectation] ?? 0;

  const raw = {};
  activeCategories.forEach((cat) => {
    const base = idealMidpoint(cat, risk);
    const tierScore = RETURN_TIER_SCORE[RETURN_TIER[cat]] ?? 0;
    raw[cat] = Math.max(0, base * (1 + returnBias * tierScore * BIAS_STRENGTH));
  });
  const sum = Object.values(raw).reduce((s, v) => s + v, 0);
  if (sum <= 0) {
    // Degenerate guard (shouldn't happen with real IDEAL_RANGES data) — split evenly rather than divide by zero.
    const even = 100 / activeCategories.length;
    const out = {};
    activeCategories.forEach((c) => (out[c] = even));
    return out;
  }
  const weights = {};
  activeCategories.forEach((cat) => (weights[cat] = (raw[cat] / sum) * 100));
  return weights;
}

function existingByCategoryOf(holdings) {
  const map = {};
  segmentBreakdown(holdings).forEach((s) => {
    map[s.name] = s.amount;
  });
  return map;
}

// ---------------------------------------------------------------------------
// Lumpsum
// ---------------------------------------------------------------------------
export function planLumpsum({ holdings, newAmount, prefs, risk, age }) {
  const existingTotal = totalInvested(holdings);
  const existingByCategory = existingByCategoryOf(holdings);
  const targetTotal = existingTotal + newAmount;

  const context = resolveContext(targetTotal, age);
  const active = resolveCandidatesWithFallback(context, prefs, risk);

  if (active.length === 0) {
    // Every one of the 9 categories is excluded — nowhere for new money to go.
    const rows = CORE_CATEGORIES.map((cat) => {
      const existingAmount = existingByCategory[cat] || 0;
      return { cat, existingAmount, targetAmount: 0, newInvestment: 0, finalAmount: existingAmount, finalPct: targetTotal ? (existingAmount / targetTotal) * 100 : 0 };
    });
    return { error: "ALL_EXCLUDED", targetTotal, rows, active: [] };
  }

  const weights = computeActiveWeights(active, risk, prefs);
  const gaps = {};
  CORE_CATEGORIES.forEach((cat) => {
    const existingAmount = existingByCategory[cat] || 0;
    const targetAmount = ((weights[cat] || 0) / 100) * targetTotal;
    gaps[cat] = Math.max(0, targetAmount - existingAmount);
  });

  const rawRequiredNew = Object.values(gaps).reduce((s, v) => s + v, 0);
  const newInvestment = {};
  if (rawRequiredNew <= newAmount) {
    // Fund every gap in full, then spread the surplus proportional to weights.
    const surplus = newAmount - rawRequiredNew;
    CORE_CATEGORIES.forEach((cat) => {
      newInvestment[cat] = gaps[cat];
    });
    if (surplus > 0) {
      active.forEach((cat) => {
        newInvestment[cat] += surplus * (weights[cat] / 100);
      });
    }
  } else {
    // Not enough to close every gap — scale every gap down proportionally so they sum exactly to newAmount.
    const scale = rawRequiredNew > 0 ? newAmount / rawRequiredNew : 0;
    CORE_CATEGORIES.forEach((cat) => {
      newInvestment[cat] = gaps[cat] * scale;
    });
  }

  const rows = CORE_CATEGORIES.map((cat) => {
    const existingAmount = existingByCategory[cat] || 0;
    const targetAmount = ((weights[cat] || 0) / 100) * targetTotal;
    const finalAmount = existingAmount + (newInvestment[cat] || 0);
    return {
      cat,
      existingAmount,
      targetAmount,
      newInvestment: newInvestment[cat] || 0,
      finalAmount,
      finalPct: targetTotal ? (finalAmount / targetTotal) * 100 : 0,
    };
  });

  // Exposes the resolved active-category list (not just the per-category
  // rows) so the UI can tell "genuinely part of this plan" apart from
  // "included in `rows` with a zero weight because CORE_CATEGORIES always
  // gets a full row" — without it, the screen has no way to distinguish an
  // eligible category from an ineligible one already in the array.
  return { targetTotal, rows, active };
}

// ---------------------------------------------------------------------------
// SIP
// ---------------------------------------------------------------------------
export function planSip({ holdings, monthlyAmount, annualStepUpPct, years, prefs, risk, age }) {
  const existingTotal = totalInvested(holdings);
  const totalMonths = Math.max(1, Math.round(years * 12));

  const milestonedCategories = new Set();
  const milestones = [];
  const monthlyRows = [];
  let cumulativeContributed = 0;
  let anyActiveMonth = false;

  for (let month = 1; month <= totalMonths; month++) {
    const yearIndex = Math.floor((month - 1) / 12);
    const thisMonthContribution = monthlyAmount * Math.pow(1 + annualStepUpPct / 100, yearIndex);
    cumulativeContributed += thisMonthContribution;
    // Contributions only — no assumed investment growth. This is a
    // deliberate honesty choice (matching this app's existing "Demo only" /
    // "not a market forecast" framing on Suggestions' simulate sheet and
    // stress test): the plan shows exactly what's put in and how it's
    // split, never a projected/promised corpus value.
    const cumulativeTotal = existingTotal + cumulativeContributed;

    const context = resolveContext(cumulativeTotal, age);
    const active = resolveCandidatesWithFallback(context, prefs, risk);

    if (active.length === 0) {
      monthlyRows.push({ month, contribution: thisMonthContribution, cumulativeTotal, split: {} });
      continue;
    }
    anyActiveMonth = true;

    const weights = computeActiveWeights(active, risk, prefs);
    const split = {};
    active.forEach((cat) => {
      split[cat] = thisMonthContribution * (weights[cat] / 100);
    });

    active.forEach((cat) => {
      if (!milestonedCategories.has(cat)) {
        milestonedCategories.add(cat);
        milestones.push({ month, category: cat });
      }
    });

    monthlyRows.push({ month, contribution: thisMonthContribution, cumulativeTotal, split });
  }

  if (!anyActiveMonth) {
    return { error: "ALL_EXCLUDED" };
  }

  // Yearly rollup for the default compact view — a 20-year monthly table
  // (240 rows) is too much to show by default.
  const yearlyRows = [];
  const totalYears = Math.ceil(totalMonths / 12);
  for (let y = 0; y < totalYears; y++) {
    const monthsInYear = monthlyRows.slice(y * 12, y * 12 + 12);
    const contribution = monthsInYear.reduce((s, m) => s + m.contribution, 0);
    const split = {};
    CORE_CATEGORIES.forEach((cat) => {
      split[cat] = monthsInYear.reduce((s, m) => s + (m.split[cat] || 0), 0);
    });
    const cumulativeTotal = monthsInYear[monthsInYear.length - 1]?.cumulativeTotal ?? 0;
    yearlyRows.push({ year: y + 1, contribution, cumulativeTotal, split });
  }

  return { monthlyRows, yearlyRows, milestones };
}
