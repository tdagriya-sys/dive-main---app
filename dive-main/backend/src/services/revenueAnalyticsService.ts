import { Types } from "mongoose";
import { Subscription } from "../models/Subscription";
import { SubscriptionPlan, ISubscriptionPlan } from "../models/SubscriptionPlan";
import { Payment } from "../models/Payment";
import { AuditLog } from "../models/AuditLog";

/**
 * Revenue analytics beyond the plain payment ledger Phase 1b shipped
 * (Phase 6b of docs/ADMIN_PANEL_PLAN.md §5.3 — "MRR/ARR/ARPU/churn/LTV",
 * "mrr-movement", "failed-payments"). Only became meaningful once real
 * subscription revenue existed (Phase 6a) — before that there was nothing
 * recurring to compute a *monthly* anything from.
 *
 * `Subscription` has no separate price-history log — a plan change mutates
 * the SAME document's `planId` in place (subscriptionService.ts::
 * changeSubscriptionPlan). The one place that transition IS durably recorded
 * is the `AuditLog` row admin/subscriptionsController.ts's `changePlan`
 * already writes (`action: "subscription.plan_changed"`, `diff.before/after:
 * {planId}`) — reused below for expansion/contraction, rather than adding a
 * second history collection. This only covers plan changes made through the
 * admin console (the only self-serve path today is cancel, not change-plan),
 * which is accurate for how this app actually works today but worth knowing
 * if a user-facing self-serve plan-change ever ships.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Annual plans are billed once a year but should count toward MRR at their
// monthly-equivalent rate — the standard SaaS convention this whole feature
// name ("Monthly Recurring Revenue") assumes. One-off (non-recurring) plans
// never reach here since only "month"/"year" plans can even have a live
// Subscription (see subscriptionService.ts::razorpayPeriodFor).
function monthlyEquivalentPaise(plan: Pick<ISubscriptionPlan, "pricePaise" | "interval">): number {
  if (plan.interval === "year") return Math.round(plan.pricePaise / 12);
  return plan.pricePaise;
}

async function planPriceMap(): Promise<Map<string, ISubscriptionPlan>> {
  const plans = await SubscriptionPlan.find({}).lean();
  return new Map(plans.map((p) => [String(p._id), p as unknown as ISubscriptionPlan]));
}

export interface MrrSummary {
  mrrPaise: number;
  arrPaise: number;
  arpuPaise: number;
  activePayingCount: number;
  trialingCount: number;
  pastDueCount: number;
  churnRatePct: number | null; // trailing 30 days; null if there was nothing to churn from
  estimatedLtvPaise: number | null; // arpu / churnRate; null if churnRate is 0 or unknown
}

export async function getMrrSummary(): Promise<MrrSummary> {
  const plans = await planPriceMap();

  // "Live billing agreement" — active + past_due both still expect to be
  // charged again; trialing hasn't been billed yet so it's excluded from MRR
  // itself (but reported separately below), matching standard SaaS MRR
  // convention.
  const [payingSubs, trialingCount] = await Promise.all([
    Subscription.find({ status: { $in: ["active", "past_due"] } }).select("planId status").lean(),
    Subscription.countDocuments({ status: "trialing" }),
  ]);

  let mrrPaise = 0;
  let pastDueCount = 0;
  for (const sub of payingSubs) {
    const plan = plans.get(String(sub.planId));
    if (plan) mrrPaise += monthlyEquivalentPaise(plan);
    if (sub.status === "past_due") pastDueCount += 1;
  }

  const activePayingCount = payingSubs.length;
  const arpuPaise = activePayingCount > 0 ? Math.round(mrrPaise / activePayingCount) : 0;

  const since30d = new Date(Date.now() - 30 * DAY_MS);
  const [churnedLast30d, activeAtStartOf30d] = await Promise.all([
    Subscription.countDocuments({ status: { $in: ["cancelled", "expired"] }, endedAt: { $gte: since30d } }),
    Subscription.countDocuments({ startedAt: { $lt: since30d }, $or: [{ endedAt: { $exists: false } }, { endedAt: { $gte: since30d } }] }),
  ]);

  const churnRatePct = activeAtStartOf30d > 0 ? (churnedLast30d / activeAtStartOf30d) * 100 : null;
  const estimatedLtvPaise = churnRatePct && churnRatePct > 0 ? Math.round(arpuPaise / (churnRatePct / 100)) : null;

  return {
    mrrPaise,
    arrPaise: mrrPaise * 12,
    arpuPaise,
    activePayingCount,
    trialingCount,
    pastDueCount,
    churnRatePct,
    estimatedLtvPaise,
  };
}

export interface PlanPerformanceRow {
  planKey: string;
  planName: string;
  payingCount: number;
  trialingCount: number;
  mrrPaise: number;
}

export async function getPlanPerformance(): Promise<PlanPerformanceRow[]> {
  const plans = await SubscriptionPlan.find({ pricePaise: { $gt: 0 } }).sort({ displayOrder: 1 }).lean();
  const subs = await Subscription.find({ status: { $in: ["active", "past_due", "trialing"] } })
    .select("planId status")
    .lean();

  return plans.map((plan) => {
    const forPlan = subs.filter((s) => String(s.planId) === String(plan._id));
    const paying = forPlan.filter((s) => s.status !== "trialing");
    return {
      planKey: plan.key,
      planName: plan.name,
      payingCount: paying.length,
      trialingCount: forPlan.length - paying.length,
      mrrPaise: paying.length * monthlyEquivalentPaise(plan),
    };
  });
}

export interface MrrMovementMonth {
  month: string; // "YYYY-MM"
  newPaise: number;
  expansionPaise: number;
  contractionPaise: number;
  churnedPaise: number;
  netPaise: number;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMrrMovement(months = 6): Promise<MrrMovementMonth[]> {
  const plans = await planPriceMap();
  // `months` buckets ENDING at (and including) the current month — so
  // months=1 means "this month only", not "last month only".
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - (months - 1));
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const buckets = new Map<string, MrrMovementMonth>();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(since);
    d.setUTCMonth(d.getUTCMonth() + i);
    const key = monthKey(d);
    buckets.set(key, { month: key, newPaise: 0, expansionPaise: 0, contractionPaise: 0, churnedPaise: 0, netPaise: 0 });
  }

  // "New" — a user's very first Subscription (comp grants included), bucketed
  // by its startedAt month. Reactivations (a second/third subscription for
  // the same user, after an earlier one churned) are folded into "New" too
  // rather than a separate bucket — a defensible simplification given how
  // rarely this app's users have re-subscribed so far.
  const allSubs = await Subscription.find({ startedAt: { $gte: since } })
    .select("userId planId startedAt")
    .sort({ startedAt: 1 })
    .lean();
  const seenUser = new Set<string>();
  const firstEverIds = new Set<string>();
  for (const sub of allSubs) {
    const uid = String(sub.userId);
    if (!seenUser.has(uid)) {
      seenUser.add(uid);
      firstEverIds.add(String(sub._id));
    }
  }
  for (const sub of allSubs) {
    if (!firstEverIds.has(String(sub._id))) continue;
    const key = monthKey(sub.startedAt);
    const bucket = buckets.get(key);
    const plan = plans.get(String(sub.planId));
    if (bucket && plan) bucket.newPaise += monthlyEquivalentPaise(plan);
  }

  // "Churned" — subscriptions that ended (cancelled/expired) in-window. Their
  // `planId` is frozen at whatever it was when they were cancelled (a
  // cancelled Subscription is never plan-changed afterward), so this is
  // exact, not an approximation.
  const churned = await Subscription.find({ endedAt: { $gte: since }, status: { $in: ["cancelled", "expired"] } })
    .select("planId endedAt")
    .lean();
  for (const sub of churned) {
    if (!sub.endedAt) continue;
    const key = monthKey(sub.endedAt);
    const bucket = buckets.get(key);
    const plan = plans.get(String(sub.planId));
    if (bucket && plan) bucket.churnedPaise += monthlyEquivalentPaise(plan);
  }

  // Expansion/contraction — derived from the admin plan-change audit trail
  // (see this file's own top comment on why AuditLog is the source here).
  const planChanges = await AuditLog.find({ action: "subscription.plan_changed", ts: { $gte: since } })
    .select("diff ts")
    .lean();
  for (const change of planChanges) {
    const before = (change.diff?.before as { planId?: string } | undefined)?.planId;
    const after = (change.diff?.after as { planId?: string } | undefined)?.planId;
    if (!before || !after) continue;
    const beforePlan = plans.get(before);
    const afterPlan = plans.get(after);
    if (!beforePlan || !afterPlan) continue;
    const delta = monthlyEquivalentPaise(afterPlan) - monthlyEquivalentPaise(beforePlan);
    if (delta === 0) continue;
    const key = monthKey(change.ts);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (delta > 0) bucket.expansionPaise += delta;
    else bucket.contractionPaise += -delta;
  }

  const result = [...buckets.values()];
  for (const bucket of result) {
    bucket.netPaise = bucket.newPaise + bucket.expansionPaise - bucket.contractionPaise - bucket.churnedPaise;
  }
  return result;
}

export interface FailedPaymentRow {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  amountPaise: number;
  purpose: string;
  failureReason?: string;
  subscriptionStatus?: string;
  createdAt: Date;
}

export async function getFailedPayments(page: number, limit: number): Promise<{ payments: FailedPaymentRow[]; total: number }> {
  const filter = { status: "failed" as const };
  const [total, payments] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter)
      .populate("userId", "name email")
      .populate("subscriptionId", "status")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    total,
    payments: payments.map((p) => {
      const user = p.userId as unknown as { _id: Types.ObjectId; name?: string; email?: string } | null;
      const sub = p.subscriptionId as unknown as { status?: string } | null;
      return {
        id: String(p._id),
        userId: user ? String(user._id) : null,
        userName: user?.name ?? null,
        userEmail: user?.email ?? null,
        amountPaise: p.amount,
        purpose: p.purpose,
        failureReason: p.failureReason,
        subscriptionStatus: sub?.status,
        createdAt: p.createdAt,
      };
    }),
  };
}
