import {
  adaptHolding,
  segmentBreakdown,
  apparentDiversification,
  realDiversification,
  crossSegmentOverlaps,
  diveScore,
  normalizeIssuer,
  missingCategories,
  buildSuggestions,
  rescaleIdealRanges,
  totalInvested,
  IDEAL_RANGES,
  CORE_CATEGORIES,
  SEGMENT_COLORS,
  ASSET_CLASS_LABELS,
} from "./diveEngine";

describe("adaptHolding", () => {
  it("maps a backend assetClass to its human-readable segment label", () => {
    const h = adaptHolding({ _id: "1", name: "Reliance", assetClass: "EQUITY", currentValue: 1000, investedValue: 900 });
    expect(h.segment).toBe("Equity");
  });

  it("collapses REIT and INVIT into the same segment label", () => {
    expect(adaptHolding({ assetClass: "REIT", currentValue: 100 }).segment).toBe("REIT/InvIT");
    expect(adaptHolding({ assetClass: "INVIT", currentValue: 100 }).segment).toBe("REIT/InvIT");
  });

  it("falls back to investedValue when currentValue is missing, then to 0", () => {
    expect(adaptHolding({ assetClass: "EQUITY", investedValue: 500 }).amount).toBe(500);
    expect(adaptHolding({ assetClass: "EQUITY" }).amount).toBe(0);
  });

  it("uses the mongo _id when present, falling back to id", () => {
    expect(adaptHolding({ _id: "abc", assetClass: "EQUITY" }).id).toBe("abc");
    expect(adaptHolding({ id: "xyz", assetClass: "EQUITY" }).id).toBe("xyz");
  });

  it("carries raw fields through for the edit-holding flow, alongside the derived ones", () => {
    const h = adaptHolding({
      _id: "1", name: "Reliance", assetClass: "EQUITY", instrumentId: "instr-1",
      investedValue: 900, currentValue: 1000, quantity: 10, purchaseDate: "2026-01-01",
      extraFields: { note: "x" },
    });
    expect(h.assetClass).toBe("EQUITY");
    expect(h.instrumentId).toBe("instr-1");
    expect(h.investedValue).toBe(900);
    expect(h.currentValue).toBe(1000);
    expect(h.quantity).toBe(10);
    expect(h.extraFields).toEqual({ note: "x" });
  });
});

describe("segmentBreakdown", () => {
  it("aggregates holdings by segment and computes percentages that sum to 100", () => {
    const holdings = [
      { segment: "Equity", amount: 600 },
      { segment: "Equity", amount: 400 },
      { segment: "Bonds", amount: 1000 },
    ];
    const result = segmentBreakdown(holdings);
    const equity = result.find((r) => r.name === "Equity");
    const bonds = result.find((r) => r.name === "Bonds");
    expect(equity.amount).toBe(1000);
    expect(bonds.amount).toBe(1000);
    expect(equity.pct).toBeCloseTo(50);
    expect(bonds.pct).toBeCloseTo(50);
  });

  it("returns an empty array for no holdings, not a divide-by-zero NaN", () => {
    expect(segmentBreakdown([])).toEqual([]);
  });

  it("sorts largest segment first", () => {
    const result = segmentBreakdown([
      { segment: "Bonds", amount: 100 },
      { segment: "Equity", amount: 900 },
    ]);
    expect(result[0].name).toBe("Equity");
  });
});

describe("normalizeIssuer", () => {
  it("strips common corporate/instrument-type suffixes so overlapping issuers match", () => {
    // The exact case documented in the source comment: an equity holding and
    // a bond holding in the same real-world issuer must resolve to the same
    // key for realDiversification()'s cross-category overlap detection to work.
    expect(normalizeIssuer("HDFC Bank")).toBe(normalizeIssuer("HDFC Bank Bonds"));
    expect(normalizeIssuer("Reliance Industries")).toBe(normalizeIssuer("Reliance Industries Limited"));
  });

  it("does not merge genuinely different issuers", () => {
    expect(normalizeIssuer("HDFC Bank")).not.toBe(normalizeIssuer("ICICI Bank"));
  });

  // User bug report: added "Reliance Industries" (equity) and its corporate
  // bond, saw no overlap anywhere on X-Ray. Root cause: "corp"/"corporation"
  // were stripped but not "corporate" as its own whole word (\bcorp\b doesn't
  // match inside "corporate") — so the exact real seeded bond name
  // (backend/src/seed/staticInstruments.ts's REL_BOND) normalized to
  // "reliancecorporate" instead of "reliance", missing a real-world instrument
  // name this function exists specifically to catch.
  it("strips 'Corporate' so a real corporate bond's full name still matches its equity counterpart", () => {
    expect(normalizeIssuer("Reliance Industries")).toBe(normalizeIssuer("Reliance Industries Corporate Bonds"));
  });
});

