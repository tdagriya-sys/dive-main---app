import { AssetClass } from "../models/Instrument";
import { MUTUAL_FUND_TOP_HOLDINGS } from "../seed/mutualFundTopHoldings";
import {
  KEYWORD_SECTOR_AFFINITY,
  INDUSTRY_ASSET_CLASS_AFFINITY,
  MF_SEGMENT_TO_NSE_INDUSTRY,
  SECTORAL_MF_AFFINITY_STRENGTH,
} from "../seed/sectorAffinity";

/**
 * Best-effort normalization to a rough "issuer" key by stripping common
 * corporate/instrument-type suffixes — no canonical issuer registry backs
 * this, so it will miss real overlaps with dissimilar names and can
 * occasionally over-match. Good enough to catch the common, obvious case
 * (e.g. "Reliance Industries" equity + a "Reliance" bond).
 */
export function normalizeIssuer(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(ltd|limited|inc|incorporated|industries|industry|banks?|corp|corporate|corporation|bonds?|ncds?|debentures?|funds?|etfs?|schemes?|plans?|trusts?|reits?|invits?|fds?|deposits?|sgbs?|bees)\b/g,
      ""
    )
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Strips common fund-naming noise words so "HDFC Flexi Cap Fund",
// "HDFC Flexi Cap Fund - Direct Plan - Growth", etc. all normalize to the
// same key as the curated dataset's "hdfcflexicap".
function normalizeFundKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fund|scheme|plan|direct|regular|growth|dividend|idcw)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export interface LookthroughHolding {
  name: string;
  assetClass: AssetClass;
  value: number;
  // NSE broad industry classification for EQUITY; the curated sectoral/
  // thematic tag (see mutualFundSegments.ts) for MUTUAL_FUND; unset for
  // every other class.
  sector?: string;
}

export interface Connection {
  a: string;
  b: string;
  strength: number; // 0-1
  reason: string;
  // cross-class connections are what actually pull realDiversificationPct
  // below apparentDiversificationPct; same-class ones (e.g. two bank stocks,
  // both EQUITY) instead discount the per-name concentration sub-score, since
  // apparent/real are a cross-asset-class concept by definition. A consumer
  // that lists ALL connections under "why real is below apparent" without
  // checking this would show same-class entries that had no effect on that
  // gap — this field exists so callers don't have to re-derive it themselves.
  scope: "cross-class" | "same-class";
}

interface ConnectionResult {
  strength: number;
  reason: string;
}

// Two different companies in the same broad industry aren't the same bet,
// but a sector-wide shock (a rate move, a regulatory change, a demand shock)
// would still hit both — so this sits well below an exact issuer match (1.0)
// but above the smaller cross-class affinities below.
const SAME_SECTOR_STRENGTH = 0.3;

/**
 * Same-asset-class connection: two distinct holdings in the SAME class and
 * the same broad sector (currently only populated for EQUITY, via NSE
 * industry classification). Skips holdings that are actually the same
 * issuer under slightly different names — that's a data-quality duplicate,
 * not a sector-affinity case.
 */
function sameSectorConnection(h1: LookthroughHolding, h2: LookthroughHolding): ConnectionResult | null {
  if (!h1.sector || !h2.sector || h1.sector !== h2.sector) return null;
  if (normalizeIssuer(h1.name) === normalizeIssuer(h2.name)) return null;
  return {
    strength: SAME_SECTOR_STRENGTH,
    reason: `${h1.name} and ${h2.name} are both in the ${h1.sector} sector`,
  };
}

