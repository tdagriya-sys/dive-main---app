import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Payment } from "../src/models/Payment";
import { AuditLog } from "../src/models/AuditLog";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as revenueAnalyticsService from "../src/services/revenueAnalyticsService";

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §5.3 — MRR/ARR/ARPU/churn/LTV,
// MRR movement, plan performance, failed payments.

let mobileCounter = 9970000000;
async function makeUser() {
  return User.create({ name: "Revenue User", mobile: String(mobileCounter++), email: `rev-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

async function makeSubscription(userId: string, planKey: "premium_monthly" | "premium_annual", status: "active" | "past_due" | "trialing" | "cancelled" | "expired", opts: { startedAt?: Date; endedAt?: Date } = {}) {
  const plan = await SubscriptionPlan.findOne({ key: planKey }).lean();
  const now = opts.startedAt ?? new Date();
  return Subscription.create({
    userId,
    planId: plan!._id,
    status,
    currentPeriodStart: now,
    currentPeriodEnd: now,
    startedAt: now,
    endedAt: opts.endedAt,
  });
}

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("getMrrSummary", () => {
  it("counts active + past_due toward MRR, excludes trialing, and converts annual to its monthly-equivalent", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    const u4 = await makeUser();
    await makeSubscription(String(u1._id), "premium_monthly", "active"); // 11900
    await makeSubscription(String(u2._id), "premium_annual", "active"); // 109900/12 ≈ 9158
    await makeSubscription(String(u3._id), "premium_monthly", "past_due"); // 11900
    await makeSubscription(String(u4._id), "premium_monthly", "trialing"); // excluded

    const summary = await revenueAnalyticsService.getMrrSummary();
    expect(summary.mrrPaise).toBe(11900 + Math.round(109900 / 12) + 11900);
    expect(summary.activePayingCount).toBe(3);
    expect(summary.trialingCount).toBe(1);
    expect(summary.pastDueCount).toBe(1);
    expect(summary.arrPaise).toBe(summary.mrrPaise * 12);
    expect(summary.arpuPaise).toBe(Math.round(summary.mrrPaise / 3));
  });

  it("returns zeros with no subscriptions at all", async () => {
    const summary = await revenueAnalyticsService.getMrrSummary();
    expect(summary.mrrPaise).toBe(0);
    expect(summary.activePayingCount).toBe(0);
    expect(summary.churnRatePct).toBeNull();
    expect(summary.estimatedLtvPaise).toBeNull();
  });

  it("computes a churn rate and an LTV once something has actually churned", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    // One still-active sub that existed before the 30-day window...
    await makeSubscription(String(u1._id), "premium_monthly", "active", { startedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) });
    // ...and one that churned within the last 30 days.
    await makeSubscription(String(u2._id), "premium_monthly", "cancelled", {
      startedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      endedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    const summary = await revenueAnalyticsService.getMrrSummary();
    expect(summary.churnRatePct).not.toBeNull();
    expect(summary.churnRatePct).toBeGreaterThan(0);
    expect(summary.estimatedLtvPaise).not.toBeNull();
  });
});

describe("getPlanPerformance", () => {
  it("breaks paying/trialing counts and MRR down per paid plan", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    await makeSubscription(String(u1._id), "premium_monthly", "active");
    await makeSubscription(String(u2._id), "premium_monthly", "trialing");

    const rows = await revenueAnalyticsService.getPlanPerformance();
    const monthly = rows.find((r) => r.planKey === "premium_monthly")!;
    expect(monthly.payingCount).toBe(1);
    expect(monthly.trialingCount).toBe(1);
    expect(monthly.mrrPaise).toBe(11900);

    // Freemium (pricePaise: 0) is excluded — it never contributes MRR.
    expect(rows.some((r) => r.planKey === "freemium")).toBe(false);
  });
});

describe("getMrrMovement", () => {
  it("buckets a first-ever subscription as 'new' in its starting month", async () => {
    const user = await makeUser();
    await makeSubscription(String(user._id), "premium_monthly", "active");
    const movement = await revenueAnalyticsService.getMrrMovement(1);
    expect(movement).toHaveLength(1);
    expect(movement[0].newPaise).toBe(11900);
    expect(movement[0].churnedPaise).toBe(0);
  });

  it("buckets a churned subscription in its ending month", async () => {
    const user = await makeUser();
    const now = new Date();
    await makeSubscription(String(user._id), "premium_monthly", "cancelled", { startedAt: now, endedAt: now });
    const movement = await revenueAnalyticsService.getMrrMovement(1);
    expect(movement[0].churnedPaise).toBe(11900);
  });

  it("classifies an admin plan-change audit entry as expansion or contraction", async () => {
    const monthly = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const annual = await SubscriptionPlan.findOne({ key: "premium_annual" }).lean();
    await AuditLog.create({
      action: "subscription.plan_changed",
      resourceType: "Subscription",
      resourceId: "irrelevant",
      diff: { before: { planId: String(monthly!._id) }, after: { planId: String(annual!._id) } },
      ts: new Date(),
    });
    const movement = await revenueAnalyticsService.getMrrMovement(1);
    const monthlyEq = Math.round(annual!.pricePaise / 12) - monthly!.pricePaise;
    if (monthlyEq > 0) {
      expect(movement[0].expansionPaise).toBe(monthlyEq);
    } else {
      expect(movement[0].contractionPaise).toBe(-monthlyEq);
    }
  });
});

describe("getFailedPayments", () => {
  it("lists only failed payments, newest first, with user info joined", async () => {
    const user = await makeUser();
    await Payment.create({ userId: user._id, purpose: "SUBSCRIPTION_RENEWAL", amount: 11900, currency: "INR", razorpayOrderId: "order_ok", status: "paid", isMock: true });
    await Payment.create({ userId: user._id, purpose: "SUBSCRIPTION_RENEWAL", amount: 11900, currency: "INR", razorpayOrderId: "order_fail", status: "failed", isMock: false, failureReason: "Card declined" });

    const { payments, total } = await revenueAnalyticsService.getFailedPayments(1, 25);
    expect(total).toBe(1);
    expect(payments[0].failureReason).toBe("Card declined");
    expect(payments[0].userEmail).toBe(user.email);
  });
});
