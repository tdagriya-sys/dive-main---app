import { Schema, model, Document, Types } from "mongoose";
import { AssetClass } from "./Instrument";
import { ConfigStatus } from "./ScoringConfig";

/**
 * Versioned, admin-editable Layer D "Context Engine" (Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md) — corpus tiers (how many asset classes it's
 * sensible to expect given the portfolio size) and persona brackets (which
 * classes, and which risk-capacity thresholds, given the user's age). See
 * services/config/contextDefaults.ts for the exact values extracted from the
 * old hardcoded contextEngine.ts.
 */
export interface CorpusTierPayload {
  id: string;
  label: string;
  maxAmount: number; // Infinity for the top tier — stored as a large sentinel, see contextDefaults.ts
  expectedClassCount: number;
  reasoning: string;
}

export interface PersonaBracketPayload {
  id: string;
  label: string;
  minAge: number;
  maxAge: number | null; // null = no upper bound
  priorityClasses: AssetClass[];
  deprioritizedClasses: AssetClass[];
  volatilityWorstAt: number;
  drawdownWorstAt: number;
  reasoning: string;
}

export interface ContextConfigPayload {
  corpusTiers: CorpusTierPayload[];
  personaBrackets: PersonaBracketPayload[];
  defaultClassOrder: AssetClass[];
}

export interface IContextConfig extends Document {
  _id: Types.ObjectId;
  version: number;
  status: ConfigStatus;
  parentVersion?: number;
  payload: ContextConfigPayload;
  changeNote?: string;
  createdBy?: Types.ObjectId;
  publishedBy?: Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const contextConfigSchema = new Schema<IContextConfig>(
  {
    version: { type: Number, required: true, index: true },
    status: { type: String, enum: ["draft", "active", "archived"], required: true, index: true },
    parentVersion: { type: Number },
    payload: {
      corpusTiers: { type: Schema.Types.Mixed, required: true },
      personaBrackets: { type: Schema.Types.Mixed, required: true },
      defaultClassOrder: { type: [String], required: true },
    },
    changeNote: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

contextConfigSchema.index({ status: 1, version: -1 });

export const ContextConfig = model<IContextConfig>("ContextConfig", contextConfigSchema);
