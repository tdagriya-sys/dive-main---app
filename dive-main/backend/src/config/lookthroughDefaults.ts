import { LookthroughConfigPayload } from "../models/LookthroughConfig";

/**
 * The exact values `lookthroughService.ts` used as hardcoded constants, plus
 * `seed/sectorAffinity.ts` and `seed/mutualFundTopHoldings.ts` (both deleted
 * once extracted here — same convention Phase 2 used when ScoringConfig/
 * ContextConfig/SuggestionConfig replaced their own hardcoded sources) —
 * extracted verbatim. See docs/DIVE_SCORE_MODEL.md §7 for the reasoning
 * behind each tier's strength and ordering; this file is just the numbers.
 */
export const LOOKTHROUGH_CONFIG_DEFAULTS: LookthroughConfigPayload = {
  exactIssuerStrength: 1,
  sameSectorStrength: 0.3,
  sectoralMfAffinityStrength: 0.15,

  keywordSectorAffinity: [
    {
      keywords: ["titan", "kalyan jewellers", "pc jeweller", "senco gold", "tribhovandas", "thangamayil", "joyalukkas", "malabar gold"],
      affinity: { GOLD: 0.25, SILVER: 0.15 },
    },
    {
      keywords: ["vedanta", "hindustan zinc", "hindalco", "nalco", "national aluminium"],
      affinity: { SILVER: 0.1 },
    },
  ],

  industryAssetClassAffinity: {
    Realty: { REIT: 0.3, INVIT: 0.15 },
    Construction: { INVIT: 0.2 },
    "Construction Materials": { INVIT: 0.15 },
    "Metals & Mining": { GOLD: 0.1, SILVER: 0.1 },
    Power: { INVIT: 0.1 },
  },

  mfSegmentToNseIndustry: {
    Realty: ["Realty"],
    "Financial Services": ["Financial Services"],
    Healthcare: ["Healthcare"],
    "Information Technology": ["Information Technology"],
    Automobile: ["Automobile and Auto Components"],
    Energy: ["Oil Gas & Consumable Fuels", "Power"],
    "FMCG & Consumption": ["Fast Moving Consumer Goods"],
  },

  mutualFundTopHoldings: {
    paragparikhflexicap: [
      { company: "HDFC Bank", weightPct: 7.5 },
      { company: "ICICI Bank", weightPct: 6.8 },
      { company: "ITC", weightPct: 5.2 },
      { company: "Axis Bank", weightPct: 4.1 },
      { company: "Bajaj Holdings", weightPct: 3.5 },
    ],
    hdfcflexicap: [
      { company: "HDFC Bank", weightPct: 8.9 },
      { company: "ICICI Bank", weightPct: 7.2 },
      { company: "State Bank of India", weightPct: 5.6 },
      { company: "Larsen & Toubro", weightPct: 4.3 },
      { company: "Axis Bank", weightPct: 3.8 },
    ],
    sbibluechip: [
      { company: "ICICI Bank", weightPct: 8.1 },
      { company: "HDFC Bank", weightPct: 7.4 },
      { company: "Reliance Industries", weightPct: 6.0 },
      { company: "Larsen & Toubro", weightPct: 4.5 },
      { company: "Infosys", weightPct: 4.0 },
    ],
    axisbluechip: [
      { company: "HDFC Bank", weightPct: 9.2 },
      { company: "ICICI Bank", weightPct: 8.0 },
      { company: "Infosys", weightPct: 6.1 },
      { company: "Reliance Industries", weightPct: 5.3 },
      { company: "Bajaj Finance", weightPct: 3.9 },
    ],
    miraeassetlargecap: [
      { company: "HDFC Bank", weightPct: 8.4 },
      { company: "ICICI Bank", weightPct: 7.6 },
      { company: "Reliance Industries", weightPct: 6.2 },
      { company: "Infosys", weightPct: 5.0 },
      { company: "Larsen & Toubro", weightPct: 4.2 },
    ],
    iciciprudentialbluechip: [
      { company: "HDFC Bank", weightPct: 8.7 },
      { company: "ICICI Bank", weightPct: 7.9 },
      { company: "Reliance Industries", weightPct: 5.8 },
      { company: "Infosys", weightPct: 4.6 },
      { company: "Larsen & Toubro", weightPct: 4.0 },
    ],
    nipponindialargecap: [
      { company: "HDFC Bank", weightPct: 8.2 },
      { company: "ICICI Bank", weightPct: 7.1 },
      { company: "Reliance Industries", weightPct: 5.9 },
      { company: "Infosys", weightPct: 4.4 },
      { company: "Larsen & Toubro", weightPct: 3.7 },
    ],
    quantactive: [
      { company: "Reliance Industries", weightPct: 8.5 },
      { company: "Jio Financial Services", weightPct: 6.3 },
      { company: "Cipla", weightPct: 4.8 },
    ],
  },
};
