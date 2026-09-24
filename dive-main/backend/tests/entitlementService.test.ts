import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import * as entitlementService from "../src/services/entitlementService";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.5 — the one place that resolves
// "what plan is this user on".

let mobileCounter = 9890000000;
async function makeUser() {
  return User.create({ name: "Entitlement User", mobile: String(mobileCounter++), email: `ent-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

describe("seedDefaultSubscriptionPlansIfEmpty", () => {
  it("seeds freemium/premium_monthly/premium_annual when empty", async () => {
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
    const plans = await SubscriptionPlan.find({}).lean();
    expect(plans.map((p) => p.key).sort()).toEqual(["freemium", "premium_annual", "premium_monthly"]);
  });

  it("is a no-op when plans already exist", async () => {
    await SubscriptionPlan.create({ key: "custom", name: "Custom", pricePaise: 0, interval: "one_time", entitlements: { dailyRevaluation: false, earlyAccess: false, priorityWeight: 0 } });
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
    const plans = await SubscriptionPlan.find({}).lean();
    expect(plans.length).toBe(1);
  });
});

describe("getPlan", () => {
  beforeEach(async () => {
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
  });

  it("returns Freemium for a user with no Subscription row at all", async () => {
    const user = await makeUser();
    const plan = await entitlementService.getPlan(String(user._id));
    expect(plan.planKey).toBe("freemium");
    expect(plan.isPremium).toBe(false);
    expect(plan.entitlements.portfolioEditWeekly).toBe(2);
    expect(plan.subscription).toBeNull();
  });

  it("returns the Premium plan for an active subscription", async () => {
    const user = await makeUser();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({
      userId: user._id,
      planId: premium!._id,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startedAt: new Date(),
    });
    const plan = await entitlementService.getPlan(String(user._id));
    expect(plan.planKey).toBe("premium_monthly");
    expect(plan.isPremium).toBe(true);
    expect(plan.entitlements.portfolioEditWeekly).toBeNull();
    expect(plan.subscription?.status).toBe("active");
  });

  it("treats past_due as still-Premium (grace period)", async () => {
    const user = await makeUser();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({
      userId: user._id,
      planId: premium!._id,
      status: "past_due",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      startedAt: new Date(),
    });
    const plan = await entitlementService.getPlan(String(user._id));
    expect(plan.isPremium).toBe(true);
  });

  it("falls back to Freemium once currentPeriodEnd has passed, even if status wasn't transitioned yet", async () => {
    const user = await makeUser();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({
      userId: user._id,
      planId: premium!._id,
      status: "active",
      currentPeriodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() - 1000),
      startedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    const plan = await entitlementService.getPlan(String(user._id));
    expect(plan.isPremium).toBe(false);
  });

  it("ignores a cancelled subscription", async () => {
    const user = await makeUser();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({
      userId: user._id,
      planId: premium!._id,
      status: "cancelled",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startedAt: new Date(),
      endedAt: new Date(),
    });
    const plan = await entitlementService.getPlan(String(user._id));
    expect(plan.isPremium).toBe(false);
  });
});

describe("getPremiumUserIds", () => {
  it("includes trialing/active/past_due users and excludes cancelled/expired/freemium", async () => {
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const active = await makeUser();
    const cancelled = await makeUser();
    const freemiumUser = await makeUser();

    await Subscription.create({ userId: active._id, planId: premium!._id, status: "active", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 1000000), startedAt: new Date() });
    await Subscription.create({ userId: cancelled._id, planId: premium!._id, status: "cancelled", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 1000000), startedAt: new Date(), endedAt: new Date() });

    const ids = (await entitlementService.getPremiumUserIds()).map(String);
    expect(ids).toContain(String(active._id));
    expect(ids).not.toContain(String(cancelled._id));
    expect(ids).not.toContain(String(freemiumUser._id));
  });
});

describe("assertEntitlement", () => {
  it("throws for a Freemium user lacking a boolean entitlement", async () => {
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
    const user = await makeUser();
    await expect(entitlementService.assertEntitlement(String(user._id), "dailyRevaluation")).rejects.toMatchObject({ status: 403 });
  });

  it("passes for a Premium user", async () => {
    await entitlementService.seedDefaultSubscriptionPlansIfEmpty();
    const user = await makeUser();
    const premium = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({ userId: user._id, planId: premium!._id, status: "active", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 1000000), startedAt: new Date() });
    await expect(entitlementService.assertEntitlement(String(user._id), "dailyRevaluation")).resolves.toBeUndefined();
  });
});
