// DIVE deterministic scoring & look-through engine
// All 9 segment labels the app's 11-way backend assetClass enum collapses
// into (REIT+InvIT and Gold+Silver each share one label — see
// ASSET_CLASS_LABELS below) — every one of them gets a Suggestions card,
// a missing-category nudge, and an ideal-range target, not just a subset.
export const CORE_CATEGORIES = ["Equity", "Mutual Funds", "Bonds", "Gold/Silver", "REIT/InvIT", "FD", "ETF", "Insurance", "Crypto"];

// Maps the backend's canonical 11-way assetClass enum to the human-readable
// segment labels this engine (and the existing UI copy) was built around.
export const ASSET_CLASS_LABELS = {
  EQUITY: "Equity",
  MUTUAL_FUND: "Mutual Funds",
  ETF: "ETF",
  BOND: "Bonds",
  REIT: "REIT/InvIT",
  INVIT: "REIT/InvIT",
  GOLD: "Gold/Silver",
  SILVER: "Gold/Silver",
  ULIP_INSURANCE: "Insurance",
  FD: "FD",
  CRYPTO: "Crypto",
};

// Ideal allocation ranges by risk profile (% of portfolio). This is static
// methodology reference data (not user data), ported from the original demo
// backend, extended here with the same illustrative-target spirit for the 3
// classes it originally left out:
//   - ETF: mostly passive/index-tracking exposure (gold ETFs already land
//     under Gold/Silver via categorizeInstrument) — a modest complement to
//     Equity/Mutual Funds, not a third full-size equity bucket.
//   - Insurance (ULIP): conventional advice treats it as a small slice at
//     best, since bundling insurance with investment is cost-inefficient —
//     if anything higher for Conservative (protection-minded) than Aggressive.
//   - Crypto: high-volatility/speculative — kept small across every profile,
//     including Aggressive, rather than scaling up the way Equity does.
export const IDEAL_RANGES = {
  Conservative: {
    Equity: [20, 30], "Mutual Funds": [15, 25], Bonds: [20, 30],
    "Gold/Silver": [8, 12], "REIT/InvIT": [5, 10], FD: [10, 20],
    ETF: [3, 8], Insurance: [5, 10], Crypto: [0, 2],
  },
  Balanced: {
    Equity: [25, 35], "Mutual Funds": [20, 30], Bonds: [15, 25],
    "Gold/Silver": [8, 12], "REIT/InvIT": [8, 12], FD: [8, 15],
    ETF: [5, 10], Insurance: [3, 7], Crypto: [0, 5],
  },
  Aggressive: {
    Equity: [35, 50], "Mutual Funds": [20, 30], Bonds: [5, 15],
    "Gold/Silver": [5, 10], "REIT/InvIT": [8, 15], FD: [3, 8],
    ETF: [5, 12], Insurance: [2, 5], Crypto: [2, 8],
  },
};

// Converts a raw backend Holding document into the shape this engine expects.
// Real holdings have no fund-composition ("look-through") data unless we've
// separately ingested a fund's underlying stock disclosure — which this app
// does not do yet. So, honestly, look-through defaults to 100% into the
// holding's own name: concentration is only detected when the SAME instrument
// name recurs across multiple holdings (e.g. Reliance bought via two routes),
// not by decomposing a mutual fund/ETF into its underlying stocks.
export function adaptHolding(h) {
  const displayName = h.instrumentName || h.name;
  return {
    id: h._id || h.id,
    name: h.name,
    segment: ASSET_CLASS_LABELS[h.assetClass] || h.assetClass,
    type: h.extraFields?.type || h.assetClass,
    amount: h.currentValue ?? h.investedValue ?? 0,
    // Computed server-side per asset class (backend/src/services/
    // holdingQualityService.ts) from real data where we have it (NSE sector/
    // market-cap tier, crypto category) or a static regulatory fact (DICGC
    // FD insurance, SEBI REIT payout rule) — not a single "credit rating"
    // concept applied uniformly, since most asset classes don't have one.
    quality: h.quality || { label: "Not available", detail: "Quality/risk data isn't available for this asset class yet.", tier: "unknown" },
    source: h.source,
    needsReview: h.needsReview,
    lookthrough: [{ company: displayName, pct: 100 }],
    // Raw, unadapted fields — kept alongside the derived ones above (rather
    // than replacing them, to avoid touching every existing consumer of the
    // derived shape) purely so the edit-holding flow has enough to pre-fill
    // its form and PATCH only what actually changed. Nothing else should
    // need these; prefer the derived fields above for display.
    assetClass: h.assetClass,
    instrumentId: h.instrumentId,
    investedValue: h.investedValue,
    currentValue: h.currentValue,
    quantity: h.quantity,
    purchaseDate: h.purchaseDate,
    extraFields: h.extraFields,
  };
}

