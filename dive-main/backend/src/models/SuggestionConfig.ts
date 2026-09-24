import { Schema, model, Document, Types } from "mongoose";
import { ConfigStatus } from "./ScoringConfig";

/**
 * Versioned, admin-editable Suggestion layer (Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md) — the ideal allocation ranges per risk profile,
 * plus the personalization knobs `frontend/src/lib/diveEngine.js` uses to
 * re-rank/annotate suggestions. See services/config/suggestionDefaults.ts for
 * the exact values extracted from the old hardcoded diveEngine.js constants.
 *
 * `diversificationCap`'s "uncapped" tier (`High` today) is stored as `null`,
 * not `Infinity` (not valid JSON) — see suggestionConfigService.ts's
 * (de)serialization.
 */
export interface SuggestionConfigPayload {
  coreCategories: string[];
  idealRanges: Record<"Conservative" | "Balanced" | "Aggressive", Record<string, [number, number]>>;
  returnTier: Record<string, "low" | "medium" | "high">;
  returnBias: Record<"Modest" | "Moderate" | "High", number>;
  diversificationCap: Record<"Low" | "Medium" | "High", number | null>;
  fastPathBlend: { apparent: number; real: number; name: number };
}

export interface ISuggestionConfig extends Document {
  _id: Types.ObjectId;
  version: number;
  status: ConfigStatus;
  parentVersion?: number;
  payload: SuggestionConfigPayload;
  changeNote?: string;
  createdBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const suggestionConfigSchema = new Schema<ISuggestionConfig>(
  {
    version: { type: Number, required: true, index: true },
    status: { type: String, enum: ["draft", "active", "archived"], required: true, index: true },
    parentVersion: { type: Number },
    payload: {
      coreCategories: { type: [String], required: true },
      idealRanges: { type: Schema.Types.Mixed, required: true },
      returnTier: { type: Schema.Types.Mixed, required: true },
      returnBias: { type: Schema.Types.Mixed, required: true },
      diversificationCap: { type: Schema.Types.Mixed, required: true },
      fastPathBlend: { type: Schema.Types.Mixed, required: true },
    },
    changeNote: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

suggestionConfigSchema.index({ status: 1, version: -1 });

export const SuggestionConfig = model<ISuggestionConfig>("SuggestionConfig", suggestionConfigSchema);
