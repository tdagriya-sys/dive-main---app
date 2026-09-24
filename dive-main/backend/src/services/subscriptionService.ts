import { randomUUID } from "crypto";
import { Types } from "mongoose";
import Razorpay from "razorpay";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import { env } from "../config/env";
import { User } from "../models/User";
import { SubscriptionPlan, ISubscriptionPlan, PlanInterval } from "../models/SubscriptionPlan";
import { Subscription, ISubscription } from "../models/Subscription";
import { IRenewalReminderValue } from "../models/AdminSetting";
import { Payment, IPayment } from "../models/Payment";
import { ApiError } from "../middleware/errorHandler";
import { getActiveSubscription, FREEMIUM_KEY } from "./entitlementService";
import { emitActivity } from "./activityLog";
import { generateInvoiceForPayment } from "./invoiceService";
import { validateCoupon, redeemCoupon, computeDiscountedPricePaise } from "./couponService";
import { Coupon, ICoupon } from "../models/Coupon";
import { sendPastDueNotice, notifyUser } from "./dunningService";
import { getRenewalReminderSettings } from "./adminSettingService";
import { logger } from "../lib/logger";

// Best-effort — see paymentService.ts's own copy of this same guard for why
// a failure here must never undo an already-successful charge.
async function generateInvoiceBestEffort(payment: IPayment): Promise<void> {
  try {
    await generateInvoiceForPayment(payment);
  } catch (err) {
    logger.error({ err, paymentId: String(payment._id) }, "[invoiceService] failed to generate invoice");
  }
}

async function sendPastDueNoticeBestEffort(subscription: ISubscription): Promise<void> {
  try {
    await sendPastDueNotice(subscription);
  } catch (err) {
    logger.error({ err, subscriptionId: String(subscription._id) }, "[dunningService] failed to send past-due notice");
  }
}

/**
 * Razorpay Subscriptions integration (Phase 6a of docs/ADMIN_PANEL_PLAN.md
 * §3.2/§3.3/§5.3). Mirrors paymentService.ts's mock-mode convention exactly
 * — with no real RAZORPAY_KEY_ID/SECRET set, every function here runs
 * against fake, clearly-labeled (`mock_`-prefixed) ids instead of calling
 * the real API, so local dev/tests exercise the full
 * start → checkout → verify pipeline without a real Razorpay account.
 *
 * Design split between `verifySubscriptionPayment` (below) and the webhook
 * handler (`handleSubscriptionWebhookEvent`): verify is what the frontend
 * calls the instant Checkout's handler fires, and optimistically flips the
 * user's plan so entitlements update immediately, without waiting on a
 * webhook round-trip. Both verify AND the webhook create the `Payment`
 * ledger row (idempotently, keyed on `razorpayPaymentId` — whichever
 * arrives first wins, the other is a no-op), same "webhook is a reliability
 * net alongside the frontend path, not a replacement for it" split
 * paymentService.ts's one-off order flow already uses. This used to be
 * verify-in-mock-mode-only, real-mode-webhook-only — found live to be a real
 * gap: any environment where Razorpay's webhook can't reach this server
 * (every local/dev setup, or production before its webhook URL is
 * configured) meant a real subscription's first charge got NO Payment row
 * and therefore no invoice, ever, even though the subscription itself
 * activated correctly — a real user's own first invoice was missing from
 * their Subscription screen for exactly this reason.
 */

let razorpayClient: Razorpay | null = null;
function getClient(): Razorpay {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return razorpayClient;
}

function razorpayPeriodFor(interval: ISubscriptionPlan["interval"]): "monthly" | "yearly" {
  if (interval === "year") return "yearly";
  if (interval === "month") return "monthly";
  throw new ApiError(400, "PLAN_NOT_SUBSCRIBABLE", "This plan isn't a recurring plan.");
}

export async function publishPlanToRazorpay(plan: ISubscriptionPlan): Promise<string> {
  if (plan.razorpayPlanId) return plan.razorpayPlanId;
  if (plan.pricePaise <= 0) throw new ApiError(400, "FREE_PLAN", "A free plan doesn't need a Razorpay plan.");

  if (env.razorpay.isPlaceholder) {
    return `mock_plan_${randomUUID()}`;
  }
  const rzpPlan = await getClient().plans.create({
    item: { name: plan.name, amount: plan.pricePaise, currency: "INR" },
    period: razorpayPeriodFor(plan.interval),
    interval: 1,
    notes: { planKey: plan.key },
  });
  return rzpPlan.id;
}

export interface StartSubscriptionResult {
  subscriptionId: string;
  keyId: string | null;
  amount: number;
  mock: boolean;
}

// 120 monthly / 10 yearly cycles ≈ "until cancelled" (§3.3) — Razorpay
// requires a finite total_count, so this is comfortably beyond any
// realistic subscription lifetime rather than a real ceiling.
function totalCountFor(interval: ISubscriptionPlan["interval"]): number {
  return interval === "year" ? 10 : 120;
}