export const fmtINR = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

export const SEGMENT_COLORS = {
  Equity: "#E3B856",
  "Mutual Funds": "#A78BFA",
  Bonds: "#2DD4BF",
  "Gold/Silver": "#F59E0B",
  "REIT/InvIT": "#FB923C",
  ETF: "#38BDF8",
  FD: "#94A3B8",
  Insurance: "#F472B6",
  // Was missing entirely — fell back to the generic "#A1A1AA" gray on the
  // segment donut, same monochrome issue fixed for per-company colors earlier.
  Crypto: "#F43F5E",
};

// Fixed-order categorical palette for the company/look-through exposure
// donut — validated for colorblind-safe adjacency against this app's dark
// surfaces (node scripts/validate_palette.js from the dataviz skill). Assigned
// by RANK (largest exposure first), never cycled: a real portfolio's
// underlying-company list is open-ended free text (fund names, banks,
// arbitrary companies), so a static name->color map like the old
// COMPANY_COLORS only ever colored a handful of demo names and left every
// real holding's company painted the same fallback gray. Anything past the
// palette's length folds into one "Others" slice instead of reusing a hue.
const COMPANY_PALETTE = ["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181", "#008300"];
const OTHERS_COLOR = "#6B6B72"; // matches --text-tertiary — a muted catch-all, not a new hue

// Realistic underlying composition for a freshly simulated allocation per category
const SIM_TEMPLATES = {
  Equity: [{ company: "HDFC Bank", pct: 22 }, { company: "ICICI Bank", pct: 18 }, { company: "Infosys", pct: 16 }, { company: "TCS", pct: 14 }, { company: "Others (diversified)", pct: 30 }],
  "Mutual Funds": [{ company: "HDFC Bank", pct: 16 }, { company: "ICICI Bank", pct: 12 }, { company: "Infosys", pct: 10 }, { company: "Others (diversified)", pct: 62 }],
  ETF: [{ company: "HDFC Bank", pct: 14 }, { company: "ICICI Bank", pct: 10 }, { company: "Others (diversified)", pct: 76 }],
  Bonds: [{ company: "Govt / Bank", pct: 100 }],
  "Gold/Silver": [{ company: "Gold", pct: 100 }],
  "REIT/InvIT": [{ company: "Embassy REIT", pct: 55 }, { company: "IndiGrid InvIT", pct: 45 }],
  FD: [{ company: "Govt / Bank", pct: 100 }],
  Insurance: [{ company: "Govt / Bank", pct: 60 }, { company: "Others (diversified)", pct: 40 }],
  Crypto: [{ company: "Bitcoin", pct: 40 }, { company: "Ethereum", pct: 30 }, { company: "Others (diversified)", pct: 30 }],
};

// Merge persisted simulation allocations into holdings as synthetic holdings with realistic look-through
export function effectiveHoldings(holdings, sims = []) {
  const extra = (sims || [])
    .filter((s) => s.amount > 0)
    .map((s, i) => ({
      id: `sim-${s.segment}-${i}`,
      name: `Simulated ${s.segment}`,
      segment: s.segment,
      type: "Simulated allocation (demo)",
      amount: s.amount,
      quality: { label: "Simulated", detail: "Hypothetical amount you added in a simulation.", tier: "unknown" },
      simulated: true,
      lookthrough: SIM_TEMPLATES[s.segment] || [{ company: "Others (diversified)", pct: 100 }],
    }));
  return [...holdings, ...extra];
}

export function totalInvested(holdings) {
  return holdings.reduce((s, h) => s + h.amount, 0);
}

// aggregate by segment
export function segmentBreakdown(holdings, extra = null) {
  const map = {};
  holdings.forEach((h) => {
    map[h.segment] = (map[h.segment] || 0) + h.amount;
  });
  if (extra && extra.amount > 0) map[extra.segment] = (map[extra.segment] || 0) + extra.amount;
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map).map(([name, amount]) => ({
    name, amount, pct: total ? (amount / total) * 100 : 0, color: SEGMENT_COLORS[name] || "#A1A1AA",
  })).sort((a, b) => b.amount - a.amount);
}

