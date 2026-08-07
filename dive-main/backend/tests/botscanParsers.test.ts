import { parseAngelOneText } from "../src/services/brokerParsers/angelOne";
import { parseGenericRows, guessValuesFromNumbers } from "../src/services/genericRowParser";
import { extractHoldingsSection } from "../src/services/holdingsSectionExtractor";
import { categorizeInstrument } from "../src/services/categorizeInstrument";
import { Instrument } from "../src/models/Instrument";

describe("holdings section extractor", () => {
  it("trims out watchlist/index noise above the Holdings marker", () => {
    const text = [
      "NIFTY 23,985.35 -10.60",
      "ELECTCAST 71.48 -0.66",
      "SHYAMMETL 1,027.00 -8.10",
      "Invested Amount 3,10,541",
      "Overall Gain 1,10,689.04 +35.64%",
      "Holdings 2",
      "Name Quantity Avg. Price LTP",
      "RELIANCE 10 2450.50 2600.00",
    ].join("\n");
    const { text: sectionText, sectionDetected, expectedCount } = extractHoldingsSection(text);
    expect(sectionDetected).toBe(true);
    expect(expectedCount).toBe(2);
    expect(sectionText).not.toMatch(/ELECTCAST|SHYAMMETL|Overall Gain/);
    expect(sectionText).toMatch(/RELIANCE/);
  });

  it("passes text through unchanged when no section marker is found", () => {
    const text = "some random OCR text\nwith no markers 123 456";
    const { text: sectionText, sectionDetected } = extractHoldingsSection(text);
    expect(sectionDetected).toBe(false);
    expect(sectionText).toBe(text);
  });

  it("exposes the excluded (pre-marker) text so callers can learn what's noise", () => {
    const text = ["ELECTCAST 71.48 -0.66", "SHYAMMETL 1027.00 -8.10", "Holdings 1", "RELIANCE 10 2450.50 2600.00"].join("\n");
    const { excludedText } = extractHoldingsSection(text);
    expect(excludedText).toMatch(/ELECTCAST/);
    expect(excludedText).toMatch(/SHYAMMETL/);
    expect(excludedText).not.toMatch(/RELIANCE/);
  });
});

describe("Angel One layout parser", () => {
  it("parses multi-line-per-row holdings using the real Inv.Amt/Current Val column order", async () => {
    const text = [
      "Holdings 2",
      "Name Quantity Avg. Price LTP Inv. Amt. Current Val.",
      "RELIANCE",
      "10",
      "2450.50",
      "2600.00",
      "24,505.00",
      "26,000.00",
      "1,495.00",
      "6.10%",
      "HDFCBANK",
      "5",
      "1600.00",
      "1650.25",
      "8,000.00",
      "8,251.25",
      "251.25",
      "3.14%",
    ].join("\n");

    const { candidates, sectionDetected, expectedCount } = await parseAngelOneText(text);
    expect(sectionDetected).toBe(true);
    expect(expectedCount).toBe(2);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe("RELIANCE");
    expect(candidates[0].quantity).toBe(10);
    expect(candidates[0].investedValue).toBe(24505);
    expect(candidates[0].currentValue).toBe(26000);
  });

  it("does not mistake watchlist rows above the Holdings marker for real holdings", async () => {
    const text = [
      "ELECTCAST 71.48 -0.66",
      "SHYAMMETL 1,027.00 -8.10",
      "Holdings 1",
      "Name Quantity Avg. Price LTP Inv. Amt. Current Val.",
      "RELIANCE",
      "10",
      "2450.50",
      "2600.00",
      "24,505.00",
      "26,000.00",
    ].join("\n");
    const { candidates } = await parseAngelOneText(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("RELIANCE");
  });

  it("yields nothing for text with no ticker-shaped rows", async () => {
    const { candidates } = await parseAngelOneText("Total Portfolio Value: 34251.25\nSome unrelated OCR noise");
    expect(candidates).toHaveLength(0);
  });

  it("rejects short OCR-garbage fragments as row names (min 3 chars)", async () => {
    const text = ["Holdings 1", "BN", "10", "20", "30", "RELIANCE", "10", "2450.50", "2600.00", "24505.00", "26000.00"].join("\n");
    const { candidates } = await parseAngelOneText(text);
    expect(candidates.map((c) => c.name)).not.toContain("BN");
    expect(candidates.map((c) => c.name)).toContain("RELIANCE");
  });

  it("requires at least 4 numbers per row, rejecting rows with too little data", async () => {
    const text = ["Holdings 1", "SPARSEROW", "10", "20", "30"].join("\n");
    const { candidates } = await parseAngelOneText(text);
    expect(candidates).toHaveLength(0);
  });
});

describe("generic fallback row parser", () => {
  it("extracts repeating text+number rows", () => {
    const rows = parseGenericRows("Gold ETF 10000 10500\nRandom text with no numbers\nSilver Fund 5000 5200 1.5%");
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Gold ETF");
  });

  it("guesses invested/current value from a 4-number row (qty, avg, ltp, value)", () => {
    const { investedValue, currentValue, quantity } = guessValuesFromNumbers([10, 2450.5, 2600, 26000]);
    expect(quantity).toBe(10);
    expect(investedValue).toBe(24505);
    expect(currentValue).toBe(26000);
  });

  it("falls back to last-number-as-current for a 2-number row", () => {
    const { investedValue, currentValue } = guessValuesFromNumbers([10000, 10500]);
    expect(currentValue).toBe(10500);
    expect(investedValue).toBe(10000);
  });
});

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
