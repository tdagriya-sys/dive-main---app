import { Schema, model, Document, Types } from "mongoose";

export interface IPreferences {
  risk: "Conservative" | "Balanced" | "Aggressive";
  returnExpectation: string;
  diversificationGoal: string;
  preferredCategories: string[];
  excludedCategories: string[];
}

export interface IPortfolioMeta {
  lastSyncedAt: Date | null;
  sources: string[];
}

// Divve Planner's inputs — kept purely as user-editable scratch state (no
// derived/computed fields), mirroring exactly what frontend/src/context/
// DiveContext.js's DEFAULT_PLANNER_STATE holds locally between saves.
export interface IPlannerState {
  mode: "lumpsum" | "sip" | null;
  lumpsumAmount: number;
  sipMonthly: number;
  sipStepUp: number;
  sipYears: number;
  sipExpandedMonthly: boolean;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  mobile: string;
  email: string;
  age: number;
  passwordHash: string;
  personalDetails: Record<string, unknown>;
  portfolio: IPortfolioMeta;
  preferences: IPreferences;
  plannerState: IPlannerState;
  // Guided in-app tour (frontend/src/components/Walkthrough.jsx) — set true
  // the first time the user finishes OR skips it, so it auto-starts exactly
  // once ever (not once per session/login), and never auto-starts again
  // unless they replay it themselves from the sidebar. Real account field,
  // not sessionStorage/localStorage, deliberately — see this field's own
  // changelog entry for why session-scoped storage wasn't durable enough.
  hasSeenWalkthrough: boolean;
  // Bumped by every holdings/AA-sync/age mutation — the exact same trigger
  // set as diveScoreService.ts's invalidateDiveScoreCache (see
  // paymentService.ts's invalidateReportPurchase, called alongside it at
  // every one of those call sites). Lets a paid resilience-score PDF
  // (models/Payment.ts) stay freely re-downloadable for as long as the
  // portfolio it was generated from hasn't changed, then requires a fresh
  // Rs. 99 purchase once it has — a stale report isn't what was paid for.
  portfolioVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const preferencesSchema = new Schema<IPreferences>(
  {
    risk: { type: String, enum: ["Conservative", "Balanced", "Aggressive"], default: "Balanced" },
    returnExpectation: { type: String, default: "Moderate" },
    diversificationGoal: { type: String, default: "High" },
    preferredCategories: { type: [String], default: [] },
    excludedCategories: { type: [String], default: [] },
  },
  { _id: false }
);

const portfolioMetaSchema = new Schema<IPortfolioMeta>(
  {
    lastSyncedAt: { type: Date, default: null },
    sources: { type: [String], default: [] },
  },
  { _id: false }
);

// Defaults here must match DEFAULT_PLANNER_STATE in DiveContext.js exactly —
// they're what a brand-new account (and every pre-existing account that
// predates this field — Mongoose applies schema defaults on read for any
// path missing from the stored document, not just at creation) starts from.
const plannerStateSchema = new Schema<IPlannerState>(
  {
    mode: { type: String, enum: ["lumpsum", "sip", null], default: null },
    lumpsumAmount: { type: Number, default: 50000 },
    sipMonthly: { type: Number, default: 5000 },
    sipStepUp: { type: Number, default: 10 },
    sipYears: { type: Number, default: 10 },
    sipExpandedMonthly: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    age: { type: Number, required: true, min: 18 },
    passwordHash: { type: String, required: true },
    personalDetails: { type: Schema.Types.Mixed, default: {} },
    portfolio: { type: portfolioMetaSchema, default: () => ({ lastSyncedAt: null, sources: [] }) },
    preferences: { type: preferencesSchema, default: () => ({}) },
    plannerState: { type: plannerStateSchema, default: () => ({}) },
    hasSeenWalkthrough: { type: Boolean, default: false },
    portfolioVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
