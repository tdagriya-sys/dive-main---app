import { z } from "zod";
import { highlightStyleSchema } from "./adminSetting";

export const startSubscriptionSchema = z.object({
  planKey: z.string().trim().toLowerCase().min(1),
  couponCode: z.string().trim().toUpperCase().min(1).optional(),
});

export const startTrialSchema = z.object({
  planKey: z.string().trim().toLowerCase().min(1),
});

export const verifySubscriptionSchema = z.object({
  planKey: z.string().trim().toLowerCase().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_subscription_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  couponCode: z.string().trim().toUpperCase().min(1).optional(),
});

export const validateCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(1),
  planKey: z.string().trim().toLowerCase().min(1),
});

export const cancelSubscriptionSchema = z.object({
  atPeriodEnd: z.boolean().optional().default(true),
  // Opt-in only — skips the deferred cancel-notice buffer and tells Razorpay
  // right away instead. Once that succeeds, reactivate can no longer
  // honestly restore auto-billing for this cycle (see
  // subscriptionService.ts::reactivateSubscription).
  notifyRazorpayNow: z.boolean().optional().default(false),
});

const entitlementsSchema = z.object({
  botScanWeekly: z.number().int().nullable(),
  botScanMonthly: z.number().int().nullable(),
  docUploadWeekly: z.number().int().nullable(),
  docUploadMonthly: z.number().int().nullable(),
  portfolioEditWeekly: z.number().int().nullable(),
  portfolioEditMonthly: z.number().int().nullable(),
  dailyRevaluation: z.boolean(),
  earlyAccess: z.boolean(),
  priorityWeight: z.number().int().min(0).max(10),
  // Optional (default 0 — no complimentary benefit) so existing plan-create
  // callers that predate this field keep working unchanged.
  complimentaryReportDownloads: z.number().int().min(0).nullable().optional().default(0),
});

const PLAN_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

// Short marketing bullets shown on the plan card (Subscription.jsx) — kept
// separate from `description` (a one-line tagline that's existed since
// Phase 6a but was never actually rendered anywhere).
const benefitsSchema = z.array(z.string().trim().min(1).max(120)).max(20);

export const createPlanSchema = z.object({
  key: z.string().trim().toLowerCase().regex(PLAN_KEY_REGEX, "Lowercase letters, digits and underscores only, starting with a letter"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  benefits: benefitsSchema.optional(),
  pricePaise: z.coerce.number().int().min(0),
  interval: z.enum(["month", "year", "one_time"]),
  trialDays: z.coerce.number().int().min(0).max(365).optional().default(0),
  entitlements: entitlementsSchema,
  visibility: z.enum(["public", "hidden", "legacy"]).optional().default("public"),
  displayOrder: z.coerce.number().int().optional().default(0),
});

export const updatePlanSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  benefits: benefitsSchema.optional(),
  trialDays: z.coerce.number().int().min(0).max(365).optional(),
  entitlements: entitlementsSchema.partial().optional(),
  isActive: z.boolean().optional(),
  visibility: z.enum(["public", "hidden", "legacy"]).optional(),
  displayOrder: z.coerce.number().int().optional(),
  // Pairs this plan with its Monthly/Annual counterpart (see
  // SubscriptionPlan.ts's own comment on linkedPlanKey) — a plan key to
  // link, or `null` to unlink. Omitted entirely leaves the link untouched.
  linkedPlanKey: z.string().trim().toLowerCase().min(1).nullable().optional(),
});

export const adminChangePlanSchema = z.object({
  planKey: z.string().trim().toLowerCase().min(1),
});

// Accepts either the real Mongo _id or an email address — the admin grant
// form's autocomplete fills this with whichever the staff member picked/
// typed (see admin/screens/Subscriptions.jsx's GrantForm).
export const grantSubscriptionSchema = z.object({
  userIdOrEmail: z.string().trim().min(1),
  planKey: z.string().trim().toLowerCase().min(1),
  days: z.coerce.number().int().min(1).max(3650),
});

