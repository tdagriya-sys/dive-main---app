import { fetchInstrumentDetail } from "../src/services/instrumentDetailService";

// fetchInstrumentDetail's live-source calls (Yahoo/CoinGecko/MFAPI) are
// skipped in the test environment (env.nodeEnv === "test", same policy as
// priceHistoryService.ts) so this suite never makes a real network call.
// That leaves exactly the admin-provided fallback exercisable here — which is
// the whole point: a manually-uploaded instrument's symbol is ALWAYS
// namespaced (UPLOAD_...), so in production this fallback is what actually
// fires for every ADMIN_UPLOAD instrument, on every asset class, since none
// of Yahoo/MFAPI/CoinGecko can ever resolve that namespaced symbol.

describe("fetchInstrumentDetail — admin-provided fallback for manually-uploaded instruments", () => {
  it("returns available:false with the asset-class-specific reason for a non-ADMIN_UPLOAD instrument (unchanged behavior)", async () => {
    const detail = await fetchInstrumentDetail({ assetClass: "BOND", symbol: "SOME_LIVE_SYMBOL", source: "SEED" });
    expect(detail).toEqual({ available: false, reason: "Live data is disabled in the test environment." });
  });

  it("returns available:false when an ADMIN_UPLOAD instrument has no usable metadata at all (name-only upload)", async () => {
    const detail = await fetchInstrumentDetail({ assetClass: "BOND", symbol: "UPLOAD_BARE", source: "ADMIN_UPLOAD", metadata: {} });
    expect(detail.available).toBe(false);
  });

  it("surfaces uploaded Bond fields (annual return, credit rating, maturity date), clearly labeled as admin-provided", async () => {
    const detail = await fetchInstrumentDetail({
      assetClass: "BOND",
      symbol: "UPLOAD_INE906B07EJ2",
      source: "ADMIN_UPLOAD",
      metadata: { annualReturnPct: 7.2, creditRating: "AAA", maturityDate: "2031-03-15", priceAsOf: "2026-09-15" },
    });
    expect(detail.available).toBe(true);
    expect(detail.sourceKind).toBe("admin");
    expect(detail.source).toMatch(/admin/i);
    expect(detail.asOf).toBe("2026-09-15");
    expect(detail.fields).toEqual({
      uploadedAnnualReturnPct: 7.2,
      uploadedCreditRating: "AAA",
      uploadedMaturityDate: "2031-03-15",
      uploadedPriceAsOf: "2026-09-15",
    });
  });

  it("surfaces uploaded Mutual Fund price/sector AND underlying holdings, dropping a holding with no parseable weight from the numeric field but keeping named holdings as a separate list", async () => {
    const detail = await fetchInstrumentDetail({
      assetClass: "MUTUAL_FUND",
      symbol: "UPLOAD_ZEN99001",
      source: "ADMIN_UPLOAD",
      metadata: {
        price: 112.75,
        sector: "Flexi Cap",
        expenseRatioPct: 1.2,
        underlyingHoldings: [
          { name: "Reliance Industries", weightPct: 8.5 },
          { name: "HDFC Bank", weightPct: 6.2 },
          { name: "No Weight Co" },
        ],
      },
    });
    expect(detail.available).toBe(true);
    expect(detail.fields).toMatchObject({ uploadedPrice: 112.75, uploadedSector: "Flexi Cap", uploadedExpenseRatioPct: 1.2 });
    expect(detail.holdings).toEqual([
      { name: "Reliance Industries", weightPct: 8.5 },
      { name: "HDFC Bank", weightPct: 6.2 },
      { name: "No Weight Co", weightPct: null },
    ]);
  });

  it("falls back to the upload timestamp for 'as of' when no priceAsOf was provided, truncated to just the date (not a raw timestamp)", async () => {
    const uploadedAt = new Date("2026-09-20T10:00:00.000Z");
    const detail = await fetchInstrumentDetail({
      assetClass: "REIT",
      symbol: "UPLOAD_EMBASSY",
      source: "ADMIN_UPLOAD",
      metadata: { sector: "Commercial Real Estate", uploadedAt },
    });
    expect(detail.available).toBe(true);
    expect(detail.asOf).toBe("2026-09-20");
  });

  it("never returns holdings for an asset class whose metadata has no underlyingHoldings", async () => {
    const detail = await fetchInstrumentDetail({
      assetClass: "ULIP_INSURANCE",
      symbol: "UPLOAD_PLAN1",
      source: "ADMIN_UPLOAD",
      metadata: { annualReturnPct: 9.8, category: "Wealth ULIP" },
    });
    expect(detail.available).toBe(true);
    expect(detail.holdings).toBeUndefined();
    expect(detail.fields).toEqual({ uploadedAnnualReturnPct: 9.8, uploadedCategory: "Wealth ULIP" });
  });
});
