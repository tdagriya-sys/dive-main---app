// Ported subset of frontend/src/lib/diveEngine.js's pure diversification/
// score math — copied, not imported, because this extension is a separate
// build/runtime target (a browser extension can't bundle from frontend/src).
// This file must NOT be treated as the source of truth for the formulas: if
// frontend/src/lib/diveEngine.js's apparentDiversification/realDiversification/
// diveScore/normalizeIssuer ever change, mirror the change here too, same as
// that file's own header already asks for lookthroughService.ts. Only the
// functions this extension actually needs are ported (no buildSuggestions/
// personalizeSuggestions/company palette — those are UI-list concerns the
// extension doesn't have).
//
// No chrome.* or DOM APIs in this file — pure functions only, so it's usable
// from the background service worker, the content script, and (if ever
// needed) the popup alike.

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
  FD: "FD/RD",
  PF: "PF",
  CRYPTO: "Crypto",
};

// Same illustrative ideal-allocation bands as diveEngine.js's IDEAL_RANGES —
// used only to decide "is this asset class already over its ideal band for
// this user's risk profile", not to render a Suggestions-style list.
export const IDEAL_RANGES = {
  Conservative: {
    Equity: [20, 30], "Mutual Funds": [15, 25], Bonds: [20, 30],
    "Gold/Silver": [8, 12], "REIT/InvIT": [5, 10], "FD/RD": [10, 20], PF: [10, 18],
    ETF: [3, 8], Insurance: [5, 10], Crypto: [0, 2],
  },
  Balanced: {
    Equity: [25, 35], "Mutual Funds": [20, 30], Bonds: [15, 25],
    "Gold/Silver": [8, 12], "REIT/InvIT": [8, 12], "FD/RD": [8, 15], PF: [8, 14],
    ETF: [5, 10], Insurance: [3, 7], Crypto: [0, 5],
  },
  Aggressive: {
    Equity: [35, 50], "Mutual Funds": [20, 30], Bonds: [5, 15],
    "Gold/Silver": [5, 10], "REIT/InvIT": [8, 15], "FD/RD": [3, 8], PF: [3, 6],
    ETF: [5, 12], Insurance: [2, 5], Crypto: [2, 8],
  },
};

// Converts a raw backend Holding document (GET /api/holdings response item)
// into the shape this engine expects. Mirrors diveEngine.js's adaptHolding —
// look-through defaults to 100% into the holding's own name (this extension
// has no access to a fund's underlying-stock disclosure either).
export function adaptHolding(h) {
  return {
    id: h._id || h.id,
    name: h.name,
    segment: ASSET_CLASS_LABELS[h.assetClass] || h.assetClass,
    amount: h.currentValue ?? h.investedValue ?? 0,
    assetClass: h.assetClass,
    lookthrough: [{ company: h.name, pct: 100 }],
  };
}

export function totalInvested(holdings) {
  return holdings.reduce((s, h) => s + h.amount, 0);
}

export function segmentBreakdown(holdings, extra = null) {
  const map = {};
  holdings.forEach((h) => {
    map[h.segment] = (map[h.segment] || 0) + h.amount;
  });
  if (extra && extra.amount > 0) map[extra.segment] = (map[extra.segment] || 0) + extra.amount;
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map).map(([name, amount]) => ({
    name, amount, pct: total ? (amount / total) * 100 : 0,
  })).sort((a, b) => b.amount - a.amount);
}

export function normalizeIssuer(name) {
  return (name || "")
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|industries|industry|banks?|corp|corporation|bonds?|ncds?|funds?|etfs?|schemes?|plans?|trusts?|reits?|invits?|fds?|deposits?|sgbs?|bees)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function companyExposure(holdings, extra = null) {
  const map = {};
  const list = extra && extra.amount > 0
    ? [...holdings, { amount: extra.amount, lookthrough: [{ company: extra.name || "Others (diversified)", pct: 100 }] }]
    : holdings;
  list.forEach((h) => {
    (h.lookthrough || []).forEach((lt) => {
      const val = h.amount * (lt.pct / 100);
      const key = normalizeIssuer(lt.company) || lt.company.trim().toLowerCase();
      if (!map[key]) {
        map[key] = { displayName: lt.company, amount: 0 };
      } else if (lt.company.length < map[key].displayName.length) {
        map[key].displayName = lt.company;
      }
      map[key].amount += val;
    });
  });
  const total = Object.values(map).reduce((s, v) => s + v.amount, 0);
  return Object.values(map)
    .map((v) => ({ name: v.displayName, amount: v.amount, pct: total ? (v.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function topExposure(holdings, extra = null) {
  const c = companyExposure(holdings, extra);
  return c.length ? c[0] : { name: "-", pct: 0 };
}

function hhiDiversity(items) {
  if (!items.length) return 0;
  const hhi = items.reduce((s, i) => s + Math.pow(i.pct / 100, 2), 0);
  return Math.max(0, Math.min(100, Math.round((1 - hhi) * 100)));
}

export function apparentDiversification(holdings, extra = null) {
  return hhiDiversity(segmentBreakdown(holdings, extra));
}

export function nameDiversification(holdings, extra = null) {
  return hhiDiversity(companyExposure(holdings, extra));
}

export function crossSegmentOverlaps(holdings, extra = null) {
  const list = extra && extra.amount > 0
    ? [...holdings, { amount: extra.amount, segment: extra.segment, name: extra.name || `Simulated ${extra.segment}` }]
    : holdings;
  const total = list.reduce((s, h) => s + h.amount, 0);
  if (!total) return [];

  const byIssuer = new Map();
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

// Fast, concentration-only DIVE Score — used only for its DELTA (before vs.
// after adding a hypothetical holding), never shown as an absolute value in
// place of the real composite score. Same weighting as diveEngine.js's
// diveScore().
export function diveScore(holdings, extra = null) {
  const apparent = apparentDiversification(holdings, extra);
  const real = realDiversification(holdings, extra);
  const nameSpread = nameDiversification(holdings, extra);
  const score = apparent * 0.65 + real * 0.15 + nameSpread * 0.2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export const fmtINR = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
