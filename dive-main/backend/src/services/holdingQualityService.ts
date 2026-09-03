import { AssetClass } from "../models/Instrument";

/**
 * Per-holding "quality & risk" signal shown on the X-Ray drill-down. Replaces
 * the old blanket "credit ratings aren't available for self-reported holdings
 * yet" message, which applied uniformly to every asset class even though
 * "credit rating" as a concept only really applies to debt instruments
 * (bonds, FDs) — equities, crypto, gold and REITs don't have credit ratings
 * at all, they have entirely different risk framings.
 *
 * Every fact used here is either:
 *   - real data this app already fetches (equity sector/market-cap tier from
 *     NSE, crypto category from CoinGecko — see instrumentService.ts), or
 *   - a static, universally-true regulatory/structural fact (DICGC deposit
 *     insurance, SEBI's REIT/InvIT payout mandate, gold/silver having no
 *     issuer credit risk) that needs no per-issuer data source at all.
 * Where neither is available (corporate bond ratings, MF star ratings, ETF
 * expense ratios, insurer claim-settlement ratios), this says so honestly
 * instead of fabricating or omitting a signal — those are genuinely paid/
 * licensed data or unstructured annual PDF reports, not a free API.
 */

export type QualityTier = "good" | "neutral" | "caution" | "unknown";

export interface HoldingQuality {
  label: string;
  detail: string;
  tier: QualityTier;
}

const CRYPTO_CATEGORY_DETAIL: Record<string, { detail: string; tier: QualityTier }> = {
  Stablecoins: {
    detail:
      "Stablecoins are pegged to a reference asset (usually the US dollar) and designed for low price volatility — but they still carry issuer/reserve-backing risk, not credit risk in the traditional sense.",
    tier: "good",
  },
  "Layer 1": {
    detail:
      "Layer 1 blockchains (e.g. Bitcoin, Ethereum) are foundational networks — among the more established crypto assets, but still far more volatile than traditional asset classes.",
    tier: "neutral",
  },
  "Layer 2": {
    detail: "Layer 2 scaling networks build on top of a Layer 1 chain — carries that chain's risk plus its own smart-contract and adoption risk.",
    tier: "neutral",
  },
  DeFi: {
    detail: "DeFi tokens are tied to decentralized finance protocols — typically high volatility plus smart-contract risk on top of price risk.",
    tier: "caution",
  },
  Meme: {
    detail: "Meme coins have little to no underlying utility and are driven largely by sentiment — among the highest-risk, most speculative crypto assets.",
    tier: "caution",
  },
  Gaming: { detail: "Gaming tokens are tied to a specific game/platform's adoption — high volatility, concentrated in one project's success.", tier: "caution" },
  Oracle: { detail: "Oracle tokens power price-feed infrastructure for other protocols — carries broader DeFi-ecosystem risk.", tier: "neutral" },
  "Exchange Token": {
    detail: "Exchange tokens are tied to a specific crypto exchange's business — carries that exchange's counterparty and regulatory risk.",
    tier: "caution",
  },
  AI: { detail: "AI-narrative tokens are a fast-moving, sentiment-driven category — high volatility.", tier: "caution" },
  "Real World Assets": {
    detail: "Real World Asset (RWA) tokens represent a claim on an off-chain asset — carries that underlying asset's risk plus tokenization/counterparty risk.",
    tier: "neutral",
  },
};

const MF_RATINGS_UNAVAILABLE =
  "Independent mutual fund quality ratings (CRISIL, Value Research star ratings) are licensed/paid data we don't have free access to yet.";

