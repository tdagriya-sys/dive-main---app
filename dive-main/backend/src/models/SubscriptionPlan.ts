import { Schema, model, Document, Types } from "mongoose";

export type PlanInterval = "month" | "year" | "one_time";
export type PlanVisibility = "public" | "hidden" | "legacy";

// The boolean/limit surface a plan grants (Phase 6a of
// docs/ADMIN_PANEL_PLAN.md §3). `botScanWeekly`/`botScanMonthly` etc. are
// BOTH checked by `usageService.ts::checkLimits` — "whichever is reached
// first blocks" (§3.4) — `null` means unlimited (Premium's portfolio-edit
// row). `earlyAccess` is a forward-compat hook for Phase 7's FeatureFlag
// UI — no real feature reads it yet, same "the hook is there" posture the
// plan itself calls for (§3.5).
export interface IPlanEntitlements {
  botScanWeekly: number | null;
  botScanMonthly: number | null;
  docUploadWeekly: number | null;
  docUploadMonthly: number | null;
  portfolioEditWeekly: number | null;
  portfolioEditMonthly: number | null;
  dailyRevaluation: boolean;
  earlyAccess: boolean;
  priorityWeight: number; // added to a ticket's category-default priority rank — see ticketService.ts's own comment
  // How many times a subscriber on this plan can unlock the resilience-score
  // PDF for free before paying again — see paymentService.ts::
  // ensureReportAccess. Counts distinct portfolio-version unlocks, NOT
  // downloads: re-downloading the same already-unlocked report never
  // consumes this, only a portfolio change that would otherwise re-trigger
  // payment does. `null` = unlimited complimentary downloads on this plan;
  // `0` (the default for every existing plan) = no complimentary benefit,
  // same as today's Rs.99-every-time behavior.
  complimentaryReportDownloads: number | null;
}

export interface ISubscriptionPlan extends Document {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  benefits: string[];
  pricePaise: number;
  interval: PlanInterval;
  trialDays: number;
  entitlements: IPlanEntitlements;
  razorpayPlanId?: string;
  isActive: boolean;
  visibility: PlanVisibility;
  displayOrder: number;
  // Admin-set pairing with the OTHER billing interval of what's otherwise
  // the same premium tier (e.g. this plan's Annual counterpart) — see
  // plansController.ts::updatePlan for how linking is kept symmetric
  // (always set/cleared on both plans together, never just one). Purely a
  // display hint: `key` of the linked plan (never this plan's own key,
  // never a "one_time" plan). Subscription.jsx uses it to render the pair
  // as ONE card with a Monthly/Annual toggle instead of two separate cards.
  // `undefined`/unset = not linked to anything, shown as its own card.
  linkedPlanKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const entitlementsSchema = new Schema<IPlanEntitlements>(
  {
    botScanWeekly: { type: Number, default: null },
    botScanMonthly: { type: Number, default: null },
    docUploadWeekly: { type: Number, default: null },
    docUploadMonthly: { type: Number, default: null },
    portfolioEditWeekly: { type: Number, default: null },
    portfolioEditMonthly: { type: Number, default: null },
    dailyRevaluation: { type: Boolean, default: false },
    earlyAccess: { type: Boolean, default: false },
    priorityWeight: { type: Number, default: 0 },
    complimentaryReportDownloads: { type: Number, default: 0 },
  },
  { _id: false }
);

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    // Short marketing bullets rendered on the plan card (Subscription.jsx),
    // admin-editable from Subscriptions.jsx's Plans tab.
    benefits: { type: [String], default: [] },
    pricePaise: { type: Number, required: true, min: 0 },
    interval: { type: String, enum: ["month", "year", "one_time"], required: true },
    trialDays: { type: Number, default: 0 },
    entitlements: { type: entitlementsSchema, required: true },
    razorpayPlanId: { type: String },
    isActive: { type: Boolean, default: true },
    visibility: { type: String, enum: ["public", "hidden", "legacy"], default: "public" },
    displayOrder: { type: Number, default: 0 },
    linkedPlanKey: { type: String },
  },
  { timestamps: true }
);

export const SubscriptionPlan = model<ISubscriptionPlan>("SubscriptionPlan", subscriptionPlanSchema);