// look-through: aggregate real exposure by underlying company (issuer, not
// literal instrument name). Uses normalizeIssuer(), declared further below
// in this file (hoisted — safe to call here) and shared with
// realDiversification()'s own same-issuer detection, which mirrors backend/
// src/services/lookthroughService.ts's normalizeIssuer(). Before this, the
// two engines disagreed: "HDFC Bank" (equity) and "HDFC Bank Bonds" (bond)
// showed as two unrelated companies at 50% each here, even though the
// backend's apparent-vs-real diversification number already caught the
// same-issuer overlap — this view told a different, less accurate story
// about the exact same holdings.
export function companyExposure(holdings, extra = null) {
  const map = {}; // normalized issuer -> { displayName, amount }
  // extra.name lets a caller (e.g. Ask DIVE's "Fit for you") attribute the
  // hypothetical amount to a real issuer instead of the generic "Others"
  // bucket used by category-level simulations (Suggestions' SimulateSheet),
  // so per-company concentration checks reflect the actual instrument.
  const list = extra && extra.amount > 0
    ? [...holdings, { amount: extra.amount, lookthrough: [{ company: extra.name || "Others (diversified)", pct: 100 }] }]
    : holdings;
  list.forEach((h) => {
    (h.lookthrough || []).forEach((lt) => {
      const val = h.amount * (lt.pct / 100);
      // A name that normalizes to nothing (rare — e.g. a company literally
      // named "Bank") falls back to its own raw name so it never accidentally
      // merges with an unrelated holding, matching the backend's guard
      // against empty-key matches in connectionBetween().
      const key = normalizeIssuer(lt.company) || lt.company.trim().toLowerCase();
      if (!map[key]) {
        map[key] = { displayName: lt.company, amount: 0 };
      } else if (lt.company.length < map[key].displayName.length) {
        // Prefer the shorter name as the display label for a merged group —
        // it's usually the bare issuer name ("HDFC Bank") rather than one
        // padded with an instrument-type suffix ("HDFC Bank Bonds").
        map[key].displayName = lt.company;
      }
      map[key].amount += val;
    });
  });
  const total = Object.values(map).reduce((s, v) => s + v.amount, 0);
  const sorted = Object.values(map)
    .map((v) => ({ name: v.displayName, amount: v.amount, pct: total ? (v.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const maxSlices = COMPANY_PALETTE.length;
  if (sorted.length <= maxSlices) {
    return sorted.map((c, i) => ({ ...c, color: COMPANY_PALETTE[i] }));
  }
  const head = sorted.slice(0, maxSlices - 1).map((c, i) => ({ ...c, color: COMPANY_PALETTE[i] }));
  const tail = sorted.slice(maxSlices - 1);
  head.push({
    name: `Others (${tail.length})`,
    amount: tail.reduce((s, c) => s + c.amount, 0),
    pct: tail.reduce((s, c) => s + c.pct, 0),
    color: OTHERS_COLOR,
  });
  return head;
}

export function topExposure(holdings, extra = null) {
  const c = companyExposure(holdings, extra);
  return c.length ? c[0] : { name: "-", pct: 0 };
}

// Herfindahl-based diversification score (0-100, higher = more diverse)
function hhiDiversity(items) {
  if (!items.length) return 0;
  const hhi = items.reduce((s, i) => s + Math.pow(i.pct / 100, 2), 0);
  return Math.max(0, Math.min(100, Math.round((1 - hhi) * 100)));
}

// Apparent diversification: how spread out the money LOOKS at the segment/
// asset-class level (Equity vs Mutual Funds vs Bonds vs Gold vs...).
export function apparentDiversification(holdings, extra = null) {
  return hhiDiversity(segmentBreakdown(holdings, extra));
}

// How well-spread individual holdings are by NAME, ignoring which segment
// they're in — e.g. 5 different stocks vs. 1 stock. This is a real signal
// (bad stock-picking within a class is worse than good stock-picking within
// the same class) but it is NOT the same thing as diversification across
// asset classes, and diveScore() below only lets it matter a little.
export function nameDiversification(holdings, extra = null) {
  return hhiDiversity(companyExposure(holdings, extra));
}

// Best-effort normalization to a rough "issuer" key by stripping common
// corporate/instrument-type suffixes — no canonical issuer/company registry
// backs this, so it will miss real overlaps with dissimilar names and can
// occasionally over-match. Good enough to catch the common, obvious case
// (e.g. "Reliance Industries" equity + a "Reliance Industries" bond) without
// needing real fund-composition look-through data, which this app doesn't have.
// Mirrors backend/src/services/lookthroughService.ts's normalizeIssuer() —
// keep these two in sync. The plural forms (bonds?, funds?, banks?, etc.)
// matter: a seeded instrument literally named "HDFC Bank Bonds" only strips
// to the same "hdfc" key as "HDFC Bank" once the trailing "s" is handled —
// singular-only suffixes silently miss exactly this common case.
export function normalizeIssuer(name) {
  return (name || "")
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|industries|industry|banks?|corp|corporate|corporation|bonds?|ncds?|debentures?|funds?|etfs?|schemes?|plans?|trusts?|reits?|invits?|fds?|deposits?|sgbs?|bees)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Real (look-through) diversification: the aim is to catch when a mutual
// fund/bond you hold is actually exposed to the SAME issuer you already hold
// directly via equity (or any other class) — i.e. hidden concentration across
// categories, not "how many different stock names you picked." Because
// look-through can only ever REVEAL additional hidden concentration, real
// diversification can never exceed apparent diversification — and if apparent
// is 0 (everything in one segment), real must be 0 too, no matter how well
// diversified the holdings are BY NAME within that one segment.
// Holdings whose (normalized) name repeats across more than one segment —
// e.g. "Reliance Industries" held directly via Equity AND via a "Reliance
// Industries Bonds" position in Bonds. This is the exact mechanism
// realDiversification() below penalizes; exposed separately (rather than
// just folded into that score) so a screen like X-Ray can name the specific
// overlapping holding instead of only showing the resulting number.
export function crossSegmentOverlaps(holdings, extra = null) {
  const list = extra && extra.amount > 0
    ? [...holdings, { amount: extra.amount, segment: extra.segment, name: extra.name || `Simulated ${extra.segment}` }]
    : holdings;
  const total = list.reduce((s, h) => s + h.amount, 0);
  if (!total) return [];

  const byIssuer = new Map(); // normalized name -> { displayName, value, segments: Set }
  list.forEach((h) => {
    const key = normalizeIssuer(h.name) || h.name;
    const entry = byIssuer.get(key) || { displayName: h.name, value: 0, segments: new Set() };
    if (h.name.length < entry.displayName.length) entry.displayName = h.name;
    entry.value += h.amount;
    entry.segments.add(h.segment);
    byIssuer.set(key, entry);
  });

  return Array.from(byIssuer.values())
    .filter((e) => e.segments.size > 1)
    .map((e) => ({ name: e.displayName, amount: e.value, pct: (e.value / total) * 100, segments: Array.from(e.segments).sort() }))
    .sort((a, b) => b.amount - a.amount);
}

export function realDiversification(holdings, extra = null) {
  const apparent = apparentDiversification(holdings, extra);
  if (apparent <= 0) return 0;

  const list = extra && extra.amount > 0
    ? [...holdings, { amount: extra.amount, segment: extra.segment, name: extra.name || `Simulated ${extra.segment}` }]
    : holdings;
  const total = list.reduce((s, h) => s + h.amount, 0);
  if (!total) return apparent;

  const overlapValue = crossSegmentOverlaps(holdings, extra).reduce((s, o) => s + o.amount, 0);
  const overlapShare = overlapValue / total;
  return Math.max(0, Math.min(apparent, Math.round(apparent * (1 - overlapShare))));
}

export function missingCategories(holdings, extra = null) {
  const present = new Set(holdings.map((h) => h.segment));
  if (extra && extra.amount > 0) present.add(extra.segment);
  return CORE_CATEGORIES.filter((c) => !present.has(c));
}

// DIVE Score — ONE calculator, used everywhere a score is shown from real (or
// simulated) holdings. Diversifying into NEW ASSET CLASSES is what actually
// moves this number: apparentDiversification (spread across segments) is the
// dominant term. realDiversification only pulls the score down further when a
// genuine cross-category issuer overlap is detected — it can't push the score
// up past what apparentDiversification already allows. Good stock-picking
// WITHIN a single class (nameDiversification) contributes only a small
// bonus — holding 9 well-chosen stocks and nothing else should score only a
// little higher than holding 1-2 bad ones, never anywhere near what genuine
// multi-asset-class diversification scores.
export function diveScore(holdings, extra = null) {
  const apparent = apparentDiversification(holdings, extra);
  const real = realDiversification(holdings, extra);
  const nameSpread = nameDiversification(holdings, extra);
  const score = apparent * 0.65 + real * 0.15 + nameSpread * 0.2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreColor(score) {
  if (score >= 75) return "#34D399";
  if (score >= 55) return "#E3B856";
  if (score >= 40) return "#FBBF24";
  return "#F87171";
}

export function scoreLabel(score) {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 50) return "Decent start";
  if (score >= 35) return "Needs work";
  return "Risky";
}

// IDEAL_RANGES above was authored per-category, independently, on the
// implicit assumption that a mature portfolio eventually spreads across
// most/all 9 CORE_CATEGORIES — summed across all 9, a risk profile's hi%
// values land around 147-153%, not 100%. That's fine for a user who's
// expected to hold most of them, but Layer D (the Context Engine, see
// backend/src/services/contextEngine.ts) deliberately tells an early-stage
// user they only need a SMALL SUBSET of categories right now (e.g. 3, for a
// "Growing" ₹25k-2L corpus) — and nobody rescales the bands to match that
// narrower promise. The result: maxing out every category Context Engine
// says you need can mathematically fall well short of 100% of the user's
// actual portfolio (e.g. a real report — ₹50,000 across Equity/Mutual
// Funds/Gold-Silver, Balanced profile — capped out at ₹38,500, 77%, even
// fully invested in all three), which contradicts the "these categories are
// genuinely all you need at this stage" message the app is otherwise
// making.
//
// This rescales ONLY the categories in `expectedCategories` (a Set of
// CORE_CATEGORIES labels — pass `expectedCoreCategories(context)` from
// contextMessaging.js) by a single multiplicative factor, so every other
// (non-expected/deferred) category keeps its original, unscaled band, since
// those aren't part of "your budget for now" and shouldn't be compressed to
// make room for categories the user isn't being actively asked to hold.
// Same factor is applied to lo and hi together, so each expected category's
// band keeps its original WIDTH relative to the others — only the overall
// scale shifts.
//
// The factor is derived from the sum of each expected category's own
// MIDPOINT (average of lo/hi), not its hi (ceiling) — scaling so the
// ceilings summed to 100% instead pins the band's own upper edge at exactly
// "fully invested," which mathematically forces at least one category's
// dot above its ceiling for any user who's actually fully invested across
// just their expected categories (the normal case), reading as
// perpetually "over-exposed" everywhere even when reasonably on track.
// Scaling on the midpoint sum instead means "fully invested, roughly
// on-target" lands near each category's own middle, leaving real headroom
// above it before a holding reads as genuinely over-exposed — while still
// guaranteeing that funding every expected category to its own ceiling
// covers the whole portfolio (ceilings necessarily land above their own
// midpoint, so their sum lands above 100%, not below it).
//
// Returns a full `ranges`-shaped table (keyed by the resolved risk profile)
// so the result can be passed straight into buildSuggestions() below
// unchanged — see its own `ranges[risk] || ranges["Balanced"]` fallback,
// which this mirrors so an unrecognized `risk` still resolves correctly.
export function rescaleIdealRanges(ranges, risk, expectedCategories) {
  const resolvedRisk = ranges[risk] ? risk : "Balanced";
  const ideal = ranges[resolvedRisk];
  if (!expectedCategories || expectedCategories.size === 0) {
    return { [resolvedRisk]: ideal };
  }
  const midSum = CORE_CATEGORIES.reduce((sum, cat) => {
    if (!expectedCategories.has(cat)) return sum;
    const [lo, hi] = ideal[cat] || [0, 0];
    return sum + (lo + hi) / 2;
  }, 0);
  if (!midSum) return { [resolvedRisk]: ideal };
  const factor = 100 / midSum;
  const scaled = {};
  CORE_CATEGORIES.forEach((cat) => {
    const [lo, hi] = ideal[cat] || [0, 0];
    scaled[cat] = expectedCategories.has(cat) ? [lo * factor, hi * factor] : [lo, hi];
  });
  return { [resolvedRisk]: scaled };
}

// Suggestions: category-level, quantified vs ideal range
export function buildSuggestions(holdings, ranges, risk) {
  const total = totalInvested(holdings);
  const segMap = {};
  holdings.forEach((h) => { segMap[h.segment] = (segMap[h.segment] || 0) + h.amount; });
  const ideal = ranges[risk] || ranges["Balanced"];
  const out = [];
  CORE_CATEGORIES.forEach((cat) => {
    const current = segMap[cat] || 0;
    const currentPct = total ? (current / total) * 100 : 0;
    const [loPct, hiPct] = ideal[cat] || [0, 0];
    const loAmt = (loPct / 100) * total;
    const hiAmt = (hiPct / 100) * total;
    let action = "hold";
    if (currentPct < loPct) action = "increase";
    else if (currentPct > hiPct) action = "reduce";
    const midGap = action === "increase" ? Math.round((loAmt + hiAmt) / 2 - current)
      : action === "reduce" ? Math.round(current - (loAmt + hiAmt) / 2) : 0;
    out.push({ cat, current, currentPct, loPct, hiPct, loAmt, hiAmt, action, gap: Math.max(0, midGap) });
  });
  // prioritise increase/reduce first, biggest gaps first
  return out.sort((a, b) => {
    const rank = (x) => (x.action === "hold" ? 2 : 0);
    return rank(a) - rank(b) || b.gap - a.gap;
  });
}

// Illustrative return-tier grouping used ONLY to re-rank/personalize the
// Suggestions list below — never fed into buildSuggestions(), diveScore(), or
// any score math. "High" return expectation nudges growth-oriented classes
// ahead of defensive ones (and vice-versa for "Modest"); it does not change
// what "on track"/"over its ideal band" means for any category.
export const RETURN_TIER = {
  FD: "low", Bonds: "low", Insurance: "low",
  "Gold/Silver": "medium", "REIT/InvIT": "medium", "Mutual Funds": "medium",
  Equity: "high", ETF: "high", Crypto: "high",
};
export const RETURN_TIER_SCORE = { low: -1, medium: 0, high: 1 };
export const RETURN_BIAS = { Modest: -1, Moderate: 0, High: 1 };

// How many genuinely-live "add to X" pushes stay active at once. This never
// removes a category from the list (only an explicit "excluded" pick does
// that, already handled by the caller) — categories beyond the cap just stop
// being an active ask and get a "we're not pushing this right now" note
// instead, same visual treatment as an already-deferred/on-track/over-exposed
// card. Preferred categories and non-"increase" categories are never capped.
export const DIVERSIFICATION_CAP = { Low: 2, Medium: 3, High: Infinity };

/**
 * Re-ranks and annotates buildSuggestions()'s output per the user's
 * Preferences — risk/return/diversification/preferred/excluded — WITHOUT
 * touching a single number buildSuggestions() computed (current/ideal/gap/
 * action all pass through untouched). This is a presentation-layer
 * personalization, not a second scoring model: it decides what order cards
 * appear in and which ones get a "not pushing this right now" note, nothing
 * about the DIVE Score or diversification percentages themselves.
 *
 * `suggestions` must already have `.deferred` attached by the caller (Layer D
 * context awareness lives in contextMessaging.js, which this file can't
 * import without a circular dependency).
 */
export function personalizeSuggestions(suggestions, prefs) {
  const preferredSet = new Set(prefs?.preferred || []);
  const returnBias = RETURN_BIAS[prefs?.returnExpectation] ?? 0;

  const enriched = suggestions.map((s) => ({ ...s, prioritized: preferredSet.has(s.cat) }));

  enriched.sort((a, b) => {
    // An explicit preference always wins, regardless of the category's own
    // status — even "on track" or "over its ideal band" gets pulled to the
    // top if the user said they want to see it.
    if (a.prioritized !== b.prioritized) return a.prioritized ? -1 : 1;
    const rank = (x) => (x.action === "hold" ? 2 : 0);
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (returnBias !== 0) {
      const tierDiff = (RETURN_TIER_SCORE[RETURN_TIER[b.cat]] - RETURN_TIER_SCORE[RETURN_TIER[a.cat]]) * returnBias;
      if (tierDiff !== 0) return tierDiff;
    }
    return b.gap - a.gap;
  });

  const cap = DIVERSIFICATION_CAP[prefs?.diversificationPriority] ?? Infinity;
  let liveCount = 0;
  return enriched.map((s) => {
    const isLivePush = s.action === "increase" && !s.deferred && !s.prioritized;
    if (!isLivePush) return { ...s, diversificationCapped: false };
    liveCount += 1;
    return { ...s, diversificationCapped: liveCount > cap };
  });
}
