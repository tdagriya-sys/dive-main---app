import { Types } from "mongoose";
import { Subscription, ISubscription } from "../models/Subscription";
import { SubscriptionPlan, ISubscriptionPlan, IPlanEntitlements } from "../models/SubscriptionPlan";
import { ApiError } from "../middleware/errorHandler";

/**
 * The one place that answers "what plan is this user on, and what does that
 * plan grant them" (Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.5). Every other
 * enforcement point — `usageService.ts`'s `enforceEditSessionUsage`,
 * `holdingValuationService.ts`'s Premium-only revaluation,
 * `ticketService.ts`'s priority boost, and the frontend via
 * `GET /api/me/entitlements` — reads through this, never `Subscription`
 * directly, so the definition of "what counts as Premium" lives in exactly
 * one place.
 */

export const FREEMIUM_KEY = "freemium";

export const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    key: FREEMIUM_KEY,
    name: "Freemium",
    description: "Everything you need to get started, free forever.",
    benefits: [
      "Real-time Dive Score on your first sync",
      "1 bot scan/week, 1 doc upload/week",
      "2 portfolio edits/week",
      "Full X-Ray & diversification breakdown",
    ],
    pricePaise: 0,
    interval: "one_time" as const,
    trialDays: 0,
    isActive: true,
    visibility: "public" as const,
    displayOrder: 0,
    entitlements: {
      botScanWeekly: 1,
      botScanMonthly: 3,
      docUploadWeekly: 1,
      docUploadMonthly: 3,
      portfolioEditWeekly: 2,
      portfolioEditMonthly: 5,
      dailyRevaluation: false,
      earlyAccess: false,
      priorityWeight: 0,
      complimentaryReportDownloads: 0,
    },
  },
  {
    key: "premium_monthly",
    name: "Premium (Monthly)",
    description: "Unlimited edits, daily-updated scores, and priority support.",
    benefits: [
      "Unlimited portfolio edits",
      "Daily-updated Dive Score (no manual refresh)",
      "10 bot scans & doc uploads/month",
      "Priority support",
      "Early access to new features",
      "15-day free trial",
    ],
    pricePaise: 11900,
    interval: "month" as const,
    trialDays: 15,
    isActive: true,
    visibility: "public" as const,
    displayOrder: 1,
    entitlements: {
      botScanWeekly: 3,
      botScanMonthly: 10,
      docUploadWeekly: 3,
      docUploadMonthly: 10,
      portfolioEditWeekly: null,
      portfolioEditMonthly: null,
      dailyRevaluation: true,
      earlyAccess: true,
      priorityWeight: 2,
      complimentaryReportDownloads: 0,
    },
  },
  {
    key: "premium_annual",
    name: "Premium (Annual)",
    description: "Unlimited edits, daily-updated scores, and priority support — ~23% cheaper than monthly.",
    benefits: [
      "Everything in Premium Monthly",
      "~23% cheaper than paying monthly",
      "One annual charge, no monthly reminders",
      "15-day free trial",
    ],
    pricePaise: 109900,
    interval: "year" as const,
    trialDays: 15,
    isActive: true,
    visibility: "public" as const,
    displayOrder: 2,
    entitlements: {
      botScanWeekly: 3,
      botScanMonthly: 10,
      docUploadWeekly: 3,
      docUploadMonthly: 10,
      portfolioEditWeekly: null,
      portfolioEditMonthly: null,
      dailyRevaluation: true,
      earlyAccess: true,
      priorityWeight: 2,
      complimentaryReportDownloads: 0,
    },
  },
];

// Mirrors index.ts's established "seed if empty" convention (Instrument,
// TicketCategory, NotificationCategory). Every pre-existing account is
// Freemium the instant this collection exists — see Subscription.ts's own
// comment on why that needs no migration script: "no Subscription row" IS
// Freemium, by construction of getActiveSubscription below.
export async function seedDefaultSubscriptionPlansIfEmpty(): Promise<void> {
  const count = await SubscriptionPlan.countDocuments();
  if (count > 0) return;
  await SubscriptionPlan.insertMany(DEFAULT_SUBSCRIPTION_PLANS);
}

