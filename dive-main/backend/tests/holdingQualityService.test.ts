import { computeHoldingQuality } from "../src/services/holdingQualityService";

// A manually-uploaded Mutual Fund's symbol is always namespaced (UPLOAD_...),
// so it can never resolve against MFAPI's live schemeCategory — for most
// bulk-uploaded funds, the CSV's Category column (instrumentUploadService.ts)
// is the ONLY classification data available at all. This suite covers the
// fallback chain: live schemeCategory > curated Sector > uploaded Category >
// generic "not available".

describe("computeHoldingQuality — MUTUAL_FUND fallback chain", () => {
  it("uses the uploaded Category, classified via the same rules as a live AMFI category, when neither live data nor a curated sector tag exists", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", { category: "Equity Scheme - Sectoral/ Thematic" });
    expect(q.tier).toBe("caution"); // classifyMfCategory: sectoral/thematic => caution
    expect(q.label).toBe("Equity Scheme - Sectoral/ Thematic");
    expect(q.detail).toContain("Classified by AMFI as a Equity Scheme - Sectoral/ Thematic scheme");
    expect(q.detail).toContain("concentration risk");
  });

  it("classifies an uploaded Debt category as a 'good' tier, same as a live one would be", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", { category: "Debt Scheme - Corporate Bond Fund" });
    expect(q.tier).toBe("good");
  });

  it("classifies an uploaded plain Equity category as 'neutral'", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", { category: "Equity Scheme - Flexi Cap Fund" });
    expect(q.tier).toBe("neutral");
  });

  it("a curated Sector tag still takes priority over an uploaded Category when both are present", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", { sector: "Banking", category: "Equity Scheme - Sectoral/ Thematic" });
    expect(q.label).toBe("Banking sector fund");
  });

  it("a live schemeCategory still takes priority over both Sector and uploaded Category", () => {
    const q = computeHoldingQuality(
      "MUTUAL_FUND",
      { sector: "Banking", category: "Debt Scheme - Liquid Fund" },
      { schemeCategory: "Equity Scheme - Large Cap Fund" }
    );
    expect(q.label).toBe("Equity Scheme - Large Cap Fund");
  });

  it("falls back to the generic 'not available' message when there's no live data, no sector, and no category at all", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", {});
    expect(q.label).toBe("Ratings not freely available");
    expect(q.tier).toBe("unknown");
  });

  it("ignores a non-string category value rather than crashing or mislabeling", () => {
    const q = computeHoldingQuality("MUTUAL_FUND", { category: 12345 as unknown as string });
    expect(q.label).toBe("Ratings not freely available");
  });
});
