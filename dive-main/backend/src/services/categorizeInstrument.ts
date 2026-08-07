import { Instrument, AssetClass, ASSET_CLASSES } from "../models/Instrument";

// Rule-based keyword patterns tried before falling back to an Instrument-master
// name lookup. Order matters — more specific patterns first.
const KEYWORD_RULES: Array<{ assetClass: AssetClass; pattern: RegExp }> = [
  { assetClass: "FD", pattern: /\bfixed deposit\b|\bfd\b|\btime deposit\b/i },
  { assetClass: "CRYPTO", pattern: /\bbitcoin\b|\bethereum\b|\bcrypto\b|\busdt\b|\bbnb\b|\bsolana\b|\bdogecoin\b/i },
  { assetClass: "GOLD", pattern: /\bgold\b|\bsgb\b|\bsovereign gold bond\b/i },
  { assetClass: "SILVER", pattern: /\bsilver\b/i },
  { assetClass: "ULIP_INSURANCE", pattern: /\bulip\b|\binsurance\b|\blife plan\b|\bguaranteed plan\b/i },
  { assetClass: "REIT", pattern: /\breit\b|\boffice parks?\b|\breal estate trust\b/i },
  { assetClass: "INVIT", pattern: /\binvit\b/i },
  { assetClass: "ETF", pattern: /\betf\b|\bexchange traded fund\b|\bbees\b/i },
  { assetClass: "BOND", pattern: /\bbond\b|\bg-?sec\b|\bdebenture\b|\bncd\b/i },
  { assetClass: "MUTUAL_FUND", pattern: /\bfund\b|\bmutual fund\b|\bmf\b/i },
];

export interface CategorizeResult {
  assetClass: AssetClass | null;
  instrumentId: string | null;
  confidence: "high" | "medium" | "low";
  // true only when the name/symbol actually matched something in our
  // Instrument master — our seed is nowhere near NSE's full ~2700+ listed
  // equities, so `false` does NOT mean "this isn't real", only "we couldn't
  // verify it" — callers should use this to flag rows for extra user review,
  // never to silently reject them.
  verifiedInInstrumentList: boolean;
  matchedName: string | null;
}

/**
 * Maps a free-text instrument name (from a file upload row, bot-scan OCR line,
 * etc.) to one of the 11 canonical asset classes. Broker holdings pages
 * (e.g. Angel One) show ticker SYMBOLS (e.g. "RELIANCE"), not full company
 * names, so symbol lookup is tried first (exact, case-insensitive) before
 * falling back to fuzzy name matching.
 */
export async function categorizeInstrument(rawName: string): Promise<CategorizeResult> {
  const trimmed = rawName.trim();
  if (!trimmed) return { assetClass: null, instrumentId: null, confidence: "low", verifiedInInstrumentList: false, matchedName: null };

  const symbolMatch = await Instrument.findOne({ symbol: new RegExp(`^${escapeRegex(trimmed)}$`, "i") }).lean();
  if (symbolMatch) {
    return {
      assetClass: symbolMatch.assetClass,
      instrumentId: String(symbolMatch._id),
      confidence: "high",
      verifiedInInstrumentList: true,
      matchedName: symbolMatch.name,
    };
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(trimmed)) {
      const match = await Instrument.findOne({ assetClass: rule.assetClass, name: new RegExp(escapeRegex(trimmed), "i") }).lean();
      return {
        assetClass: rule.assetClass,
        instrumentId: match ? String(match._id) : null,
        confidence: match ? "high" : "medium",
        verifiedInInstrumentList: !!match,
        matchedName: match ? match.name : null,
      };
    }
  }

  const nameMatch = await Instrument.findOne({ name: new RegExp(escapeRegex(trimmed), "i") }).lean();
  if (nameMatch) {
    return {
      assetClass: nameMatch.assetClass,
      instrumentId: String(nameMatch._id),
      confidence: "high",
      verifiedInInstrumentList: true,
      matchedName: nameMatch.name,
    };
  }

  // Nothing matched. Still defaults to EQUITY (the most common shape for a
  // bare ticker/short name on a broker holdings page) but explicitly flagged
  // as unverified so the caller can default it to "needs review" rather than
  // trusting it blindly.
  if (ASSET_CLASSES.includes("EQUITY")) {
    return { assetClass: "EQUITY", instrumentId: null, confidence: "low", verifiedInInstrumentList: false, matchedName: null };
  }
  return { assetClass: null, instrumentId: null, confidence: "low", verifiedInInstrumentList: false, matchedName: null };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
