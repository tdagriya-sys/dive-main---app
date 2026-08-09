import { categorizeInstrument } from "../src/services/categorizeInstrument";
import { Instrument } from "../src/models/Instrument";

describe("instrument verification during categorization", () => {
  beforeAll(async () => {
    await Instrument.create({ assetClass: "EQUITY", symbol: "RELIANCE", name: "Reliance Industries", isActive: true, source: "SEED" });
  });

  it("matches a known symbol and marks it verified", async () => {
    const result = await categorizeInstrument("RELIANCE");
    expect(result.assetClass).toBe("EQUITY");
    expect(result.verifiedInInstrumentList).toBe(true);
    expect(result.matchedName).toBe("Reliance Industries");
  });

  it("flags an unrecognized ticker as unverified rather than rejecting it", async () => {
    const result = await categorizeInstrument("SOMEOBSCURESMALLCAP");
    expect(result.assetClass).toBe("EQUITY");
    expect(result.verifiedInInstrumentList).toBe(false);
  });
});
