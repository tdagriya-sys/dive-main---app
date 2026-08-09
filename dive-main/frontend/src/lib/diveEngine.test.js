import {
  adaptHolding,
  segmentBreakdown,
  apparentDiversification,
  realDiversification,
  diveScore,
  normalizeIssuer,
  missingCategories,
  buildSuggestions,
  totalInvested,
  IDEAL_RANGES,
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
      { segment: "FD", amount: 200, name: "D", lookthrough: [{ company: "D", pct: 100 }] },
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