/**
 * Layered connection-strength model between two holdings — the point of
 * "real" (look-through) diversification: how many genuinely independent
 * unwanted events would it take to hurt this portfolio? Checked from most to
 * least precise, first match wins:
 *
 *   0. Same asset class + same broad sector (e.g. two different bank stocks)
 *      — different companies, but exposed to the same sector-wide risk.
 *      This is the only tier that applies WITHIN one asset class; the rest
 *      are cross-class by definition.
 *   1. Exact issuer match (e.g. "Reliance Industries" equity + a "Reliance"
 *      bond) — this is the same company, so full overlap (1.0).
 *   2. Mutual fund look-through — the fund's disclosed weight in a stock you
 *      also hold directly, when a curated top-holdings snapshot exists for it.
 *   3. Curated keyword affinity (e.g. a jewelry retailer <-> gold) — a small,
 *      hand-picked weight for cases the broad industry bucket can't catch.
 *   4. Broad NSE industry affinity (e.g. Realty <-> REIT) — a small weight.
 *   5. Sectoral/thematic mutual fund <-> matching-sector equity (e.g. an
 *      Automobile-sector stock <-> an Automobile-themed sectoral fund) — the
 *      fund's OWN curated sector tag has to match the equity's NSE industry
 *      (via MF_SEGMENT_TO_NSE_INDUSTRY), not a blanket per-asset-class
 *      weight like tier 4, since unlike REIT/Gold/Silver a mutual fund isn't
 *      sector-homogeneous — most funds hold dozens of unrelated sectors.
 *
 * Returns null when none apply — most pairs (e.g. an IT stock and an FD) are
 * genuinely unrelated and should contribute nothing.
 */
function connectionBetween(h1: LookthroughHolding, h2: LookthroughHolding): ConnectionResult | null {
  if (h1.assetClass === h2.assetClass) return sameSectorConnection(h1, h2);

  const key1 = normalizeIssuer(h1.name);
  const key2 = normalizeIssuer(h2.name);
  if (key1 && key2 && key1 === key2) {
    return { strength: 1, reason: `${h1.name} and ${h2.name} appear to be the same issuer` };
  }

  const mfSide = h1.assetClass === "MUTUAL_FUND" ? h1 : h2.assetClass === "MUTUAL_FUND" ? h2 : null;
  const mfOtherSide = mfSide === h1 ? h2 : mfSide === h2 ? h1 : null;
  if (mfSide && mfOtherSide && (mfOtherSide.assetClass === "EQUITY" || mfOtherSide.assetClass === "BOND")) {
    const fundHoldings = MUTUAL_FUND_TOP_HOLDINGS[normalizeFundKey(mfSide.name)];
    if (fundHoldings) {
      const match = fundHoldings.find((fh) => normalizeIssuer(fh.company) === normalizeIssuer(mfOtherSide.name));
      if (match) {
        return {
          strength: match.weightPct / 100,
          reason: `${mfSide.name} holds ~${match.weightPct}% in ${mfOtherSide.name}, which you also hold directly`,
        };
      }
    }
  }

  const equitySide = h1.assetClass === "EQUITY" ? h1 : h2.assetClass === "EQUITY" ? h2 : null;
  const nonEquitySide = equitySide === h1 ? h2 : equitySide === h2 ? h1 : null;
  if (equitySide && nonEquitySide) {
    const lowerName = equitySide.name.toLowerCase();
    for (const entry of KEYWORD_SECTOR_AFFINITY) {
      if (entry.keywords.some((k) => lowerName.includes(k))) {
        const affinity = entry.affinity[nonEquitySide.assetClass];
        if (affinity) {
          return {
            strength: affinity,
            reason: `${equitySide.name}'s business has some exposure to ${nonEquitySide.assetClass.toLowerCase()} prices`,
          };
        }
      }
    }

    if (equitySide.sector) {
      const affinity = INDUSTRY_ASSET_CLASS_AFFINITY[equitySide.sector]?.[nonEquitySide.assetClass];
      if (affinity) {
        return {
          strength: affinity,
          reason: `${equitySide.name} is in the ${equitySide.sector} sector, which has some overlap with ${nonEquitySide.assetClass.toLowerCase()}`,
        };
      }
    }

    if (nonEquitySide.assetClass === "MUTUAL_FUND" && equitySide.sector && nonEquitySide.sector) {
      const nseIndustries = MF_SEGMENT_TO_NSE_INDUSTRY[nonEquitySide.sector];
      if (nseIndustries?.includes(equitySide.sector)) {
        return {
          strength: SECTORAL_MF_AFFINITY_STRENGTH,
          reason: `${equitySide.name} (${equitySide.sector}) and ${nonEquitySide.name} are both concentrated in the same sector`,
        };
      }
    }
  }

  return null;
}