export const usageGrantSchema = z.object({
  userIdOrEmail: z.string().trim().min(1),
  key: z.enum(["bot_scan", "doc_upload", "portfolio_edit", "score_report"]),
  bonusWeekly: z.coerce.number().int().min(0).max(100000).optional().default(0),
  bonusMonthly: z.coerce.number().int().min(0).max(100000).optional().default(0),
  // "score_report" only — see UsageGrant.ts's own comment on bonusTotal.
  bonusTotal: z.coerce.number().int().min(0).max(1000).optional().default(0),
});

const COUPON_CODE_REGEX = /^[A-Z0-9_-]+$/;
const couponEligibilitySchema = z.enum(["any", "new_user", "first_time", "renewal"]);
// Forward-looking only — changing this after creation never touches a
// subscription that already redeemed the code (its Razorpay-side plan and
// revert decision were already locked in at redemption time — see
// subscriptionService.ts::startSubscription/revertToFullPriceIfOneTimeCoupon),
// it only affects the NEXT person who redeems it.
const couponDiscountDurationSchema = z.enum(["once", "recurring"]);

export const createCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30).regex(COUPON_CODE_REGEX, "Letters, digits, hyphens and underscores only"),
  type: z.enum(["percent", "flat"]),
  value: z.coerce.number().int().min(1),
  appliesToPlanKeys: z.array(z.string().trim().toLowerCase()).optional().default([]),
  eligibility: couponEligibilitySchema.optional().default("any"),
  discountDuration: couponDiscountDurationSchema.optional().default("recurring"),
  maxRedemptions: z.coerce.number().int().min(1).optional(),
  maxRedemptionsPerUser: z.coerce.number().int().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const updateCouponSchema = z.object({
  appliesToPlanKeys: z.array(z.string().trim().toLowerCase()).optional(),
  eligibility: couponEligibilitySchema.optional(),
  discountDuration: couponDiscountDurationSchema.optional(),
  maxRedemptions: z.coerce.number().int().min(1).optional(),
  maxRedemptionsPerUser: z.coerce.number().int().min(1).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const refundPaymentSchema = z.object({
  amountPaise: z.coerce.number().int().min(1).optional(),
});

// Admin-editable resilience-report PDF pricing (adminSettingService.ts::
// setReportPricing) — originalPricePaise is the purely cosmetic
// struck-through "was" price; null/omitted means don't show one.
export const reportPricingSchema = z.object({
  pricePaise: z.coerce.number().int().min(0),
  originalPricePaise: z.coerce.number().int().min(0).nullable().optional(),
});

// Admin-editable renewal/expiry reminder timing + message templates
// (adminSettingService.ts::setRenewalReminderSettings). `daysBefore` is a
// list of independent thresholds (e.g. [7, 3, 0], each firing its own
// reminder) — 0 is allowed (the day it happens), capped at 30 so a
// misconfigured value can't push a reminder past a typical billing cycle,
// and capped at 10 entries so one subscription can't send a notification
// storm. Each message template is capped generously — these render as
// in-app + email copy, not a raw DB value. `title`/`body` support
// `**bold**` and `==highlighted==` spans; `highlightStyle` is this
// message's own accent styling for `==highlighted==` (see
// models/AdminSetting.ts::IRenewalReminderMessage).
const reminderMessageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  highlightStyle: highlightStyleSchema,
});

export const renewalReminderSettingsSchema = z.object({
  daysBefore: z.array(z.coerce.number().int().min(0).max(30)).min(1).max(10),
  // Off by default (see AdminSetting.ts::IRenewalReminderValue's own
  // comment) — requests the one-time popup-card channel on top of the
  // always-on in-app+email delivery.
  enablePopup: z.boolean().optional().default(false),
  messages: z.object({
    trialEnding: reminderMessageSchema,
    renewal: reminderMessageSchema,
    accessEnding: reminderMessageSchema,
  }),
});