// AMFI's own scheme_category (from MFAPI.in, fetched on demand — see
// instrumentDetailService.ts) covers every mutual fund, unlike the curated
// sector/thematic keyword match below which only tags a subset. Classified
// by substring match since AMFI's category strings aren't a fixed enum
// across the whole scheme master (e.g. "Equity Scheme - Sectoral/ Thematic",
// "Debt Scheme - Banking and PSU Fund", "Hybrid Scheme - ...").
function classifyMfCategory(category: string): { tier: QualityTier; note: string } {
  const c = category.toLowerCase();
  if (c.includes("sectoral") || c.includes("thematic")) {
    return { tier: "caution", note: "Sector/thematic funds concentrate in one industry or theme — higher concentration risk than a diversified fund." };
  }
  if (c.includes("small cap")) {
    return { tier: "caution", note: "Small-cap equity funds typically carry higher volatility than large/multi-cap funds." };
  }
  if (c.includes("index") || c.includes("etf")) {
    return { tier: "good", note: "Passively tracks an index — no fund-manager stock-picking risk; cost is usually the main differentiator between funds." };
  }
  if (c.includes("liquid") || c.includes("overnight") || c.includes("gilt")) {
    return { tier: "good", note: "Very low duration/credit-risk debt scheme, closer to a cash-equivalent than a typical bond fund." };
  }
  if (c.startsWith("debt")) {
    return { tier: "good", note: "Debt schemes are generally lower-volatility than equity schemes, though still carry interest-rate and credit risk from the underlying bonds." };
  }
  if (c.startsWith("hybrid")) {
    return { tier: "neutral", note: "Hybrid schemes blend equity and debt, giving a risk profile between the two." };
  }
  if (c.startsWith("equity")) {
    return { tier: "neutral", note: "Diversified equity scheme — carries equity-market volatility, spread across many companies." };
  }
  if (c.includes("solution oriented")) {
    return { tier: "neutral", note: "Solution-oriented scheme (e.g. retirement/children's fund) — usually comes with a mandatory lock-in." };
  }
  return { tier: "neutral", note: "" };
}

export interface MfLiveDetail {
  schemeCategory?: string | null;
  return1yPct?: number | null;
  fundHouse?: string | null;
}