// Backfill for `complimentaryReportDownloads`, added to IPlanEntitlements
// after plans already existed in real deployments — Mongoose's schema
// `default: 0` only applies to documents created/saved AFTER the field was
// added, never retroactively to ones already persisted, so an existing
// plan's `entitlements.complimentaryReportDownloads` reads back as
// `undefined` until touched. paymentService.ts::ensureReportAccess treats
// undefined defensively as 0 regardless (see its own comment on why that
// matters — this was caught live: `undefined + bonus` is `NaN`, and
// `count >= NaN` is always false, silently granting unlimited free
// downloads), but this backfill makes the stored data itself consistent —
// idempotent, cheap, safe to run on every boot (mirrors index.ts's existing
// "seed if empty" pattern for Instrument/TicketCategory/NotificationCategory,
// just an update instead of an insert).
export async function backfillMissingComplimentaryReportDownloads(): Promise<void> {
  await SubscriptionPlan.updateMany({ "entitlements.complimentaryReportDownloads": { $exists: false } }, { $set: { "entitlements.complimentaryReportDownloads": 0 } });
}

export type PopulatedSubscription = Omit<ISubscription, "planId"> & { planId: ISubscriptionPlan };

// The only definition of "still has Premium access right now" — trialing/
// active/past_due (a short grace period while a payment issue is being
// retried — Razorpay's own "halted" lifecycle) all count, cancelled/expired
// don't. Also requires currentPeriodEnd hasn't already passed, so a row
// that hasn't been transitioned to "expired" yet by a delayed webhook still
// correctly stops granting access the moment its paid-for period ends.
export async function getActiveSubscription(userId: string): Promise<PopulatedSubscription | null> {
  const subscription = await Subscription.findOne({
    userId,
    status: { $in: ["trialing", "active", "past_due"] },
    currentPeriodEnd: { $gte: new Date() },
  })
    .sort({ currentPeriodEnd: -1 })
    .populate<{ planId: ISubscriptionPlan }>("planId");
  return subscription as unknown as PopulatedSubscription | null;
}

export interface PlanInfo {
  planKey: string;
  planName: string;
  entitlements: IPlanEntitlements;
  isPremium: boolean;
  subscription: {
    status: ISubscription["status"];
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    // Set once Razorpay has actually been told to stop auto-renewing (see
    // subscriptionService.ts::cancelSubscriptionDoc) — null/undefined means
    // the cancellation is still purely local and freely reversible via
    // reactivate. The frontend uses this to show an honest "can't be
    // restored" state instead of offering a reactivate that would fail.
    razorpayCancelRequestedAt: Date | null;
  } | null;
}

export async function getPlan(userId: string): Promise<PlanInfo> {
  const subscription = await getActiveSubscription(userId);
  if (subscription && subscription.planId) {
    const plan = subscription.planId as unknown as ISubscriptionPlan;
    return {
      planKey: plan.key,
      planName: plan.name,
      entitlements: plan.entitlements,
      isPremium: plan.key !== FREEMIUM_KEY,
      subscription: {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        razorpayCancelRequestedAt: subscription.razorpayCancelRequestedAt ?? null,
      },
    };
  }

  const freemium = await SubscriptionPlan.findOne({ key: FREEMIUM_KEY }).lean();
  const fallback = DEFAULT_SUBSCRIPTION_PLANS[0];
  return {
    planKey: fallback.key,
    planName: freemium?.name ?? fallback.name,
    entitlements: freemium?.entitlements ?? fallback.entitlements,
    isPremium: false,
    subscription: null,
  };
}

export async function isPremiumUser(userId: string): Promise<boolean> {
  const { isPremium } = await getPlan(userId);
  return isPremium;
}

// holdingValuationService.ts's own Premium-only gate (Phase 6a — "Auto-
// updated Dive Score: Off" for Freemium is a natural consequence of never
// running this refresh for them, per §3.1's own note).
export async function getPremiumUserIds(): Promise<Types.ObjectId[]> {
  const subs = await Subscription.find({ status: { $in: ["trialing", "active", "past_due"] }, currentPeriodEnd: { $gte: new Date() } })
    .select("userId")
    .lean();
  return subs.map((s) => s.userId);
}

export async function assertEntitlement(userId: string, key: keyof IPlanEntitlements): Promise<void> {
  const { entitlements } = await getPlan(userId);
  if (!entitlements[key]) {
    throw new ApiError(403, "ENTITLEMENT_REQUIRED", "This feature isn't available on your current plan.");
  }
}
