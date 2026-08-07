export interface ParsedRow {
  rawLine: string;
  name: string;
  numbers: number[];
}

const NUMBER_TOKEN = /-?₹?\s?\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Generic fallback line parser: finds lines that look like "<text> <number> <number> ...",
 * the repeating-row shape a holdings table exports as when there's no known
 * column layout for the source app/broker. Used by both file-upload OCR text
 * and the bot-scanner's generic (non-Angel-One) fallback parser. Deliberately
 * approximate — see callers for how each maps `numbers` to invested/current
 * value, and note both paths always go through a user review step before saving.
 */
export function parseGenericRows(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const numberMatches = trimmed.match(NUMBER_TOKEN);
    if (!numberMatches || numberMatches.length < 2) continue;

    const firstNumberIndex = trimmed.search(NUMBER_TOKEN);
    const name = trimmed.slice(0, firstNumberIndex).trim().replace(/[|:.\-–]+$/, "").trim();
    if (!name || name.length < 2) continue;

    const numbers = numberMatches
      .map((n) => Number(n.replace(/[₹,%\s]/g, "")))
      .filter((n) => !Number.isNaN(n));
    if (numbers.length < 2) continue;

    rows.push({ rawLine: trimmed, name, numbers });
  }

  return rows;
}

/**
 * Best-effort mapping of a generic row's numbers to invested/current value.
 * 4+ numbers: assumes [quantity, avgPrice, ltp, currentValue, ...] (a typical
 * broker holdings table) — invested = qty*avgPrice, current = qty*ltp.
 * 2-3 numbers: last is treated as current value; the one before it as invested
 * value only if it's a plausible principal (not wildly larger than current).
 */
export function guessValuesFromNumbers(numbers: number[]): { investedValue: number; currentValue: number; quantity?: number } {
  if (numbers.length >= 4) {
    const [quantity, avgPrice, ltp] = numbers;
    return {
      quantity,
      investedValue: Math.round(quantity * avgPrice),
      currentValue: Math.round(quantity * ltp),
    };
  }
  const currentValue = numbers[numbers.length - 1];
  const maybeInvested = numbers[numbers.length - 2];
  const investedValue = maybeInvested !== undefined && maybeInvested <= currentValue * 3 ? maybeInvested : currentValue;
  return { investedValue, currentValue };
}
