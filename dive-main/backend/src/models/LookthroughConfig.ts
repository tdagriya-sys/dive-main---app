import { Schema, model, Document, Types } from "mongoose";
import { AssetClass } from "./Instrument";
import { ConfigStatus } from "./ScoringConfig";

/**
 * Versioned, admin-editable Look-Through / Connectedness model (§7 of
 * docs/DIVE_SCORE_MODEL.md) — the tier strengths and curated affinity maps
 * `lookthroughService.ts` uses to detect shared-risk-factor overlap between
 * holdings (same-sector, exact-issuer, mutual-fund top-holdings, keyword and
 * broad-industry affinity, sectoral-fund-to-equity). This was explicitly
 * scoped OUT of Phase 2 of docs/ADMIN_PANEL_PLAN.md (§1.1: "a plausible
 * future extension, not yet built") — this is that extension, built as a
 * fourth sibling to ScoringConfig/ContextConfig/SuggestionConfig, same
 * draft -> validate -> simulate -> publish -> rollback lifecycle.
 *
 * See services/config/lookthroughDefaults.ts for the exact values extracted
 * verbatim from the old hardcoded `seed/sectorAffinity.ts` and
 * `seed/mutualFundTopHoldings.ts` (both deleted once extracted, matching how
 * Phase 2 retired the equivalent hardcoded constants elsewhere).
 *
 * Deliberately NOT included (same "formulas/structure stay code" boundary
 * ScoringConfig.ts draws for SYNTHETIC_PARAMS): `MUTUAL_FUND_SEGMENT_KEYWORDS`
 * (seed/mutualFundSegments.ts) — that table tags a mutual fund instrument's
 * `.sector` at INGESTION time (instrumentSources.ts), not at scoring-query
 * time the way every field below is read; making it admin-configurable is a
 * materially different change (instrument re-classification, not a scoring
 * input) and out of scope here.
 */
export interface KeywordAffinityPayload {
  keywords: string[]; // matched case-insensitively as substrings of the holding name
  affinity: Partial<Record<AssetClass, number>>;
}

export interface FundHoldingPayload {
  company: string; // matched against equity holding names via normalizeIssuer()
  weightPct: number;
}

export interface LookthroughConfigPayload {
  // Was the inline literal `1` in lookthroughService.ts::connectionBetween's
  // exact-issuer-match branch — full overlap, the strongest tier.
  exactIssuerStrength: number;
  // Was SAME_SECTOR_STRENGTH = 0.3 (lookthroughService.ts) — two distinct
  // companies, same broad sector, same asset class.
  sameSectorStrength: number;
  // Was SECTORAL_MF_AFFINITY_STRENGTH = 0.15 (seed/sectorAffinity.ts) —
  // deliberately below sameSectorStrength (see that file's own comment: a
  // sectoral fund spreads its bet across many companies, not just the one
  // you also hold directly).
  sectoralMfAffinityStrength: number;
  keywordSectorAffinity: KeywordAffinityPayload[]; // was KEYWORD_SECTOR_AFFINITY
  industryAssetClassAffinity: Record<string, Partial<Record<AssetClass, number>>>; // was INDUSTRY_ASSET_CLASS_AFFINITY
  mfSegmentToNseIndustry: Record<string, string[]>; // was MF_SEGMENT_TO_NSE_INDUSTRY
  mutualFundTopHoldings: Record<string, FundHoldingPayload[]>; // was MUTUAL_FUND_TOP_HOLDINGS
}

export interface ILookthroughConfig extends Document {
  _id: Types.ObjectId;
  version: number;
  status: ConfigStatus;
  parentVersion?: number;
  payload: LookthroughConfigPayload;
  changeNote?: string;
  createdBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const lookthroughConfigSchema = new Schema<ILookthroughConfig>(
  {
    version: { type: Number, required: true, index: true },
    status: { type: String, enum: ["draft", "active", "archived"], required: true, index: true },
    parentVersion: { type: Number },
    payload: {
      // Every field Mixed, even the plain numbers — matches ScoringConfig.ts's
      // own convention (a real nested sub-schema turns a lean-less
      // `.payload.foo` into a Mongoose subdocument, which breaks Jest's
      // toEqual deep-compare).
      exactIssuerStrength: { type: Schema.Types.Mixed, required: true },
      sameSectorStrength: { type: Schema.Types.Mixed, required: true },
      sectoralMfAffinityStrength: { type: Schema.Types.Mixed, required: true },
      keywordSectorAffinity: { type: Schema.Types.Mixed, required: true },
      industryAssetClassAffinity: { type: Schema.Types.Mixed, required: true },
      mfSegmentToNseIndustry: { type: Schema.Types.Mixed, required: true },
      mutualFundTopHoldings: { type: Schema.Types.Mixed, required: true },
    },
    changeNote: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

lookthroughConfigSchema.index({ status: 1, version: -1 });

export const LookthroughConfig = model<ILookthroughConfig>("LookthroughConfig", lookthroughConfigSchema);
