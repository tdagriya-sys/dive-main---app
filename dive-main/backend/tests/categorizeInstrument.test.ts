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

  // Regression guard for the ordering constraint noted right in
  // categorizeInstrument.ts's KEYWORD_RULES: "provident fund" contains the
  // substring "fund" and must not fall through to MUTUAL_FUND's \bfund\b
  // pattern instead of PF's own rule, which has to run first.
  it.each(["PPF Account", "EPF Balance", "My Provident Fund", "Employees Provident Fund"])(
    "categorizes %s as PF, not MUTUAL_FUND",
    async (name) => {
      const result = await categorizeInstrument(name);
      expect(result.assetClass).toBe("PF");
    }
  );
});
