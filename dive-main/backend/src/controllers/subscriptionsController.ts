import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { startSubscriptionSchema, startTrialSchema, verifySubscriptionSchema, cancelSubscriptionSchema, validateCouponSchema } from "../validators/subscription";
import { User } from "../models/User";
import * as entitlementService from "../services/entitlementService";
import * as subscriptionService from "../services/subscriptionService";
import { countUsageInWindow, applyUsageGrants } from "../services/usageService";
import { UsageEventKey } from "../models/UsageEvent";
import { SubscriptionPlan } from "../models/SubscriptionPlan";
import { emitActivity } from "../services/activityLog";
import * as couponService from "../services/couponService";
import * as invoiceService from "../services/invoiceService";
import * as paymentService from "../services/paymentService";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const USAGE_KEYS: UsageEventKey[] = ["bot_scan", "doc_upload", "portfolio_edit"];

/**
 * The logged-in user's own plan surface (Phase 6a of
 * docs/ADMIN_PANEL_PLAN.md §5.4/§7) — the paywall/upgrade screen and
 * `GET /api/me/entitlements` both read through this.
 */

export async function listPublicPlans(_req: AuthedRequest, res: Response) {
  const plans = await SubscriptionPlan.find({ isActive: true, visibility: "public" }).sort({ displayOrder: 1 }).lean();
  res.status(200).json({
    // linkedPlanKey lets Subscription.jsx group a Monthly/Annual pair into
    // one toggle card instead of two separate ones — see SubscriptionPlan.ts
    // and plansController.ts::setSymmetricPlanLink.
    plans: plans.map((p) => ({ key: p.key, name: p.name, description: p.description, benefits: p.benefits, pricePaise: p.pricePaise, interval: p.interval, trialDays: p.trialDays, entitlements: p.entitlements, linkedPlanKey: p.linkedPlanKey ?? null })),
  });
}

// Includes CURRENT usage alongside the plan/limits (§5.4 — "the frontend
// reads its own plan + limits + current usage for paywall UI") so
// screens/Subscription.jsx can render real meters without a second
// round-trip per metered key.
export async function getMyEntitlements(req: AuthedRequest, res: Response) {
  const plan = await entitlementService.getPlan(req.userId!);
  // Overlay any standing admin-granted bonus (UsageGrant) so a grant is
  // actually visible to the user it was granted to, not just enforced
  // silently server-side — see usageService.ts::applyUsageGrants.
  const entitlements = await applyUsageGrants(req.userId!, plan.entitlements);
  const usage: Record<string, { weekly: number; monthly: number }> = {};
  for (const key of USAGE_KEYS) {
    const [weekly, monthly] = await Promise.all([countUsageInWindow(req.userId!, key, WEEK_MS), countUsageInWindow(req.userId!, key, MONTH_MS)]);
    usage[key] = { weekly, monthly };
  }
  // hasUsedTrial decides whether the Subscription screen offers a free
  // trial button at all — a one-time-ever guard (User.ts), never cleared.
  const user = await User.findById(req.userId).select("hasUsedTrial").lean();
  // Complimentary resilience-report status (plan benefit + any per-user
  // grant, already merged into one number — see paymentService.ts::
  // getReportComplimentaryStatus) so Subscription.jsx can show it and
  // useDownloadReport.js can decide whether the download button needs to
  // show a price at all.
  const reportAccess = await paymentService.getReportComplimentaryStatus(req.userId!);
  // Surfaced so Subscription.jsx can tell the user exactly when a deferred
  // cancel will actually reach Razorpay (see subscriptionService.ts::
  // cancelSubscriptionDoc), instead of hardcoding the same number twice.
  res.status(200).json({ ...plan, entitlements, usage, hasUsedTrial: user?.hasUsedTrial ?? false, cancelNoticeBufferHours: env.cancelNoticeBufferHours, reportAccess });
}

export async function startSubscription(req: AuthedRequest, res: Response) {
  const data = startSubscriptionSchema.parse(req.body);
  const result = await subscriptionService.startSubscription(req.userId!, data.planKey, data.couponCode);
  res.status(201).json(result);
}

// A genuinely payment-free trial claim — see subscriptionService.ts's own
// comment on startFreeTrial for why this is a separate endpoint from
// startSubscription rather than a variant of it.
export async function startTrial(req: AuthedRequest, res: Response) {
  const data = startTrialSchema.parse(req.body);
  const subscription = await subscriptionService.startFreeTrial(req.userId!, data.planKey);
  emitActivity("subscription_started", { userId: req.userId, req, props: { planKey: data.planKey, trial: true, paymentFree: true } });
  res.status(201).json({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd });
}

export async function verifySubscription(req: AuthedRequest, res: Response) {
  const data = verifySubscriptionSchema.parse(req.body);
  const subscription = await subscriptionService.verifySubscriptionPayment(req.userId!, data);
  emitActivity("subscription_started", { userId: req.userId, req, props: { planKey: data.planKey } });
  res.status(200).json({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd });
}

export async function cancelMySubscription(req: AuthedRequest, res: Response) {
  const data = cancelSubscriptionSchema.parse(req.body);
  const subscription = await subscriptionService.cancelSubscription(req.userId!, data);
  res.status(200).json({
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
    razorpayCancelRequestedAt: subscription.razorpayCancelRequestedAt ?? null,
  });
}

// Undoes an at-period-end cancel — no request body, no step-up (see
// subscriptionService.ts::reactivateSubscription's own comment on why).
export async function reactivateMySubscription(req: AuthedRequest, res: Response) {
  const subscription = await subscriptionService.reactivateSubscription(req.userId!);
  res.status(200).json({ status: subscription.status, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, currentPeriodEnd: subscription.currentPeriodEnd });
}

// Lets the Subscribe screen preview a discount before checkout, without
// spending a redemption — validateCoupon (couponService.ts) checks validity
// but never increments `redeemedCount`; that only happens inside
// subscriptionService.ts::startSubscription, once the user actually commits.
export async function previewCoupon(req: AuthedRequest, res: Response) {
  const data = validateCouponSchema.parse(req.body);
  const plan = await SubscriptionPlan.findOne({ key: data.planKey, isActive: true }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "This plan doesn't exist or isn't available.");
  const coupon = await couponService.validateCoupon(data.code, data.planKey, req.userId!);
  const discountedPricePaise = couponService.computeDiscountedPricePaise(plan.pricePaise, coupon);
  res.status(200).json({ code: coupon.code, type: coupon.type, value: coupon.value, originalPricePaise: plan.pricePaise, discountedPricePaise });
}

export async function listMyInvoices(req: AuthedRequest, res: Response) {
  const invoices = await invoiceService.listInvoicesForUser(req.userId!);
  res.status(200).json({
    invoices: invoices.map((inv) => ({ id: String(inv._id), number: inv.number, totalPaise: inv.totalPaise, issuedAt: inv.issuedAt })),
  });
}

export async function downloadMyInvoicePdf(req: AuthedRequest, res: Response) {
  const invoice = await invoiceService.getInvoiceForDownload(req.params.id, req.userId!);
  const pdf = await invoiceService.renderInvoicePdf(invoice);
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.number}.pdf"`);
  res.send(pdf);
}
