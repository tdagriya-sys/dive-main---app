import { Schema, model, Document, Types } from "mongoose";

/**
 * Gradual-rollout / early-access flag (Phase 7 of docs/ADMIN_PANEL_PLAN.md
 * §4.6/§11 — "Feature flags / gradual rollout... powers Premium early
 * access"). Resolution order (see services/featureFlagService.ts):
 * `enabled:false` always wins (off for everyone) → an explicit per-user or
 * per-plan allowlist entry always wins next → otherwise `rolloutPct` decides
 * via a deterministic hash of `(key, userId)`, so the same user always lands
 * on the same side of a given flag instead of flapping between requests.
 */
export interface IFeatureFlag extends Document {
  _id: Types.ObjectId;
  key: string;
  description?: string;
  enabled: boolean;
  rolloutPct: number; // 0-100
  enabledForUserIds: Types.ObjectId[];
  enabledForPlanKeys: string[];
  updatedBy?: string; // staff email, denormalised same as AuditLog.actorLabel
  createdAt: Date;
  updatedAt: Date;
}

const featureFlagSchema = new Schema<IFeatureFlag>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    enabled: { type: Boolean, default: false },
    rolloutPct: { type: Number, default: 0, min: 0, max: 100 },
    enabledForUserIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    enabledForPlanKeys: { type: [String], default: [] },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

export const FeatureFlag = model<IFeatureFlag>("FeatureFlag", featureFlagSchema);
