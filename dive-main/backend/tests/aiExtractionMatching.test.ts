import { Instrument } from "../src/models/Instrument";
import { verifyAgainstInstrumentMasterBatch } from "../src/services/aiExtractionService";

// P2 #22 — verifyAgainstInstrumentMaster used to run up to 2 sequential
// findOne round-trips PER extracted holding (20-60 round-trips for a
// typical 20-30-item scan). These tests prove the batched replacement does
// exactly ONE Instrument.find for the whole list, regardless of how many
// holdings are in it, while preserving the original matching semantics
// (exact case-insensitive symbol match, else case-insensitive substring
// name match, else unmatched).
describe("verifyAgainstInstrumentMasterBatch", () => {
  beforeEach(async () => {
    await Instrument.create([
      { assetClass: "EQUITY", symbol: "RELIANCE", name: "Reliance Industries Limited", source: "SEED" },
      { assetClass: "EQUITY", symbol: "TCS", name: "Tata Consultancy Services Limited", source: "SEED" },
      { assetClass: "MUTUAL_FUND", symbol: "PPFCF", name: "Parag Parikh Flexi Cap Fund", source: "SEED" },
      { assetClass: "CRYPTO", symbol: "BTC", name: "Bitcoin", source: "SEED" },
    ]);
  });

  it("does exactly one Instrument.find for the whole batch, not one per holding", async () => {
    const findSpy = jest.spyOn(Instrument, "find");
    const raws = [
      { name: "RELIANCE", assetClass: "EQUITY" as const },
      { name: "TCS", assetClass: "EQUITY" as const },
      { name: "Parag Parikh Flexi Cap", assetClass: "MUTUAL_FUND" as const },
      { name: "Bitcoin", assetClass: "CRYPTO" as const },
      { name: "Some Unknown Thing", assetClass: "BOND" as const },
    ];

    await verifyAgainstInstrumentMasterBatch(raws);

    expect(findSpy).toHaveBeenCalledTimes(1);
    findSpy.mockRestore();
  });

  it("still resolves an exact symbol match, case-insensitively", async () => {
    const [result] = await verifyAgainstInstrumentMasterBatch([{ name: "reliance", assetClass: "EQUITY" }]);
    expect(result.verifiedInInstrumentList).toBe(true);
    expect(result.matchedName).toBe("Reliance Industries Limited");
  });

  it("falls back to a substring name match when the symbol doesn't match exactly", async () => {
    const [result] = await verifyAgainstInstrumentMasterBatch([{ name: "Parag Parikh Flexi Cap", assetClass: "MUTUAL_FUND" }]);
    expect(result.verifiedInInstrumentList).toBe(true);
    expect(result.matchedName).toBe("Parag Parikh Flexi Cap Fund");
  });

  it("never matches across a different asset class, even with the same name", async () => {
    const [result] = await verifyAgainstInstrumentMasterBatch([{ name: "Bitcoin", assetClass: "EQUITY" }]);
    expect(result.verifiedInInstrumentList).toBe(false);
    expect(result.instrumentId).toBeNull();
  });

  it("returns unverified (not an error) for a genuinely unrecognized name", async () => {
    const [result] = await verifyAgainstInstrumentMasterBatch([{ name: "Totally Made Up Corp", assetClass: "EQUITY" }]);
    expect(result.verifiedInInstrumentList).toBe(false);
    expect(result.matchedName).toBeNull();
  });

  it("returns results in the same order as the input, one per raw holding", async () => {
    const results = await verifyAgainstInstrumentMasterBatch([
      { name: "TCS", assetClass: "EQUITY" },
      { name: "Nonexistent", assetClass: "EQUITY" },
      { name: "Bitcoin", assetClass: "CRYPTO" },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].matchedName).toBe("Tata Consultancy Services Limited");
    expect(results[1].matchedName).toBeNull();
    expect(results[2].matchedName).toBe("Bitcoin");
  });

  it("handles an empty batch without querying the database at all", async () => {
    const findSpy = jest.spyOn(Instrument, "find");
    const results = await verifyAgainstInstrumentMasterBatch([]);
    expect(results).toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });
});
