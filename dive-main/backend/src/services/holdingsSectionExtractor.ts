/**
 * A screen shared for bot-scanning shows far more than the holdings table —
 * watchlists, index tickers, nav bars, summary cards ("Invested Amount",
 * "Overall Gain", etc.) all OCR into "name + number(s)" lines too, and were
 * getting swept up as fake holdings. This trims the OCR text down to (as best
 * effort) just the actual holdings table before any row-parsing happens.
 */

const SECTION_START_MARKERS = [/\bholdings\b/i, /\bportfolio\b/i];
const SECTION_END_MARKERS = [/\bportfolio insights\b/i];
// The column header row itself (e.g. "Name Quantity Avg. Price LTP Inv. Amt. Current Val.")
// is not a data row — skip past it too if it's the line right after the marker.
const HEADER_ROW_PATTERN = /\bname\b.*\b(qty|quantity)\b/i;

export interface SectionExtraction {
  text: string;
  sectionDetected: boolean;
  expectedCount: number | null;
  // Everything BEFORE the start marker (watchlist, index tickers, summary
  // cards) — useful on its own so a caller can identify "known noise" names
  // and keep excluding them from later frames where the marker has scrolled
  // out of view and can't be detected anymore.
  excludedText: string;
}

export function extractHoldingsSection(fullText: string): SectionExtraction {
  const lines = fullText.split(/\r?\n/);

  let startIdx = -1;
  let expectedCount: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = SECTION_START_MARKERS.find((m) => m.test(lines[i]));
    if (marker) {
      startIdx = i;
      const countMatch = lines[i].match(/(\d{1,4})/) || (lines[i + 1] || "").match(/^\s*(\d{1,4})\s*$/);
      if (countMatch) expectedCount = parseInt(countMatch[1], 10);
      break;
    }
  }

  if (startIdx === -1) {
    return { text: fullText, sectionDetected: false, expectedCount: null, excludedText: "" };
  }

  let sliceStart = startIdx + 1;
  if (HEADER_ROW_PATTERN.test(lines[sliceStart] || "")) sliceStart += 1;

  let sliceEnd = lines.length;
  for (let i = sliceStart; i < lines.length; i++) {
    if (SECTION_END_MARKERS.some((m) => m.test(lines[i]))) {
      sliceEnd = i;
      break;
    }
  }

  return {
    text: lines.slice(sliceStart, sliceEnd).join("\n"),
    sectionDetected: true,
    expectedCount,
    excludedText: lines.slice(0, startIdx).join("\n"),
  };
}
