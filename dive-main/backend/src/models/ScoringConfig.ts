import { Schema, model, Document, Types } from "mongoose";
import { ASSET_CLASSES, AssetClass } from "./Instrument";

/**
 * Versioned, admin-editable Dive Score model (Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md). Every field here corresponds 1:1 to a value that
 * used to be a hardcoded constant in diveScoreService.ts — see
 * services/config/scoringDefaults.ts for the exact extracted defaults, which
 * make this admin-configurable system behave byte-identically to the old
 * hardcoded one until someone actually publishes a change.
 *
 * Deliberately NOT included (kept as plain code) — each for a different
 * reason:
 *  - `scoreLabel`/`scoreColor` band thresholds — presentation, not a scoring
 *    input — and the VaR monthly-scaling constant (`sqrt(21)`, a statistical
 *    convention, not a tunable weight.
 *  - `SYNTHETIC_PARAMS` (per-asset-class drift/vol/beta assumptions used when
 *    no real price history exists) — deferred to a follow-up increment: these
 *    live inside priceHistoryService.ts's cached synthetic-series generator,
 *    not diveScoreService.ts's pure post-processing formulas, so making them
 *    configurable is a materially different (and riskier — cache/determinism
 *    sensitive) refactor from everything else in this file.
 *
 * Lifecycle: draft -> validate -> simulate -> publish (draft becomes the new
 * "active", the previous "active" becomes "archived") -> rollback (re-publish
 * an archived version as a new version). See services/config/scoringConfigService.ts.
 */
export type ConfigStatus = "draft" | "active" | "archived";

export interface CompositeWeights {
  concentration: number;
  volatility: number;
  drawdown: number;
  var: number;
  liquidity: number;
  beta: number;
  correlation: number;
  diversificationRatio: number;
  contextFit: number;
  stockCountFit: number;
}

export interface ScoringConfigPayload {
  compositeWeights: CompositeWeights;
  // The persona-dependent "worst" ends (volatility/drawdown) live in
  // ContextConfig's personaBrackets instead — these are the personas-
  // independent "best" ends plus every other sub-score's full range.
  subScoreBestAt: {
    volatilityBestAt: number;
    drawdownBestAt: number;
    varWorstAt: number;
    varBestAt: number;
    betaWorstAt: number;
    betaBestAt: number;
    correlationWorstAt: number;
    correlationBestAt: number;
    diversificationRatioWorstAt: number;
    diversificationRatioBestAt: number;
  };
  concentrationSubWeights: {
    apparent: number;
    real: number;
    name: number;
    withinClass: number;
  };
  liquidityTiers: Record<AssetClass, number>;
  stockCountBreakpoints: Array<[count: number, score: number]>;
  cryptoWithinClassCap: number;
  equitySectorSpreadTarget: number;
  singleClassCorrelationScores: {
    whenExpectedClassesLE1: number;
    otherwise: number;
  };
  drawdownUnrecoveredPenalty: number;
}

export interface IScoringConfig extends Document {
  _id: Types.ObjectId;
  version: number;
  status: ConfigStatus;
  parentVersion?: number;
  payload: ScoringConfigPayload;
  changeNote?: string;
  createdBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const scoringConfigSchema = new Schema<IScoringConfig>(
  {
    version: { type: Number, required: true, index: true },
    status: { type: String, enum: ["draft", "active", "archived"], required: true, index: true },
    parentVersion: { type: Number },
    payload: {
      // Mixed (plain object), not a nested Schema — a real Mongoose
      // sub-schema here made every non-lean document's `.payload.
      // compositeWeights` a Mongoose subdocument, which Jest's `toEqual`
      // can't deep-compare (throws on `arguments`/`caller` property access in
      // strict mode) — found live while testing the config lifecycle. Every
      // other payload field was already Mixed for the same "always read/
      // written as one JSON blob, never queried by a subfield" reason; this
      // just makes compositeWeights consistent with the rest instead of
      // being the one exception.
      compositeWeights: { type: Schema.Types.Mixed, required: true },
      subScoreBestAt: { type: Schema.Types.Mixed, required: true },
      concentrationSubWeights: { type: Schema.Types.Mixed, required: true },
      liquidityTiers: { type: Schema.Types.Mixed, required: true },
      stockCountBreakpoints: { type: [[Number]], required: true },
      cryptoWithinClassCap: { type: Number, required: true },
      equitySectorSpreadTarget: { type: Number, required: true },
      singleClassCorrelationScores: { type: Schema.Types.Mixed, required: true },
      drawdownUnrecoveredPenalty: { type: Number, required: true },
    },
    changeNote: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

scoringConfigSchema.index({ status: 1, version: -1 });

export const ScoringConfig = model<IScoringConfig>("ScoringConfig", scoringConfigSchema);
export { ASSET_CLASSES };