export function computeHoldingQuality(
  assetClass: AssetClass,
  instrumentMetadata: Record<string, unknown> | undefined,
  liveDetail?: MfLiveDetail
): HoldingQuality {
  switch (assetClass) {
    case "EQUITY": {
      const sector = typeof instrumentMetadata?.sector === "string" ? instrumentMetadata.sector : undefined;
      const tierRaw = instrumentMetadata?.marketCapTier;
      const capTier = tierRaw === "Large" || tierRaw === "Mid" || tierRaw === "Small" ? tierRaw : undefined;
      if (!sector && !capTier) {
        return {
          label: "Classification pending",
          detail: "NSE sector / market-cap data isn't available yet for this stock — it may be newly listed or not yet refreshed.",
          tier: "unknown",
        };
      }
      const label = [capTier ? `${capTier}-cap` : null, sector].filter(Boolean).join(" · ");
      const detail =
        capTier === "Large"
          ? "Large-cap stocks are generally more liquid and stable, with lower (though not zero) volatility than mid/small-caps."
          : capTier === "Small"
          ? "Small-cap stocks typically carry higher volatility and liquidity risk than large-caps, in exchange for higher growth potential."
          : capTier === "Mid"
          ? "Mid-cap stocks sit between large-cap stability and small-cap growth/risk."
          : `Sector: ${sector}. Market-cap tier isn't available for this stock yet.`;
      return { label, detail, tier: capTier === "Large" ? "good" : capTier === "Small" ? "caution" : "neutral" };
    }

    case "CRYPTO": {
      const category = typeof instrumentMetadata?.sector === "string" ? instrumentMetadata.sector : undefined;
      if (!category) return { label: "Uncategorized", detail: "This coin isn't in our curated category list yet — risk varies widely by project.", tier: "unknown" };
      const known = CRYPTO_CATEGORY_DETAIL[category];
      return { label: category, detail: known?.detail ?? `${category} — a curated crypto category; risk varies by project.`, tier: known?.tier ?? "neutral" };
    }

    case "FD":
      return {
        label: "DICGC insured up to Rs. 5,00,000",
        detail:
          "Deposits at scheduled commercial banks (including this FD/RD) are insured up to Rs. 5,00,000 per depositor per bank by the DICGC, an RBI subsidiary — beyond that, you carry the bank's own credit risk. Company/NBFC FDs/RDs are NOT covered by this insurance.",
        tier: "good",
      };

    case "PF":
      return {
        label: "Sovereign/EPFO-backed — no bank credit risk",
        detail:
          "PPF is backed directly by the Government of India via the National Small Savings Fund; EPF is administered by EPFO, a statutory body under the Ministry of Labour & Employment. Neither carries a bank's credit/default risk the way an FD/RD does, so there's no DICGC-style deposit insurance here — none is needed. The government-declared interest rate (reviewed quarterly for PPF, annually for EPF) can change over time, but your principal and already-declared interest aren't at credit risk.",
        tier: "good",
      };

    case "BOND":
      return {
        label: "Issuer credit risk varies",
        detail:
          "Government bonds (G-Secs) are sovereign-backed and considered the safest debt instrument in India. Corporate bonds carry real issuer-specific credit risk (rated AAA to D by agencies like CRISIL/ICRA/CARE) that we don't have a free live data source for yet — check the specific bond's published rating before relying on it. Unlike bank FDs, bonds aren't covered by DICGC insurance.",
        tier: "unknown",
      };

    case "REIT":
    case "INVIT":
      return {
        label: "SEBI-mandated 90%+ payout",
        detail:
          "SEBI regulations require REITs/InvITs to distribute at least 90% of net distributable cash flows to unit-holders. This doesn't eliminate risk — occupancy, rental/toll income, and unit price can still fluctuate.",
        tier: "neutral",
      };

    case "GOLD":
    case "SILVER":
      return {
        label: "No credit / issuer risk",
        detail: "Physical or paper gold/silver isn't a debt claim on an issuer, so there's no credit or default risk — but its market price can still be volatile.",
        tier: "good",
      };

    case "MUTUAL_FUND": {
      const category = liveDetail?.schemeCategory;
      if (category) {
        const { tier, note } = classifyMfCategory(category);
        const houseNote = liveDetail?.fundHouse ? ` (${liveDetail.fundHouse})` : "";
        const returnNote =
          typeof liveDetail?.return1yPct === "number"
            ? ` 1-year NAV return: ${liveDetail.return1yPct >= 0 ? "+" : ""}${liveDetail.return1yPct.toFixed(1)}%.`
            : "";
        return {
          label: category,
          detail: `AMFI classifies this as a ${category} scheme${houseNote}. ${note}${returnNote} ${MF_RATINGS_UNAVAILABLE}`.replace(/\s+/g, " ").trim(),
          tier,
        };
      }
      // No live AMFI category available yet — fall back to the curated
      // sector/thematic keyword match (see instrumentService.ts), which only
      // tags a subset of funds.
      const segment = typeof instrumentMetadata?.sector === "string" ? instrumentMetadata.sector : undefined;
      if (segment) {
        return {
          label: `${segment} sector fund`,
          detail: `This fund is concentrated in the ${segment} sector — sector/thematic funds carry higher concentration risk than diversified funds. ${MF_RATINGS_UNAVAILABLE}`,
          tier: "caution",
        };
      }
      return { label: "Ratings not freely available", detail: MF_RATINGS_UNAVAILABLE, tier: "unknown" };
    }

    case "ETF":
      return {
        label: "Ratings not freely available",
        detail: "Expense ratio and tracking-error data for ETFs aren't in a free, structured dataset we can pull from yet.",
        tier: "unknown",
      };

    case "ULIP_INSURANCE":
      return {
        label: "Ratings not freely available",
        detail:
          "Insurer claim-settlement ratios are published by IRDAI as annual reports, not a queryable API — we don't have a reliable free source to pull this from yet.",
        tier: "unknown",
      };

    default:
      return { label: "Not available", detail: "Quality/risk data isn't available for this asset class yet.", tier: "unknown" };
  }
}
