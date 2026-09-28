import { resolveHoldingLatestPrice } from "../src/services/priceHistoryService";

// resolveHoldingLatestPrice's live-source calls (Yahoo/MFAPI/CoinGecko) are
// skipped in the test environment (env.nodeEnv === "test", same policy as
// instrumentDetailService.ts) so this suite never makes a real network call.
// That leaves exactly the admin-provided fallback exercisable here — which is
// the whole point: a manually-uploaded instrument's symbol is ALWAYS
// namespaced (UPLOAD_...), so in production no live source can ever resolve
// it, on any asset class — this fallback is what actually determines whether
// quantity auto-calculates on add, and whether the daily revaluation job can
// ever reprice such a holding at all.

describe("resolveHoldingLatestPrice — admin-provided fallback for manually-uploaded instruments", () => {
  it("returns null for a non-ADMIN_UPLOAD instrument with no live source resolvable (unchanged behavior)", async () => {
    const price = await resolveHoldingLatestPrice({ assetClass: "MUTUAL_FUND", symbol: "SOME_SYMBOL", source: "SEED", metadata: { price: 999 } });
    // A SEED/AMFI-sourced row's own metadata.price is deliberately NOT used
    // as a fallback — the admin-provided fallback exists only for rows an
    // admin actually typed a price into via the upload feature, never for a
    // live/seed source that simply failed to resolve today.
    expect(price).toBeNull();
  });

  it("returns null for an ADMIN_UPLOAD instrument with no price in its metadata at all (name-only upload)", async () => {
    const price = await resolveHoldingLatestPrice({ assetClass: "BOND", symbol: "UPLOAD_BARE", source: "ADMIN_UPLOAD", metadata: {} });
    expect(price).toBeNull();
  });

  it("falls back to the uploaded price for an ADMIN_UPLOAD Mutual Fund", async () => {
    const price = await resolveHoldingLatestPrice({ assetClass: "MUTUAL_FUND", symbol: "UPLOAD_ZEN99001", source: "ADMIN_UPLOAD", metadata: { price: 112.75 } });
    expect(price).toBe(112.75);
  });

  it("falls back to the uploaded price for an ADMIN_UPLOAD Bond, REIT, or any other asset class — the fallback isn't asset-class-specific", async () => {
    const bond = await resolveHoldingLatestPrice({ assetClass: "BOND", symbol: "UPLOAD_ZENBOND01", source: "ADMIN_UPLOAD", metadata: { price: 1050 } });
    const reit = await resolveHoldingLatestPrice({ assetClass: "REIT", symbol: "UPLOAD_EMBASSY", source: "ADMIN_UPLOAD", metadata: { price: 340.5 } });
    expect(bond).toBe(1050);
    expect(reit).toBe(340.5);
  });

  it("ignores a non-numeric price value rather than returning garbage", async () => {
    const price = await resolveHoldingLatestPrice({ assetClass: "MUTUAL_FUND", symbol: "UPLOAD_ODD", source: "ADMIN_UPLOAD", metadata: { price: "not-a-number" as unknown as number } });
    expect(price).toBeNull();
  });

  it("returns null when metadata itself is missing entirely", async () => {
    const price = await resolveHoldingLatestPrice({ assetClass: "MUTUAL_FUND", symbol: "UPLOAD_NOMETA", source: "ADMIN_UPLOAD" });
    expect(price).toBeNull();
  });
});
