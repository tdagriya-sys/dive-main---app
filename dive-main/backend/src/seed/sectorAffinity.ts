import { AssetClass } from "../models/Instrument";

/**
 * Cross-asset-class "shared risk factor" affinities for the Dive Score's
 * look-through model — the aim, per product intent, is to measure how many
 * genuinely INDEPENDENT unwanted events it would take to hurt the portfolio.
 * A jewelry retailer's stock and a gold holding aren't the SAME bet (equity
 * has business/retail-execution risk gold doesn't), but they aren't fully
 * independent either — a gold-price shock affects both. These weights are
 * deliberately small (never full overlap) and illustrative, not a precise
 * financial correlation model.
 *
 * Two tiers, checked in order by lookthroughService:
 *
 * 1. KEYWORD_SECTOR_AFFINITY — precise, hand-picked company-name keywords for
 *    cases the broad NSE industry classification is too coarse to catch
 *    (e.g. jewelry retailers land under the generic "Consumer Durables"
 *    alongside appliance makers, so a keyword override is needed).
 * 2. INDUSTRY_ASSET_CLASS_AFFINITY — broad NSE "Industry" column affinities,
 *    for cases where the macro-level bucket is itself a reasonable signal
 *    (e.g. "Realty" stocks vs. REIT holdings).
 */

export interface KeywordAffinity {
  keywords: string[]; // matched case-insensitively as substrings of the holding name
  affinity: Partial<Record<AssetClass, number>>;
}

export const KEYWORD_SECTOR_AFFINITY: KeywordAffinity[] = [
  {
    keywords: ["titan", "kalyan jewellers", "pc jeweller", "senco gold", "tribhovandas", "thangamayil", "joyalukkas", "malabar gold"],
    affinity: { GOLD: 0.25, SILVER: 0.15 },
  },
  {
    keywords: ["vedanta", "hindustan zinc", "hindalco", "nalco", "national aluminium"],
    affinity: { SILVER: 0.1 },
  },
];

// Broad NSE "Industry" classification -> asset-class affinity. Small weights —
// the industry bucket is a coarse macro grouping, not a precise business match.
export const INDUSTRY_ASSET_CLASS_AFFINITY: Record<string, Partial<Record<AssetClass, number>>> = {
  Realty: { REIT: 0.3, INVIT: 0.15 },
  Construction: { INVIT: 0.2 },
  "Construction Materials": { INVIT: 0.15 },
  "Metals & Mining": { GOLD: 0.1, SILVER: 0.1 },
  Power: { INVIT: 0.1 },
};

// A sectoral/thematic mutual fund isn't sector-homogeneous the way GOLD,
// SILVER, REIT or INVIT are — it holds a diversified BASKET of companies
// within its theme, not one uniform bet — so it can't reuse
// INDUSTRY_ASSET_CLASS_AFFINITY's "any equity in sector X gets weight Y
// against EVERY holding of asset class Z" shape (that would wrongly connect,
// say, an Automobile stock to a totally unrelated Banking sectoral fund).
// Instead this translates the fund's OWN curated sector tag (see
// mutualFundSegments.ts) to the matching NSE "Industry" label(s), so
// lookthroughService only connects a stock to a fund that is ACTUALLY themed
// around that stock's sector. Deliberately partial — see
// SECTORAL_MF_AFFINITY_STRENGTH below — and deliberately incomplete: only
// mappings we're confident are a real, direct match are included (e.g.
// "Energy" as an AMFI/MF theme spans NSE's separate "Oil Gas & Consumable
// Fuels" and "Power" industries, so both are listed; broader MF themes like
// Infrastructure, Manufacturing, PSU or Transportation & Logistics span too
// many distinct NSE industries to map to any one honestly, so they're left
// out rather than guessed at — matching MUTUAL_FUND_SEGMENT_KEYWORDS' own
// stated policy above).
export const MF_SEGMENT_TO_NSE_INDUSTRY: Record<string, string[]> = {
  Realty: ["Realty"],
  "Financial Services": ["Financial Services"],
  Healthcare: ["Healthcare"],
  "Information Technology": ["Information Technology"],
  Automobile: ["Automobile and Auto Components"],
  Energy: ["Oil Gas & Consumable Fuels", "Power"],
  "FMCG & Consumption": ["Fast Moving Consumer Goods"],
};

// Below SAME_SECTOR_STRENGTH (0.3, two individual stocks in one sector) —
// a sectoral fund spreads its sector bet across many companies, not just the
// one you also hold directly, so the shared-risk-factor overlap is weaker.
export const SECTORAL_MF_AFFINITY_STRENGTH = 0.15;