export async function startSubscription(userId: string, planKey: string, couponCode?: string): Promise<StartSubscriptionResult> {
  const plan = await SubscriptionPlan.findOne({ key: planKey, isActive: true }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist or isn't available.");
  if (plan.key === FREEMIUM_KEY || plan.pricePaise <= 0) throw new ApiError(400, "FREE_PLAN", "Freemium doesn't need a subscription.");

  // Re-subscribing to the SAME plan while it's already ACTIVE (real, paid)
  // is a no-op (auto-renewal already covers it) and stays blocked. Buying a
  // DIFFERENT plan while one is active is an upgrade/switch — allowed, and
  // upsertLocalSubscription below clubs whatever validity remains on the
  // old plan onto the new one instead of discarding it (see its own
  // comment for why, and the product ask this implements: "monthly, 2 days
  // in, switch to annual → ~392 days total, not a fresh 365"). A TRIAL is
  // deliberately exempt from this same-plan block even when it's the exact
  // plan being bought — the trial and the paid subscription are two
  // genuinely separate things now (see startFreeTrial's own comment), so
  // converting an ongoing trial into a real paid subscription of the SAME
  // plan must be allowed too, with its own remaining trial days clubbed
  // onto the new paid period exactly like a plan switch would be.
  const existing = await getActiveSubscription(userId);
  if (existing && existing.status !== "trialing" && existing.planId.key === plan.key) {
    throw new ApiError(409, "ALREADY_SUBSCRIBED", "You already have an active subscription to this plan.");
  }

  // A direct "Subscribe" is a real, immediate paid subscription — it never
  // folds in the 15-day free trial (that's `startFreeTrial` below, a fully
  // separate, payment-free flow the user must explicitly choose via its own
  // button). Charging immediately also avoids Razorpay's own behavior for a
  // delayed-`start_at` subscription — a small refundable mandate-
  // verification debit up front, then no real charge until the trial ends —
  // which read as "why was I charged ₹5 and now I'm on a trial I never
  // asked for" from a user who just wanted to pay and start today.
  //
  // Phase 6b — see couponService.ts's own top comment for why a real
  // discount means creating a genuinely-discounted, one-off Razorpay Plan
  // for this specific redemption rather than an ad-hoc amount override
  // (which the Subscriptions API doesn't support, and this SDK version
  // exposes no Offers resource for either).
  const coupon = couponCode ? await validateCoupon(couponCode, planKey, userId) : null;
  const chargePricePaise = coupon ? computeDiscountedPricePaise(plan.pricePaise, coupon) : plan.pricePaise;

  // Coupon redemption is NOT counted here — validateCoupon above only checks
  // the coupon is currently valid/eligible; actually consuming a slot
  // happens once the payment is verified (verifySubscriptionPayment), so a
  // user who starts checkout and then abandons/cancels it never burns a
  // redemption for a purchase that never completed.
  if (env.razorpay.isPlaceholder) {
    return { subscriptionId: `mock_sub_${randomUUID()}`, keyId: null, amount: chargePricePaise, mock: true };
  }

  if (!plan.razorpayPlanId) {
    throw new ApiError(400, "PLAN_NOT_PUBLISHED", "This plan hasn't been published to Razorpay yet. Ask an admin to publish it first.");
  }

  let razorpayPlanId = plan.razorpayPlanId;
  if (coupon && chargePricePaise !== plan.pricePaise) {
    const discountedPlan = await getClient().plans.create({
      item: { name: `${plan.name} (${coupon.code})`, amount: chargePricePaise, currency: "INR" },
      period: razorpayPeriodFor(plan.interval),
      interval: 1,
      notes: { planKey: plan.key, couponCode: coupon.code },
    });
    razorpayPlanId = discountedPlan.id;
  }

  const subscription = await getClient().subscriptions.create({
    plan_id: razorpayPlanId,
    total_count: totalCountFor(plan.interval),
    customer_notify: 1,
    notes: { userId, planKey: plan.key, ...(coupon ? { couponCode: coupon.code } : {}) },
  });

  return { subscriptionId: subscription.id, keyId: env.razorpay.keyId ?? null, amount: chargePricePaise, mock: false };
}

// A genuinely payment-free trial claim — the product's own stated goal was
// "get free trial without adding or making any payment, and once the trial
// is over then user can buy the subscription." `startSubscription` above
// always creates a real Razorpay Subscription even for a trialing user (it
// just defers `start_at`), which still routes through Razorpay Checkout and
// typically asks for a payment method upfront. This skips Razorpay
// entirely: no order, no Checkout.js, no card ever requested. Reuses
// `upsertLocalSubscription` — the exact function that already sets
// `status: "trialing"` and flips `hasUsedTrial: true` — with
// `razorpaySubscriptionId: undefined`, exactly like `grantComplimentarySubscription`
// already does for an admin-granted comp period.
export async function startFreeTrial(userId: string, planKey: string): Promise<ISubscription> {
  const plan = await SubscriptionPlan.findOne({ key: planKey, isActive: true }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist or isn't available.");
  if (plan.key === FREEMIUM_KEY || plan.pricePaise <= 0) throw new ApiError(400, "FREE_PLAN", "Freemium doesn't need a trial.");
  if (plan.trialDays <= 0) throw new ApiError(400, "NO_TRIAL_AVAILABLE", "This plan doesn't offer a free trial.");

  const existing = await getActiveSubscription(userId);
  if (existing) throw new ApiError(409, "ALREADY_SUBSCRIBED", "You already have an active subscription.");

  const user = await User.findById(userId).select("hasUsedTrial").lean();
  if (user?.hasUsedTrial) {
    throw new ApiError(409, "TRIAL_ALREADY_USED", "You've already used your one-time free trial. Subscribe to continue with Premium.");
  }

  return upsertLocalSubscription(userId, plan, undefined, plan.trialDays, undefined, "claim");
}

// Daily sweep (jobs/trialExpiry.cron.ts) for free trials past their
// currentPeriodEnd. `entitlementService.getActiveSubscription`'s own
// `currentPeriodEnd >= now` filter already makes Premium access revert to
// Freemium correctly in real time without this — a free trial has no
// Razorpay subscription behind it, so nothing auto-charges or auto-
// transitions it the way a real subscription's webhooks do. This sweep
// exists purely so the admin panel's subscription list (and any
// revenue/analytics reporting) shows an accurate "expired" status instead
// of a stale "trialing" row that silently stopped granting access days ago.
export interface TrialExpirySweepSummary {
  expired: number;
}

export async function sweepExpiredFreeTrials(): Promise<TrialExpirySweepSummary> {
  const result = await Subscription.updateMany(
    { status: "trialing", razorpaySubscriptionId: { $exists: false }, currentPeriodEnd: { $lt: new Date() } },
    { status: "expired", endedAt: new Date() }
  );
  return { expired: result.modifiedCount };
}

function periodEndFor(interval: ISubscriptionPlan["interval"], from: Date): Date {
  const end = new Date(from);
  if (interval === "year") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

// Accepts either a hydrated Document or a plain `.lean()` object — every
// call site here only ever needs these three fields, so this avoids the
// Document-vs-plain-object type friction of passing around a full
// ISubscriptionPlan (which `.lean()` doesn't actually return one of).
interface PlanLike {
  _id: Types.ObjectId;
  key: string;
  interval: PlanInterval;
  trialDays: number;
  pricePaise: number;
}

// "claim" = the user explicitly clicked "Start free trial" (startFreeTrial)
//   — the one-time trial opportunity is now used, and used ON PURPOSE.
// "forfeit" = the user paid for a plan directly (verifySubscriptionPayment,
//   or the webhook race-fallback below) without ever claiming the trial
//   first — the opportunity is gone too, but the admin Trials tab needs to
//   be able to tell these two cases apart (see User.ts's own comment on
//   `trialForfeitedWithoutClaim`), so it's tagged distinctly rather than
//   folded into the same boolean.
// "none" = this call doesn't touch trial state at all (e.g. a plan switch
//   while already Premium — hasUsedTrial is already whatever it already is).
type TrialConsumption = "claim" | "forfeit" | "none";

async function upsertLocalSubscription(
  userId: string,
  plan: PlanLike,
  razorpaySubscriptionId: string | undefined,
  trialDays: number,
  couponCode?: string,
  trialConsumption: TrialConsumption = "none"
) {
  // A user should have at most one live (trialing/active/past_due)
  // subscription at a time — supersede rather than stack as separate rows,
  // same convention Phase 3's staff-invite service already uses for a
  // re-invited email. Whatever validity remains on what's being superseded
  // is still credited forward onto the new plan below, not discarded —
  // "club" the two durations, per the product's own framing — so switching
  // plans mid-cycle never costs the user days they already paid for.
  const now = new Date();
  const superseded = await Subscription.find({ userId, status: { $in: ["trialing", "active", "past_due"] } });
  const remainingMs = superseded.reduce((max, s) => Math.max(max, s.currentPeriodEnd.getTime() - now.getTime()), 0);

  // Cancel any old REAL (non-mock) Razorpay subscription being superseded —
  // startSubscription always creates a brand-new Razorpay subscription for
  // the new plan rather than reusing the old one, so without this the old
  // plan would keep auto-renewing (and billing) right alongside the new one.
  for (const s of superseded) {
    if (s.razorpaySubscriptionId && s.razorpaySubscriptionId !== razorpaySubscriptionId && !s.razorpaySubscriptionId.startsWith("mock_sub_") && !env.razorpay.isPlaceholder) {
      try {
        await getClient().subscriptions.cancel(s.razorpaySubscriptionId, false);
      } catch (err) {
        logger.error({ err, razorpaySubscriptionId: s.razorpaySubscriptionId }, "[subscriptionService] failed to cancel superseded Razorpay subscription");
      }
    }
  }
  await Subscription.updateMany({ _id: { $in: superseded.map((s) => s._id) } }, { status: "cancelled", endedAt: now });

  const status: ISubscription["status"] = trialDays > 0 ? "trialing" : "active";
  const baseEnd = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : periodEndFor(plan.interval, now);
  const currentPeriodEnd = remainingMs > 0 ? new Date(baseEnd.getTime() + remainingMs) : baseEnd;

  const subscription = await Subscription.create({
    userId,
    planId: plan._id,
    status,
    currentPeriodStart: now,
    currentPeriodEnd,
    razorpaySubscriptionId,
    startedAt: now,
    couponCode,
    ...(trialDays > 0 ? { trialDaysGranted: trialDays } : {}),
  });

  if (trialConsumption === "claim") {
    await User.updateOne({ _id: userId }, { hasUsedTrial: true, trialForfeitedWithoutClaim: false });
  } else if (trialConsumption === "forfeit") {
    // Guarded so this never clobbers an ALREADY-claimed trial's history
    // (e.g. a later plan switch while Premium re-enters this function with
    // "forfeit" too, but hasUsedTrial is already true by then — a no-op).
    await User.updateOne({ _id: userId, hasUsedTrial: { $ne: true } }, { hasUsedTrial: true, trialForfeitedWithoutClaim: true });
  }
  emitActivity("subscription_started", { userId, props: { planKey: plan.key, trial: trialDays > 0 } });
  return subscription;
}

export interface VerifySubscriptionInput {
  planKey: string;
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
  couponCode?: string;
}

// Best-effort — coupon bookkeeping must never block granting a subscription
// the user has already genuinely paid for. A failure here (e.g. a total-cap
// race lost between validateCoupon at checkout-start and this call) just
// means the count is slightly off; logged, not thrown.
async function redeemCouponBestEffort(couponCode: string, userId: string): Promise<void> {
  try {
    const coupon = await Coupon.findOne({ code: couponCode.trim().toUpperCase() }).select("_id").lean();
    if (coupon) await redeemCoupon(String(coupon._id), userId);
  } catch (err) {
    logger.error({ err, couponCode, userId }, "[subscriptionService] failed to record coupon redemption");
  }
}

// Resolves the catalog Razorpay plan id a subscription should revert to
// after its first (already-discounted) charge, if its redeemed coupon is a
// `discountDuration: "once"` discount — or null if there's nothing to
// revert (no coupon redeemed, a "recurring" coupon whose discount is
// supposed to last for the subscription's whole life, or the revert has
// already been scheduled once). Deliberately touches only the DB, never
// Razorpay, so it's unit-testable without a mock-mode guard getting in the
// way — see couponService.ts's own comment for why "once" exists at all.
export async function resolveOneTimeCouponRevertPlanId(subscription: Pick<ISubscription, "couponCode" | "planId" | "couponOnceRevertScheduledAt">): Promise<string | null> {
  if (!subscription.couponCode || subscription.couponOnceRevertScheduledAt) return null;
  const coupon = await Coupon.findOne({ code: subscription.couponCode }).lean();
  if (!coupon || coupon.discountDuration !== "once") return null;
  const plan = await SubscriptionPlan.findById(subscription.planId).lean();
  return plan?.razorpayPlanId ?? null;
}

// Called after EVERY successful charge — the first one (verifySubscriptionPayment)
// and every renewal (the `subscription.charged` webhook below) — so that
// whichever of the two actually processes the FIRST charge is the one that
// schedules the revert; the other call (whether the same charge processed
// twice, or a later renewal) is a cheap no-op once
// `couponOnceRevertScheduledAt` is set. `schedule_change_at: "cycle_end"`
// (not `"now"`) keeps the cycle that was just paid for at its discounted
// price — only the NEXT renewal bills full price.
async function revertToFullPriceIfOneTimeCoupon(subscription: ISubscription): Promise<void> {
  const revertPlanId = await resolveOneTimeCouponRevertPlanId(subscription);
  if (!revertPlanId) return;
  if (!subscription.razorpaySubscriptionId || subscription.razorpaySubscriptionId.startsWith("mock_sub_") || env.razorpay.isPlaceholder) return;
  try {
    await getClient().subscriptions.update(subscription.razorpaySubscriptionId, { plan_id: revertPlanId, schedule_change_at: "cycle_end" });
    subscription.couponOnceRevertScheduledAt = new Date();
    await subscription.save();
  } catch (err) {
    logger.error({ err, subscriptionId: String(subscription._id) }, "[subscriptionService] failed to revert one-time-coupon subscription to full price — will retry on the next charge");
  }
}

export async function verifySubscriptionPayment(userId: string, input: VerifySubscriptionInput): Promise<ISubscription> {
  const plan = await SubscriptionPlan.findOne({ key: input.planKey }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist.");

  const isMock = input.razorpay_subscription_id.startsWith("mock_sub_");

  if (isMock) {
    if (!input.razorpay_payment_id.startsWith("mock_payment_")) {
      throw new ApiError(400, "INVALID_MOCK_PAYMENT", "Malformed mock payment confirmation.");
    }
  } else {
    const valid = validatePaymentVerification(
      { subscription_id: input.razorpay_subscription_id, payment_id: input.razorpay_payment_id },
      input.razorpay_signature,
      env.razorpay.keySecret!
    );
    if (!valid) {
      throw new ApiError(400, "PAYMENT_VERIFICATION_FAILED", "We couldn't verify this payment. If money was deducted, it will be auto-refunded by your bank/Razorpay if this wasn't legitimate.");
    }
  }

  // A direct paid subscribe never carries a trial (see startSubscription's
  // own comment) — always an immediate, real charge, and "forfeit" tags
  // the user's trial opportunity as gone-without-ever-claiming-it if it
  // wasn't already used one way or the other.
  const subscription = await upsertLocalSubscription(userId, plan, input.razorpay_subscription_id, 0, input.couponCode, "forfeit");

  // The moment payment is actually confirmed — not before — is when a
  // coupon redemption is counted (see startSubscription's own comment on
  // why it's deliberately NOT redeemed at checkout-start).
  if (input.couponCode) await redeemCouponBestEffort(input.couponCode, userId);

  // Records the Payment ledger row (and its invoice) here too, not just in
  // mock mode — in ANY environment where Razorpay's webhook can't reach
  // this server (every local/dev setup, or a production deploy before its
  // webhook URL is actually configured), subscription.charged never fires,
  // so this was the ONLY path that could ever record a real subscription's
  // first charge; a user who paid for real still correctly ended up
  // Premium (upsertLocalSubscription above doesn't depend on this), just
  // with no Payment row and therefore no invoice ever generated — confirmed
  // live, this is exactly why a real user's own first invoice was missing
  // from their own Subscription screen. Idempotent against the webhook via
  // the same `razorpayPaymentId` existence check that handler already uses
  // (see this file's own top comment), so if the webhook DOES also fire
  // (the normal production case, given a working webhook URL), the first
  // of the two to arrive wins and the other is a harmless no-op — matches
  // paymentService.ts's identical frontend-vs-webhook race handling for
  // the one-off report payment.
  const alreadyRecorded = await Payment.exists({ razorpayPaymentId: input.razorpay_payment_id });
  if (!alreadyRecorded) {
    // Deliberately just a plain lookup, NOT couponService.validateCoupon —
    // this is purely for computing the already-charged amount for the
    // ledger row, not a second eligibility check.
    const coupon = input.couponCode ? await Coupon.findOne({ code: input.couponCode.trim().toUpperCase() }).lean() : null;
    const amount = coupon ? computeDiscountedPricePaise(plan.pricePaise, coupon as unknown as ICoupon) : plan.pricePaise;

    const payment = await Payment.create({
      userId,
      purpose: "SUBSCRIPTION_INITIAL",
      amount,
      currency: "INR",
      razorpayOrderId: isMock ? `mock_order_${randomUUID()}` : `sub_${input.razorpay_subscription_id}_${input.razorpay_payment_id}`,
      razorpayPaymentId: input.razorpay_payment_id,
      status: "paid",
      isMock,
      subscriptionId: subscription._id,
    });
    subscription.lastPaymentId = payment._id;
    await subscription.save();
    await generateInvoiceBestEffort(payment);
  }

  await revertToFullPriceIfOneTimeCoupon(subscription);
  return subscription;
}

export interface CancelSubscriptionInput {
  atPeriodEnd?: boolean;
  notifyRazorpayNow?: boolean;
}

export async function cancelSubscription(userId: string, input: CancelSubscriptionInput = {}): Promise<ISubscription> {
  const subscription = await getActiveSubscription(userId);
  if (!subscription) throw new ApiError(404, "NO_ACTIVE_SUBSCRIPTION", "You don't have an active subscription to cancel.");
  // `getActiveSubscription`'s populated `planId` isn't used below — every
  // field this needs (userId/razorpaySubscriptionId/status/etc.) is
  // identical on the populated and unpopulated shapes.
  return cancelSubscriptionDoc(subscription as unknown as ISubscription, input.atPeriodEnd ?? true, input.notifyRazorpayNow ?? false);
}

// `notifyRazorpayNow` only matters for the at-period-end path (see below) —
// an immediate full cancel (atPeriodEnd: false) always needs Razorpay told
// right away regardless, since it ends access this instant.
export async function cancelSubscriptionDoc(subscription: ISubscription, atPeriodEnd: boolean, notifyRazorpayNow = false): Promise<ISubscription> {
  // For an at-period-end cancel, Razorpay is deliberately NOT called here by
  // default — only the LOCAL `cancelAtPeriodEnd` intent is recorded, which
  // already drives every entitlement check (entitlementService.ts) on its
  // own. Razorpay has no endpoint to undo a scheduled cycle-end cancellation
  // once requested (see reactivateSubscription's own comment) — every call
  // here is irreversible the instant it succeeds. So the real Razorpay call
  // is deferred to jobs/subscriptionCancelNotice.cron.ts's daily sweep,
  // which only notifies Razorpay once the subscription is genuinely close to
  // its next renewal (env.cancelNoticeBufferHours) — a user who cancels and
  // then reactivates before that window never touches Razorpay at all, so
  // there's nothing to undo. `notifyRazorpayNow` is the explicit opt-out of
  // that deferral, for a user who wants Razorpay told immediately; once that
  // call succeeds, reactivate can no longer honestly restore auto-billing
  // for this cycle either (see razorpayCancelRequestedAt on the model).
  //
  // Same best-effort posture either way — this app's entitlements never
  // read live Razorpay state, so a Razorpay-side hiccup here must never
  // block recording the user's own cancel intent locally (same posture as
  // generateInvoiceBestEffort/sendPastDueNoticeBestEffort elsewhere in this
  // file).
  const callRazorpayNow = !atPeriodEnd || notifyRazorpayNow;
  if (callRazorpayNow && subscription.razorpaySubscriptionId && !subscription.razorpaySubscriptionId.startsWith("mock_sub_") && !env.razorpay.isPlaceholder) {
    try {
      await getClient().subscriptions.cancel(subscription.razorpaySubscriptionId, atPeriodEnd);
      if (atPeriodEnd) subscription.razorpayCancelRequestedAt = new Date();
    } catch (err) {
      logger.error({ err, razorpaySubscriptionId: subscription.razorpaySubscriptionId }, "[subscriptionService] failed to cancel Razorpay subscription — proceeding with the local cancel regardless");
    }
  }
  if (atPeriodEnd) {
    subscription.cancelAtPeriodEnd = true;
  } else {
    subscription.status = "cancelled";
    subscription.endedAt = new Date();
  }
  await subscription.save();
  emitActivity("subscription_cancelled", { userId: String(subscription.userId), props: { atPeriodEnd, notifyRazorpayNow: callRazorpayNow } });
  return subscription;
}

// Undoes an at-period-end cancel (self-serve, no step-up — turning
// auto-renew back ON is the low-stakes direction, unlike turning it off).
// Only meaningful while the subscription is still live (getActiveSubscription
// already excludes anything past its currentPeriodEnd) and actually flagged
// to cancel — reactivating something that was never cancelled is a no-op
// the caller shouldn't be offering in the first place.
//
// Deliberately LOCAL-only — Razorpay's Subscriptions API has no endpoint to
// undo a `cancel_at_cycle_end` schedule. `cancelScheduledChanges` looks like
// a fit (and an earlier version of this function called it) but it's
// actually for a completely different feature: undoing a SCHEDULED PLAN/
// QUANTITY UPDATE made via `subscriptions.update`'s own `schedule_change_at`,
// tracked by `has_scheduled_changes`/`pendingUpdate` — nothing to do with a
// scheduled cancellation. Calling it always fails with a Razorpay 400 ("no
// scheduled changes"), which used to surface as a raw 500 — confirmed live.
//
// This app's entitlements are driven entirely by the local
// `cancelAtPeriodEnd`/`currentPeriodEnd` fields regardless
// (entitlementService.ts), so flipping the flag back is what actually
// controls the user's own experience — PROVIDED Razorpay hasn't already
// been told to stop billing (`razorpayCancelRequestedAt` — see
// cancelSubscriptionDoc's own comment on why that call is deferred in the
// first place, specifically so this case is rare). If it HAS been told
// already, there is nothing correct left to do here — no real "reactivate"
// is possible, so this refuses honestly instead of flipping the local flag
// back and quietly lying to the user; the subscription would otherwise
// still be cancelled by Razorpay at period end regardless of what the local
// flag says, via the subscription.cancelled webhook.
export async function reactivateSubscription(userId: string): Promise<ISubscription> {
  const subscription = await getActiveSubscription(userId);
  if (!subscription) throw new ApiError(404, "NO_ACTIVE_SUBSCRIPTION", "You don't have an active subscription to reactivate.");
  if (!subscription.cancelAtPeriodEnd) throw new ApiError(400, "NOT_CANCELLED", "This subscription isn't scheduled to cancel.");
  if (subscription.razorpayCancelRequestedAt) {
    throw new ApiError(
      409,
      "RAZORPAY_ALREADY_NOTIFIED",
      "Auto-renew can't be restored for this billing cycle — Razorpay has already been told to stop billing, and that can't be undone. Your Premium access continues until it ends; you're welcome to subscribe again after that."
    );
  }

  subscription.cancelAtPeriodEnd = false;
  await subscription.save();
  emitActivity("subscription_reactivated", { userId: String(subscription.userId) });
  return subscription as unknown as ISubscription;
}

export interface CancelNoticeSweepSummary {
  checked: number;
  notified: number;
}

// Daily sweep (jobs/subscriptionCancelNotice.cron.ts) — the ONLY point a
// real (non-mock) subscription that's merely cancelled-at-period-end
// actually gets told to stop with Razorpay. See cancelSubscriptionDoc's own
// comment for why that call is deferred here instead of made immediately:
// this only fires once a still-live cancelled subscription's
// `currentPeriodEnd` is within env.cancelNoticeBufferHours of now, so a user
// who reactivates before then never causes a single Razorpay call. Stamps
// `razorpayCancelRequestedAt` on success so reactivateSubscription can
// honestly refuse from that point on. Best-effort per subscription, same
// posture as every other Razorpay call in this file — a failure here just
// means the next day's run retries it, comfortably still ahead of
// Razorpay's own next auto-charge attempt given the buffer.
export async function runCancelNoticeSweep(): Promise<CancelNoticeSweepSummary> {
  const cutoff = new Date(Date.now() + env.cancelNoticeBufferHours * 60 * 60 * 1000);
  const due = await Subscription.find({
    cancelAtPeriodEnd: true,
    razorpayCancelRequestedAt: { $exists: false },
    status: { $in: ["active", "past_due"] },
    currentPeriodEnd: { $lte: cutoff },
    razorpaySubscriptionId: { $exists: true },
  });
  let notified = 0;
  for (const subscription of due) {
    if (!subscription.razorpaySubscriptionId || subscription.razorpaySubscriptionId.startsWith("mock_sub_") || env.razorpay.isPlaceholder) continue;
    try {
      await getClient().subscriptions.cancel(subscription.razorpaySubscriptionId, true);
      subscription.razorpayCancelRequestedAt = new Date();
      await subscription.save();
      notified += 1;
    } catch (err) {
      logger.error({ err, subscriptionId: String(subscription._id) }, "[subscriptionService] cancel-notice sweep failed to notify Razorpay — will retry on the next run");
    }
  }
  return { checked: due.length, notified };
}

export interface RenewalReminderSweepSummary {
  checked: number;
  notified: number;
}

const REMINDER_TEMPLATE_TOKEN = /{{\s*(\w+)\s*}}/g;

// Admin-authored templates use plain {{token}} placeholders rather than a
// templating engine — the only tokens ever substituted are the four below,
// so anything unrecognized (a typo, e.g.) is deliberately left as literal
// text instead of throwing, so a bad edit degrades to "ugly" rather than
// "the whole reminder sweep breaks".
function renderReminderTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(REMINDER_TEMPLATE_TOKEN, (match, key: string) => (key in tokens ? tokens[key] : match));
}

// Picks which of the three admin-editable templates applies, then fills it
// in. `trialing` gets its own template regardless of `cancelAtPeriodEnd` —
// unlike a real subscription, a free trial has NO Razorpay subscription
// behind it at all (see startFreeTrial's own comment), so it never
// auto-charges either way; there is nothing conditional to say here, only
// "the trial itself is ending."
function buildRenewalReminderMessage(
  subscription: Pick<ISubscription, "currentPeriodEnd" | "status" | "cancelAtPeriodEnd">,
  plan: ISubscriptionPlan,
  messages: IRenewalReminderValue["messages"],
  daysRemaining: number
): { title: string; body: string; highlightStyle?: IRenewalReminderValue["messages"]["renewal"]["highlightStyle"] } {
  const template = subscription.status === "trialing" ? messages.trialEnding : subscription.cancelAtPeriodEnd ? messages.accessEnding : messages.renewal;
  const tokens = {
    planName: plan.name,
    periodEnd: subscription.currentPeriodEnd.toLocaleDateString("en-IN"),
    price: (plan.pricePaise / 100).toLocaleString("en-IN"),
    daysRemaining: String(Math.max(daysRemaining, 0)),
  };
  return { title: renderReminderTemplate(template.title, tokens), body: renderReminderTemplate(template.body, tokens), highlightStyle: template.highlightStyle };
}

// Daily sweep (jobs/renewalReminder.cron.ts) — the only proactive,
// forward-looking subscription notice in the app: dunning and the
// cancel-notice sweep above both react to something that already happened
// (a failed charge) or affect Razorpay, not the user. Razorpay has no
// pre-charge webhook to hook into, so this polls `currentPeriodEnd`
// directly against however many admin-configured thresholds are due (e.g.
// 7/3/0 days out), just aimed at notifyUser instead of Razorpay.
//
// `daysRemaining` is a whole-day floor, so a threshold of 0 means "due
// today or already slightly overdue" rather than requiring exact-instant
// timing — the sweep runs once a day, not continuously. Whichever
// thresholds are newly due (not yet in `renewalRemindersSentDays` for the
// CURRENT `currentPeriodEnd`) all get folded into a SINGLE notification per
// run rather than one each — if a cron outage means both the 7-day and
// 3-day thresholds become due at once, that's one catch-up reminder, not a
// duplicate-feeling pair. The moment `currentPeriodEnd` moves forward (a
// real renewal, a reactivation, an admin change-plan), the mismatch against
// `renewalReminderPeriodEnd` resets the sent-list, so every threshold is
// eligible again next cycle with no separate reset step. `past_due`
// subscriptions are deliberately excluded — they already get
// dunningService.ts's own past-due notice, which is more specific and would
// otherwise double up.
export async function runRenewalReminderSweep(): Promise<RenewalReminderSweepSummary> {
  const { daysBefore, messages, enablePopup } = await getRenewalReminderSettings();
  if (daysBefore.length === 0) return { checked: 0, notified: 0 };
  const thresholds = [...new Set(daysBefore)].sort((a, b) => b - a);
  const now = new Date();
  const cutoff = new Date(now.getTime() + thresholds[0] * 24 * 60 * 60 * 1000);
  const candidates = await Subscription.find({
    status: { $in: ["active", "trialing"] },
    currentPeriodEnd: { $lte: cutoff },
  }).populate<{ planId: ISubscriptionPlan }>("planId");

  let checked = 0;
  let notified = 0;
  for (const subscription of candidates) {
    const plan = subscription.planId as unknown as ISubscriptionPlan;
    if (!plan) continue;

    if (!subscription.renewalReminderPeriodEnd || subscription.renewalReminderPeriodEnd.getTime() !== subscription.currentPeriodEnd.getTime()) {
      subscription.renewalReminderPeriodEnd = subscription.currentPeriodEnd;
      subscription.renewalRemindersSentDays = [];
    }
    const sentDays = subscription.renewalRemindersSentDays ?? [];
    const daysRemaining = Math.floor((subscription.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const dueThresholds = thresholds.filter((d) => daysRemaining <= d && !sentDays.includes(d));
    if (dueThresholds.length === 0) continue;
    checked += 1;

    try {
      const { title, body, highlightStyle } = buildRenewalReminderMessage(subscription, plan, messages, daysRemaining);
      await notifyUser(subscription.userId, title, body, { popup: enablePopup, highlightStyle });
      subscription.renewalRemindersSentDays = [...sentDays, ...dueThresholds];
      await subscription.save();
      notified += 1;
    } catch (err) {
      logger.error({ err, subscriptionId: String(subscription._id) }, "[subscriptionService] renewal-reminder sweep failed to notify user — will retry on the next run");
    }
  }
  return { checked, notified };
}

// Admin-only "comp" grant (§5.3 — POST /subscriptions/:id/grant) — a fully
// local Subscription with no Razorpay counterpart at all, for goodwill/
// support/friends-and-family access. `subscriptionId` param name in the
// route is the SUBSCRIPTION being granted TO (an existing user), not an id
// to look up — see admin/subscriptionsController.ts.
export async function grantComplimentarySubscription(userId: string, planKey: string, days: number): Promise<ISubscription> {
  const plan = await SubscriptionPlan.findOne({ key: planKey }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist.");
  await Subscription.updateMany({ userId, status: { $in: ["trialing", "active", "past_due"] } }, { status: "cancelled", endedAt: new Date() });
  const now = new Date();
  const subscription = await Subscription.create({
    userId,
    planId: plan._id,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    startedAt: now,
  });
  emitActivity("subscription_started", { userId, props: { planKey: plan.key, comp: true } });
  return subscription;
}

export async function changeSubscriptionPlan(subscription: ISubscription, newPlanKey: string): Promise<ISubscription> {
  const newPlan = await SubscriptionPlan.findOne({ key: newPlanKey, isActive: true }).lean();
  if (!newPlan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist or isn't available.");

  if (subscription.razorpaySubscriptionId && !subscription.razorpaySubscriptionId.startsWith("mock_sub_") && !env.razorpay.isPlaceholder) {
    if (!newPlan.razorpayPlanId) throw new ApiError(400, "PLAN_NOT_PUBLISHED", "The target plan hasn't been published to Razorpay yet.");
    await getClient().subscriptions.update(subscription.razorpaySubscriptionId, { plan_id: newPlan.razorpayPlanId, schedule_change_at: "now" });
  }
  subscription.planId = newPlan._id;
  await subscription.save();
  return subscription;
}

// --- Webhook handling (called from paymentController.ts's razorpayWebhook) ---

interface RazorpaySubscriptionEntity {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  customer_id?: string | null;
  notes?: Record<string, string | number>;
}
interface RazorpayPaymentEntity {
  id: string;
  order_id?: string;
  amount?: number;
  subscription_id?: string;
  error_description?: string;
}

async function findOrCreateLocalSubscription(entity: RazorpaySubscriptionEntity): Promise<ISubscription | null> {
  let subscription = await Subscription.findOne({ razorpaySubscriptionId: entity.id });
  if (subscription) return subscription;

  // Race: this webhook arrived before the frontend's own verify call. Notes
  // (set at subscriptions.create time — see startSubscription) carry enough
  // to self-sufficiently create the row here instead of dropping the event,
  // same reliability-net role handleReportWebhookPaymentCaptured plays for
  // one-off orders.
  const userId = entity.notes?.userId;
  const planKey = entity.notes?.planKey;
  if (!userId || !planKey) return null;
  const plan = await SubscriptionPlan.findOne({ key: String(planKey) }).lean();
  if (!plan) return null;

  // This subscription only ever exists because of a direct paid subscribe
  // (startSubscription never folds in a trial — see its own comment), so
  // this reliability-net path mirrors verifySubscriptionPayment exactly:
  // no trial, "forfeit" tagging.
  subscription = await upsertLocalSubscription(String(userId), plan, entity.id, 0, undefined, "forfeit");
  return subscription;
}

function applySubscriptionEntity(subscription: ISubscription, entity: RazorpaySubscriptionEntity) {
  if (entity.current_start) subscription.currentPeriodStart = new Date(entity.current_start * 1000);
  // Never move currentPeriodEnd backward — Razorpay's own cycle end is
  // always what upsertLocalSubscription started from (see its own comment),
  // but a clubbed plan-switch adds extra local days on top of that, and
  // Razorpay has no idea those exist. A same-cycle webhook (e.g. the
  // subscription.charged event for the very payment that just created this
  // row) must not silently erase that extension; a later, genuinely-later
  // renewal still applies normally since its current_end is further out.
  if (entity.current_end) {
    const newEnd = new Date(entity.current_end * 1000);
    if (newEnd.getTime() > subscription.currentPeriodEnd.getTime()) subscription.currentPeriodEnd = newEnd;
  }
  if (entity.customer_id) subscription.razorpayCustomerId = entity.customer_id;
}

export async function handleSubscriptionWebhookEvent(event: string, payload: { subscription?: { entity: RazorpaySubscriptionEntity }; payment?: { entity: RazorpayPaymentEntity } }): Promise<void> {
  const subEntity = payload.subscription?.entity;
  const paymentEntity = payload.payment?.entity;

  if (event === "subscription.charged" && subEntity && paymentEntity) {
    const subscription = await findOrCreateLocalSubscription(subEntity);
    if (!subscription) return;
    applySubscriptionEntity(subscription, subEntity);
    subscription.status = "active";
    await subscription.save();

    const alreadyRecorded = await Payment.exists({ razorpayPaymentId: paymentEntity.id });
    if (!alreadyRecorded) {
      const isFirst = !(await Payment.exists({ subscriptionId: subscription._id }));
      const payment = await Payment.create({
        userId: subscription.userId,
        purpose: isFirst ? "SUBSCRIPTION_INITIAL" : "SUBSCRIPTION_RENEWAL",
        amount: paymentEntity.amount ?? 0,
        currency: "INR",
        razorpayOrderId: paymentEntity.order_id ?? `sub_${subEntity.id}_${paymentEntity.id}`,
        razorpayPaymentId: paymentEntity.id,
        status: "paid",
        isMock: false,
        subscriptionId: subscription._id,
      });
      subscription.lastPaymentId = payment._id;
      await subscription.save();
      await generateInvoiceBestEffort(payment);
      if (!isFirst) emitActivity("subscription_renewed", { userId: String(subscription.userId), props: { planId: String(subscription.planId) } });
    }
    // Outside the `!alreadyRecorded` guard above on purpose — this needs to
    // run whichever charge event actually reaches here first (this one, or
    // an already-recorded duplicate delivery), and is a safe no-op once
    // already scheduled, so retrying costs nothing.
    await revertToFullPriceIfOneTimeCoupon(subscription);
    return;
  }

  if (event === "subscription.activated" && subEntity) {
    const subscription = await findOrCreateLocalSubscription(subEntity);
    if (!subscription) return;
    applySubscriptionEntity(subscription, subEntity);
    if (subscription.status !== "cancelled") subscription.status = "active";
    await subscription.save();
    return;
  }

  if ((event === "subscription.cancelled" || event === "subscription.completed") && subEntity) {
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
    if (!subscription) return;
    subscription.status = event === "subscription.completed" ? "expired" : "cancelled";
    subscription.endedAt = new Date();
    await subscription.save();
    emitActivity("subscription_cancelled", { userId: String(subscription.userId), props: { viaWebhook: true } });
    return;
  }

  if (event === "subscription.halted" && subEntity) {
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
    if (!subscription) return;
    // Only notify on the actual transition — a second halted event for a
    // subscription that's already past_due (or already cancelled elsewhere)
    // must not re-send the "your payment failed" notice.
    const alreadyPastDue = subscription.status === "past_due";
    subscription.status = "past_due";
    await subscription.save();
    if (!alreadyPastDue) await sendPastDueNoticeBestEffort(subscription);
    return;
  }

  if (event === "payment.failed" && paymentEntity?.subscription_id) {
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: paymentEntity.subscription_id });
    if (!subscription) return;
    const alreadyPastDue = subscription.status === "past_due";
    if (subscription.status !== "cancelled") subscription.status = "past_due";
    await subscription.save();
    await Payment.create({
      userId: subscription.userId,
      purpose: subscription.lastPaymentId ? "SUBSCRIPTION_RENEWAL" : "SUBSCRIPTION_INITIAL",
      amount: paymentEntity.amount ?? 0,
      currency: "INR",
      razorpayOrderId: `sub_${paymentEntity.subscription_id}_${paymentEntity.id}`,
      razorpayPaymentId: paymentEntity.id,
      status: "failed",
      isMock: false,
      subscriptionId: subscription._id,
      failureReason: paymentEntity.error_description,
    });
    if (!alreadyPastDue && subscription.status === "past_due") {
      await sendPastDueNoticeBestEffort(subscription);
    }
  }
}
