export interface SectorKeywordEntry {
  keywords: string[];
  segment: string;
}

/**
 * Only funds AMFI itself classifies under a "Sectoral/Thematic" category
 * header are checked against this list (see fetchAmfiSectoralFundSegments in
 * instrumentSources.ts) — a Large Cap or Flexi Cap fund spans dozens of
 * industries, so tagging those with one sector would be misleading. These
 * keywords are drawn from real AMFI scheme names for genuinely single-sector
 * bets. Broader/diversified sectoral-thematic names (MNC, Business Cycle,
 * Special Opportunities, Quant, ESG Integration, Value, Focused,
 * International Equity, Innovation, Momentum, Conglomerate) are deliberately
 * left unmatched rather than guessed at — they don't represent one clean
 * industry the way "Banking and Financial Services" or "Pharma and
 * Healthcare" do.
 */
export const MUTUAL_FUND_SEGMENT_KEYWORDS: SectorKeywordEntry[] = [
  { keywords: ["banking", "financial services"], segment: "Financial Services" },
  { keywords: ["pharma", "healthcare"], segment: "Healthcare" },
  { keywords: ["infrastructure"], segment: "Infrastructure" },
  { keywords: ["digital india", "technology"], segment: "Information Technology" },
  { keywords: ["consumption"], segment: "FMCG & Consumption" },
  { keywords: ["psu equity", "psu bank"], segment: "PSU" },
  { keywords: ["energy", "power"], segment: "Energy" },
  { keywords: ["manufacturing"], segment: "Manufacturing" },
  { keywords: ["transportation and logistics"], segment: "Transportation & Logistics" },
  { keywords: ["realty", "real estate"], segment: "Realty" },
  { keywords: ["auto"], segment: "Automobile" },
];

export function matchMutualFundSegment(schemeName: string): string | undefined {
  const lower = schemeName.toLowerCase();
  for (const entry of MUTUAL_FUND_SEGMENT_KEYWORDS) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.segment;
  }
  return undefined;
}