export interface LookthroughResult {
  overlapShare: number; // 0-1, CROSS-class only — feeds realDiversification = apparentDiversification * (1 - overlapShare)
  sameClassOverlapShare: number; // 0-1, SAME-class only (e.g. same-sector) — feeds a discount on the per-name spread score, since apparent/real are both already 0 for a single-class portfolio and have no room left to reflect it
  connections: Connection[];
}

/**
 * Aggregates pairwise connection strength across holding pairs into two
 * separate shares of the portfolio's value that "look" diversified away from
 * a risk factor but genuinely aren't:
 *
 *   - overlapShare: cross-asset-class connections only (issuer match, MF
 *     look-through, keyword/industry affinity). Unchanged from before —
 *     feeds realDiversification, which is only meaningful once you're
 *     spread across more than one class.
 *   - sameClassOverlapShare: same-asset-class connections only (same-sector,
 *     different company). Kept separate because apparent/real diversification
 *     are both floored at 0 for a single-class portfolio (by design — see
 *     diveScoreService.ts), leaving no room to reflect "some of this one
 *     class is more concentrated than others" — so this feeds the per-name
 *     spread score instead. Each asset class's contribution is capped at
 *     that class's OWN total value before being divided by the portfolio
 *     total, so a tightly-clustered sector inside a small slice of the
 *     portfolio can only ever move the score by that slice's own weight —
 *     never more than the asset class actually represents.
 *
 * Every pair's contribution is capped at the SMALLER of the two holdings'
 * values (shared exposure can't exceed what the smaller position represents).
 */
export function computeLookthroughOverlap(holdings: LookthroughHolding[], totalValue: number): LookthroughResult {
  if (totalValue <= 0 || holdings.length < 2) return { overlapShare: 0, sameClassOverlapShare: 0, connections: [] };

  const connections: Connection[] = [];
  let crossClassOverlapValue = 0;
  const sameClassOverlapByClass = new Map<AssetClass, number>();
  const classTotalValue = new Map<AssetClass, number>();
  for (const h of holdings) classTotalValue.set(h.assetClass, (classTotalValue.get(h.assetClass) || 0) + h.value);

  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      const c = connectionBetween(holdings[i], holdings[j]);
      if (c && c.strength > 0) {
        const pairValue = Math.min(holdings[i].value, holdings[j].value) * c.strength;
        const sameClass = holdings[i].assetClass === holdings[j].assetClass;
        connections.push({
          a: holdings[i].name,
          b: holdings[j].name,
          strength: Math.round(c.strength * 100) / 100,
          reason: c.reason,
          scope: sameClass ? "same-class" : "cross-class",
        });
        if (sameClass) {
          const cls = holdings[i].assetClass;
          sameClassOverlapByClass.set(cls, (sameClassOverlapByClass.get(cls) || 0) + pairValue);
        } else {
          crossClassOverlapValue += pairValue;
        }
      }
    }
  }

  let sameClassOverlapValue = 0;
  for (const [cls, value] of sameClassOverlapByClass) {
    sameClassOverlapValue += Math.min(value, classTotalValue.get(cls) || 0);
  }

  return {
    overlapShare: Math.max(0, Math.min(1, crossClassOverlapValue / totalValue)),
    sameClassOverlapShare: Math.max(0, Math.min(1, sameClassOverlapValue / totalValue)),
    connections,
  };
}