describe("apparentDiversification / realDiversification / diveScore", () => {
  it("scores 0 apparent diversification for a single-segment portfolio", () => {
    const holdings = [{ segment: "Equity", amount: 1000, name: "Reliance", lookthrough: [{ company: "Reliance", pct: 100 }] }];
    expect(apparentDiversification(holdings)).toBe(0);
  });

  it("scores higher apparent diversification the more evenly spread across segments", () => {
    const concentrated = [{ segment: "Equity", amount: 1000, name: "A", lookthrough: [{ company: "A", pct: 100 }] }];
    const spread = [
      { segment: "Equity", amount: 500, name: "A", lookthrough: [{ company: "A", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "B", lookthrough: [{ company: "B", pct: 100 }] },
    ];
    expect(apparentDiversification(spread)).toBeGreaterThan(apparentDiversification(concentrated));
  });

  it("real diversification can never exceed apparent diversification", () => {
    const holdings = [
      { segment: "Equity", amount: 500, name: "HDFC Bank", lookthrough: [{ company: "HDFC Bank", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "HDFC Bank Bonds", lookthrough: [{ company: "HDFC Bank Bonds", pct: 100 }] },
    ];
    expect(realDiversification(holdings)).toBeLessThanOrEqual(apparentDiversification(holdings));
  });

  it("real diversification drops below apparent when the same issuer recurs across segments", () => {
    const sameIssuer = [
      { segment: "Equity", amount: 500, name: "HDFC Bank", lookthrough: [{ company: "HDFC Bank", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "HDFC Bank Bonds", lookthrough: [{ company: "HDFC Bank Bonds", pct: 100 }] },
    ];
    const differentIssuers = [
      { segment: "Equity", amount: 500, name: "HDFC Bank", lookthrough: [{ company: "HDFC Bank", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "Government Bond", lookthrough: [{ company: "Government Bond", pct: 100 }] },
    ];
    expect(realDiversification(sameIssuer)).toBeLessThan(realDiversification(differentIssuers));
  });

  it("crossSegmentOverlaps names the specific issuer recurring across segments, not just a number", () => {
    const sameIssuer = [
      { segment: "Equity", amount: 500, name: "HDFC Bank", lookthrough: [{ company: "HDFC Bank", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "HDFC Bank Bonds", lookthrough: [{ company: "HDFC Bank Bonds", pct: 100 }] },
      { segment: "Gold", amount: 200, name: "Digital Gold", lookthrough: [{ company: "Digital Gold", pct: 100 }] },
    ];
    const overlaps = crossSegmentOverlaps(sameIssuer);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].name).toBe("HDFC Bank"); // shorter display name preferred over the "...Bonds" variant
    expect(overlaps[0].segments).toEqual(["Bonds", "Equity"]);
    expect(overlaps[0].amount).toBe(1000);
  });

  it("crossSegmentOverlaps returns nothing when no issuer repeats across segments", () => {
    const differentIssuers = [
      { segment: "Equity", amount: 500, name: "HDFC Bank", lookthrough: [{ company: "HDFC Bank", pct: 100 }] },
      { segment: "Bonds", amount: 500, name: "Government Bond", lookthrough: [{ company: "Government Bond", pct: 100 }] },
    ];
    expect(crossSegmentOverlaps(differentIssuers)).toEqual([]);
  });

  it("if apparent diversification is 0, real diversification must also be 0", () => {
    const holdings = [{ segment: "Equity", amount: 1000, name: "A", lookthrough: [{ company: "A", pct: 100 }] }];
    expect(apparentDiversification(holdings)).toBe(0);
    expect(realDiversification(holdings)).toBe(0);
  });

  it("diveScore stays within 0-100 for both concentrated and diversified portfolios", () => {
    const concentrated = [{ segment: "Equity", amount: 1000, name: "A", lookthrough: [{ company: "A", pct: 100 }] }];
    const diversified = [
      { segment: "Equity", amount: 300, name: "A", lookthrough: [{ company: "A", pct: 100 }] },
      { segment: "Bonds", amount: 300, name: "B", lookthrough: [{ company: "B", pct: 100 }] },
      { segment: "Gold/Silver", amount: 200, name: "C", lookthrough: [{ company: "C", pct: 100 }] },
      { segment: "FD/RD", amount: 200, name: "D", lookthrough: [{ company: "D", pct: 100 }] },
    ];
    for (const h of [concentrated, diversified]) {
      const score = diveScore(h);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(diveScore(diversified)).toBeGreaterThan(diveScore(concentrated));
  });
});

describe("totalInvested", () => {
  it("sums the amount field across holdings", () => {
    expect(totalInvested([{ amount: 100 }, { amount: 250 }])).toBe(350);
  });
});

// PF (Provident Fund — PPF/EPF/VPF) is the newest CORE_CATEGORIES entry.
// diveEngine.js is the single collapse-point between the backend's 12-way
// assetClass enum and every downstream consumer (Suggestions, Planner,
// Preferences, X-Ray) — a missing PF row in any of these tables degrades
// silently rather than crashing (e.g. buildSuggestions falls back to an
// [0,0] ideal band, SEGMENT_COLORS falls back to gray), so these are worth
// asserting directly rather than trusting downstream screens to catch it.
describe("PF (Provident Fund) — diveEngine.js wiring", () => {
  it("is a CORE_CATEGORIES entry mapped from the backend's PF enum value", () => {
    expect(CORE_CATEGORIES).toContain("PF");
    expect(ASSET_CLASS_LABELS.PF).toBe("PF");
  });

  it("has its own real IDEAL_RANGES band in every risk profile, not the [0,0] fallback", () => {
    ["Conservative", "Balanced", "Aggressive"].forEach((risk) => {
      const [lo, hi] = IDEAL_RANGES[risk].PF;
      expect(hi).toBeGreaterThan(lo);
      expect(lo).toBeGreaterThan(0);
    });
    // FD/RD-shaped (declining with risk appetite), pulled below FD/RD's own
    // ceiling at every step — see diveEngine.js's own IDEAL_RANGES comment
    // for why (PPF/EPF have hard practical contribution ceilings FD/RD doesn't).
    expect(IDEAL_RANGES.Conservative.PF[1]).toBeLessThan(IDEAL_RANGES.Conservative["FD/RD"][1]);
    expect(IDEAL_RANGES.Balanced.PF[1]).toBeLessThan(IDEAL_RANGES.Balanced["FD/RD"][1]);
    expect(IDEAL_RANGES.Aggressive.PF[1]).toBeLessThan(IDEAL_RANGES.Aggressive["FD/RD"][1]);
  });

  it("has a distinct SEGMENT_COLORS hex, not the generic gray fallback", () => {
    expect(SEGMENT_COLORS.PF).toBeTruthy();
    expect(SEGMENT_COLORS.PF).not.toBe("#A1A1AA");
    expect(Object.values(SEGMENT_COLORS).filter((c) => c === SEGMENT_COLORS.PF)).toHaveLength(1); // no collision with an existing hue
  });

  it("participates in the diversification score like any other segment — no special-casing needed", () => {
    const holdings = [{ segment: "PF", amount: 1000 }];
    // diveScore() is fully generic over segment strings (HHI-based) — a
    // single-category portfolio should score low regardless of which
    // category it is, confirming PF isn't silently excluded from the calc.
    expect(diveScore(holdings)).toBeLessThan(50);
  });

  it("reads as an 'increase' suggestion when absent, using its own real ideal band (not [0,0])", () => {
    const holdings = [{ segment: "Equity", amount: 100000 }]; // no PF holding at all
    const suggestions = buildSuggestions(holdings, IDEAL_RANGES, "Balanced");
    const pf = suggestions.find((s) => s.cat === "PF");
    expect(pf.action).toBe("increase");
    expect(pf.hiAmt).toBeGreaterThan(0); // would be 0 if IDEAL_RANGES.Balanced.PF were missing
  });
});

describe("missingCategories", () => {
  it("lists every CORE_CATEGORY not present in the holdings", () => {
    const holdings = [{ segment: "Equity" }, { segment: "Bonds" }];
    const missing = missingCategories(holdings);
    expect(missing).toContain("Crypto");
    expect(missing).not.toContain("Equity");
    expect(missing).not.toContain("Bonds");
  });
});

describe("buildSuggestions", () => {
  it("flags a category as 'increase' when it's under its ideal range, 'reduce' when over", () => {
    const holdings = [{ segment: "Crypto", amount: 1000 }]; // 100% crypto — way over any ideal range
    const suggestions = buildSuggestions(holdings, IDEAL_RANGES, "Balanced");
    const crypto = suggestions.find((s) => s.cat === "Crypto");
    const equity = suggestions.find((s) => s.cat === "Equity");
    expect(crypto.action).toBe("reduce");
    expect(equity.action).toBe("increase");
  });

  it("falls back to the Balanced ideal range for an unrecognized risk profile", () => {
    const holdings = [{ segment: "Equity", amount: 1000 }];
    const suggestions = buildSuggestions(holdings, IDEAL_RANGES, "NotARealProfile");
    expect(suggestions.length).toBeGreaterThan(0);
  });
});

// Regression test for a real user report: a ₹50,000 Balanced-profile
// portfolio (2 Equity holdings + 1 Mutual Fund), restricted by the Context
// Engine to 3 expected categories (Equity/Mutual Funds/Gold-Silver), showed
// ideal ceilings of ₹17,500 + ₹15,000 + ₹6,000 = ₹38,500 — only 77% of the
// portfolio, even maxing out every category the user was told they need.
describe("rescaleIdealRanges", () => {
  it("scales the expected categories' MIDPOINT (not hi/ceiling) to sum to 100%, preserving each band's relative width", () => {
    const expected = new Set(["Equity", "Mutual Funds", "Gold/Silver"]);
    const { Balanced } = rescaleIdealRanges(IDEAL_RANGES, "Balanced", expected);

    const midpoint = ([lo, hi]) => (lo + hi) / 2;
    const midSum = midpoint(Balanced["Equity"]) + midpoint(Balanced["Mutual Funds"]) + midpoint(Balanced["Gold/Silver"]);
    expect(midSum).toBeCloseTo(100, 6);

    // Original bands: Equity [25,35] mid 30, Mutual Funds [20,30] mid 25,
    // Gold/Silver [8,12] mid 10 (midpoint sum 65) — scaled by 100/65, so a
    // user fully invested across exactly these 3 categories lands near each
    // one's own midpoint on average, not pinned against every ceiling.
    expect(Balanced["Equity"]).toEqual([25 * (100 / 65), 35 * (100 / 65)]);
    expect(Balanced["Mutual Funds"]).toEqual([20 * (100 / 65), 30 * (100 / 65)]);
    expect(Balanced["Gold/Silver"]).toEqual([8 * (100 / 65), 12 * (100 / 65)]);
  });

  it("leaves non-expected (deferred) categories at their original, unscaled band", () => {
    const expected = new Set(["Equity"]);
    const { Balanced } = rescaleIdealRanges(IDEAL_RANGES, "Balanced", expected);
    expect(Balanced["Bonds"]).toEqual(IDEAL_RANGES.Balanced["Bonds"]);
    expect(Balanced["Crypto"]).toEqual(IDEAL_RANGES.Balanced["Crypto"]);
  });

  it("returns the original unscaled band when there are no expected categories yet (context not loaded)", () => {
    const result = rescaleIdealRanges(IDEAL_RANGES, "Balanced", new Set());
    expect(result.Balanced).toEqual(IDEAL_RANGES.Balanced);
    const resultUndefined = rescaleIdealRanges(IDEAL_RANGES, "Balanced", undefined);
    expect(resultUndefined.Balanced).toEqual(IDEAL_RANGES.Balanced);
  });

  it("falls back to Balanced for an unrecognized risk profile, same as buildSuggestions", () => {
    const result = rescaleIdealRanges(IDEAL_RANGES, "NotARealProfile", new Set(["Equity"]));
    expect(result.Balanced).toBeDefined();
    const [lo, hi] = result.Balanced["Equity"];
    expect((lo + hi) / 2).toBeCloseTo(100, 6);
  });

  it("end-to-end: a fully-invested user lands with real headroom below each category's ceiling, not pinned above it", () => {
    // The exact reported scenario: ₹50,000 total, 3 expected categories,
    // Equity/Mutual Funds already funded, Gold/Silver still at zero.
    const expected = new Set(["Equity", "Mutual Funds", "Gold/Silver"]);
    const scaledRanges = rescaleIdealRanges(IDEAL_RANGES, "Balanced", expected);
    const holdings = [
      { segment: "Equity", amount: 30000 },
      { segment: "Mutual Funds", amount: 20000 },
    ];
    const suggestions = buildSuggestions(holdings, scaledRanges, "Balanced");
    const [equity, mf, gold] = ["Equity", "Mutual Funds", "Gold/Silver"].map((cat) => suggestions.find((s) => s.cat === cat));

    // Midpoint amounts (the new "fully invested, on-target" anchor) sum to
    // the full portfolio total.
    const midAmt = (s) => (s.loAmt + s.hiAmt) / 2;
    expect(midAmt(equity) + midAmt(mf) + midAmt(gold)).toBeCloseTo(50000, 6);

    // Ceilings now sum to MORE than the total (real headroom), unlike the
    // old hi-sum-to-100% version where they summed to exactly the total and
    // Mutual Funds (₹20,000, 40%) read as "over" a ceiling of just ₹19,481.
    expect(equity.hiAmt + mf.hiAmt + gold.hiAmt).toBeGreaterThan(50000);
    expect(mf.action).not.toBe("reduce");
  });
});
