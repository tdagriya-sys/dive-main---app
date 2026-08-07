import { categorizeInstrument } from "../categorizeInstrument";
import { extractHoldingsSection } from "../holdingsSectionExtractor";
import { CandidateHolding, missingFieldsFor } from "../fileParsers/types";

/**
 * Angel One's holdings table (as of this writing) lists each position with:
 * Name, Quantity, Avg. Price, LTP, Inv. Amt., Current Val., Overall G/L
 * (amount + %), Day's G/L (amount + %) — real screenshots show this spans
 * MULTIPLE OCR text lines per row (the G/L cells wrap to their own lines), so
 * this is a name-anchor state machine rather than a single-line regex: it
 * treats any ticker-shaped line ("AXISBANK", "BAJFINANCE") as the start of a
 * new row and accumulates every number found on the lines that follow until
 * the next ticker-shaped line appears. If the real layout has since changed
 * this may under/over-collect numbers per row — the generic fallback parser
 * and the mandatory review-before-save step are the safety net for that.
 */
// Minimum 3 characters — real NSE symbols are almost never 1-2 letters, and
// this filters out short OCR-garbage fragments that were getting matched as
// fake ticker-shaped rows.
const NAME_LINE = /^([A-Z][A-Z0-9&.\-]{2,19})\b/;
const NUMBER_TOKEN = /-?₹?\s?\d[\d,]*(?:\.\d+)?%?/g;
const HEADER_TOKENS = new Set([
  "NAME", "QUANTITY", "QTY", "AVG", "PRICE", "LTP", "INV", "AMT", "CURRENT", "VAL",
  "OVERALL", "DAY", "DAYS", "GAIN", "LOSS", "HOLDINGS", "EQUITY", "OVERVIEW",
]);

function toNum(s: string): number {
  return Number(s.replace(/[₹,%\s]/g, ""));
}

interface RawRow {
  name: string;
  numbers: number[];
}

function collectRawRows(text: string): RawRow[] {
  const rows: RawRow[] = [];
  let current: RawRow | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const nameMatch = NAME_LINE.exec(line);
    if (nameMatch && !HEADER_TOKENS.has(nameMatch[1].toUpperCase())) {
      if (current && current.numbers.length >= 4) rows.push(current);
      current = { name: nameMatch[1], numbers: [] };
      // The rest of the same line may already contain numbers (single-line-per-row layouts).
      const rest = line.slice(nameMatch[0].length);
      const restNumbers = rest.match(NUMBER_TOKEN);
      if (restNumbers) current.numbers.push(...restNumbers.map(toNum).filter((n) => !Number.isNaN(n)));
      continue;
    }

    if (current) {
      const numbers = line.match(NUMBER_TOKEN);
      if (numbers) current.numbers.push(...numbers.map(toNum).filter((n) => !Number.isNaN(n)));
    }
  }
  if (current && current.numbers.length >= 4) rows.push(current);

  return rows;
}

function mapColumns(numbers: number[]): { investedValue: number; currentValue: number; quantity: number } {
  const [quantity, avgPrice, ltp] = numbers;
  if (numbers.length >= 5) {
    return { quantity, investedValue: numbers[3], currentValue: numbers[4] };
  }
  return {
    quantity,
    investedValue: Math.round(quantity * avgPrice),
    currentValue: numbers.length >= 4 ? numbers[3] : Math.round(quantity * ltp),
  };
}

export interface AngelOneParseResult {
  candidates: CandidateHolding[];
  sectionDetected: boolean;
  expectedCount: number | null;
}

export async function parseAngelOneText(text: string): Promise<AngelOneParseResult> {
  const { text: sectionText, sectionDetected, expectedCount } = extractHoldingsSection(text);
  const rawRows = collectRawRows(sectionText);

  const candidates: CandidateHolding[] = [];
  for (const row of rawRows) {
    const { investedValue, currentValue, quantity } = mapColumns(row.numbers);
    const { assetClass, instrumentId, confidence, verifiedInInstrumentList } = await categorizeInstrument(row.name);
    const candidate: CandidateHolding = {
      name: row.name,
      assetClass: assetClass || "EQUITY", // Angel One holdings are predominantly direct equity
      instrumentId,
      investedValue,
      currentValue,
      quantity,
      confidence: assetClass ? confidence : "medium",
      verifiedInInstrumentList,
      rawRow: { numbers: row.numbers },
      missingFields: [],
    };
    candidate.missingFields = missingFieldsFor(candidate);
    candidates.push(candidate);
  }

  return { candidates, sectionDetected, expectedCount };
}
