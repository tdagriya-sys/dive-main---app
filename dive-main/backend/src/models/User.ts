import { Schema, model, Document, Types } from "mongoose";

// Staff / admin panel fields (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md). `null`
// (the overwhelming majority of accounts) means "an ordinary Divve user" —
// nothing below this comment is ever populated or read for them.
export type StaffRoleField = "superadmin" | "admin" | "employee" | null;
export type UserStatus = "active" | "suspended" | "deleted";

export interface IStaffMeta {
  // Base32 TOTP secret (otplib). Deliberately stored in plaintext, same
  // trust-boundary-is-the-database posture this app already takes with every
  // other credential-adjacent secret (Razorpay/OpenAI/Anthropic keys in env,
  // OTPs in the Otp collection) — revisit with envelope encryption if a
  // dedicated secrets store is ever introduced.
  totpSecret?: string;
  totpEnabled: boolean;
  totpEnrolledAt?: Date;
  // bcrypt hashes of one-time recovery codes, shown to the staff member ONCE
  // at enrolment — same hashing convention as passwordHash. A matched code is
  // spliced out of this array (single use).
  recoveryCodeHashes: string[];
  lastAdminLoginAt?: Date;
  invitedBy?: Types.ObjectId;
  invitedAt?: Date;
  acceptedAt?: Date;
}

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
  // purchase (or a fresh complimentary unlock, if one's still available —
  // see paymentService.ts::ensureReportAccess) once it has — a stale report
  // isn't what was paid for.
  portfolioVersion: number;
  // Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.2/§3.4 — the one-time trial
  // opportunity is gone, for either of two reasons (see
  // `trialForfeitedWithoutClaim` below for which one): the user explicitly
  // started a free trial (startFreeTrial), or they subscribed directly
  // without ever claiming one (verifySubscriptionPayment always tags this
  // case — a direct paid subscribe never folds in a trial, so it "spends"
  // the opportunity by skipping it, not by using it). Either way this stops
  // the "Start free trial" button from reappearing, and a
  // subscribe→cancel→resubscribe loop can't be used to keep re-granting it.
  // Never cleared once true, except by an admin's explicit regrant
  // (`POST /admin/users/:id/trial/reset`).
  hasUsedTrial: boolean;
  // Distinguishes WHY hasUsedTrial became true, for the admin Trials tab:
  // true = the user subscribed directly and skipped the free trial
  // entirely (never claimed one); false = they actually claimed and used a
  // real trial (or hasUsedTrial is still false and this is moot). Reset to
  // false alongside hasUsedTrial whenever an admin regrants the trial, and
  // re-set correctly the next time either path fires again.
  trialForfeitedWithoutClaim: boolean;
  // Set the moment a user's very first EVER portfolio_edit session opens
  // (usageService.ts::enforceEditSessionUsage) — their first-ever "build my
  // portfolio" trip is deliberately free, so the plan limit only starts
  // counting from the SECOND session onward. Never cleared once true, same
  // one-way posture as hasUsedTrial.
  hasCompletedFirstPortfolioEdit: boolean;
  // Staff / admin panel — see IStaffMeta's own comment. `staffRole: null` and
  // `status: "active"` (the schema defaults) describe every pre-existing and
  // every newly-signed-up ordinary user; nothing here changes their behavior
  // or is exposed to them.
  staffRole: StaffRoleField;
  roleId?: Types.ObjectId; // ref Role — only meaningful when staffRole === "employee"
  status: UserStatus;
  staffMeta: IStaffMeta;
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

const staffMetaSchema = new Schema<IStaffMeta>(
  {
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    totpEnrolledAt: { type: Date },
    recoveryCodeHashes: { type: [String], default: [] },
    lastAdminLoginAt: { type: Date },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    invitedAt: { type: Date },
    acceptedAt: { type: Date },
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
    hasUsedTrial: { type: Boolean, default: false },
    trialForfeitedWithoutClaim: { type: Boolean, default: false },
    hasCompletedFirstPortfolioEdit: { type: Boolean, default: false },
    staffRole: { type: String, enum: ["superadmin", "admin", "employee", null], default: null, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: "Role" },
    status: { type: String, enum: ["active", "suspended", "deleted"], default: "active", index: true },
    staffMeta: { type: staffMetaSchema, default: () => ({ totpEnabled: false, recoveryCodeHashes: [] }) },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
