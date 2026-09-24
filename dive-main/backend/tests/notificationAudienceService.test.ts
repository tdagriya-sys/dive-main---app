import { Types } from "mongoose";
import { User } from "../src/models/User";
import { Holding } from "../src/models/Holding";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { Subscription } from "../src/models/Subscription";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Payment } from "../src/models/Payment";
import { NotificationCategory } from "../src/models/NotificationCategory";
import { UserNotificationPref } from "../src/models/UserNotificationPref";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as audienceService from "../src/services/notificationAudienceService";

// Phase 5 of docs/ADMIN_PANEL_PLAN.md — resolving a campaign's audience
// (segment builder) and per-user delivery-channel resolution (opt-outs).

let mobileCounter = 9850000000;
async function makeUser(overrides: Partial<{ name: string; email: string; createdAt: Date; staffRole: "admin" | null }> = {}) {
  const user = await User.create({
    name: overrides.name || "Segment User",
    mobile: String(mobileCounter++),
    email: overrides.email || `segment-${mobileCounter}@example.com`,
    age: 30,
    passwordHash: "x",
    staffRole: overrides.staffRole ?? null,
  });
  if (overrides.createdAt) {
    // Bypasses Mongoose's timestamps middleware entirely (Model.updateOne
    // still goes through it) — the raw collection write is what reliably
    // backdates createdAt for this test's date-range filter.
    await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: overrides.createdAt } });
  }
  return user;
}

describe("resolveAudienceUserIds", () => {
  it("'all' returns every active non-staff user, excluding staff", async () => {
    const u1 = await makeUser();
    await makeUser({ staffRole: "admin" });
    const ids = await audienceService.resolveAudienceUserIds({ audience: "all" });
    expect(ids.map(String)).toEqual([String(u1._id)]);
  });

  it("'user_ids' returns exactly the given ids, regardless of status", async () => {
    const u1 = await makeUser();
    const ids = await audienceService.resolveAudienceUserIds({ audience: "user_ids", userIds: [String(u1._id)] });
    expect(ids.map(String)).toEqual([String(u1._id)]);
  });

  it("segment: filters by signup date range", async () => {
    const oldUser = await makeUser({ createdAt: new Date("2020-01-01") });
    const newUser = await makeUser({ createdAt: new Date() });
    const ids = await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { signupFrom: new Date("2025-01-01") } });
    const idStrings = ids.map(String);
    expect(idStrings).toContain(String(newUser._id));
    expect(idStrings).not.toContain(String(oldUser._id));
  });

  it("segment: hasHoldings true/false partitions correctly", async () => {
    const withHolding = await makeUser();
    const withoutHolding = await makeUser();
    await Holding.create({ userId: withHolding._id, assetClass: "EQUITY", name: "Test Stock", investedValue: 100, currentValue: 110, source: "MANUAL" });

    const withIds = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { hasHoldings: true } })).map(String);
    expect(withIds).toContain(String(withHolding._id));
    expect(withIds).not.toContain(String(withoutHolding._id));

    const withoutIds = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { hasHoldings: false } })).map(String);
    expect(withoutIds).toContain(String(withoutHolding._id));
    expect(withoutIds).not.toContain(String(withHolding._id));
  });

  it("segment: minHoldingsCount filters out users below the threshold", async () => {
    const oneHolding = await makeUser();
    const threeHoldings = await makeUser();
    await Holding.create({ userId: oneHolding._id, assetClass: "EQUITY", name: "A", investedValue: 1, currentValue: 1, source: "MANUAL" });
    for (let i = 0; i < 3; i++) {
      await Holding.create({ userId: threeHoldings._id, assetClass: "EQUITY", name: `B${i}`, investedValue: 1, currentValue: 1, source: "MANUAL" });
    }
    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { minHoldingsCount: 2 } })).map(String);
    expect(ids).toContain(String(threeHoldings._id));
    expect(ids).not.toContain(String(oneHolding._id));
  });

  it("segment: activeSinceDays filters to users with a recent ActivityEvent", async () => {
    const active = await makeUser();
    const inactive = await makeUser();
    await ActivityEvent.create({ userId: active._id, type: "login", ts: new Date() });
    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { activeSinceDays: 7 } })).map(String);
    expect(ids).toContain(String(active._id));
    expect(ids).not.toContain(String(inactive._id));
  });
});

// Requirement: subscription-lifecycle and report-purchase segment buckets,
// added on top of the original signup/holdings/activity dimensions above —
// see models/NotificationCampaign.ts::SegmentSubscriptionFilter/
// SegmentReportFilter for the exact definitions this proves.
describe("resolveAudienceUserIds — subscription & report segments", () => {
  async function makeSubscription(userId: Types.ObjectId, status: "trialing" | "active" | "past_due" | "cancelled" | "expired", daysFromNow = 30) {
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const now = new Date();
    return Subscription.create({
      userId,
      planId: plan!._id,
      status,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000),
      startedAt: now,
    });
  }
  async function makePayment(userId: Types.ObjectId, purpose: "SCORE_REPORT_PDF" | "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL", status: "paid" | "failed" = "paid") {
    return Payment.create({ userId, purpose, amount: 100, currency: "INR", razorpayOrderId: `order_${new Types.ObjectId()}`, status, isMock: true });
  }

  beforeEach(async () => {
    await seedDefaultSubscriptionPlansIfEmpty();
  });

  it("active_subscription: only users with a currently-live Subscription", async () => {
    const withActive = await makeUser();
    await makeSubscription(withActive._id, "active");
    const withTrial = await makeUser();
    await makeSubscription(withTrial._id, "trialing");
    const noSub = await makeUser();

    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { subscriptionFilter: "active_subscription" } })).map(String);
    expect(ids).toEqual(expect.arrayContaining([String(withActive._id), String(withTrial._id)]));
    expect(ids).not.toContain(String(noSub._id));
  });

  it("lapsed_payer: paid at least once, but no active subscription right now", async () => {
    const lapsed = await makeUser();
    await makeSubscription(lapsed._id, "cancelled");
    await makePayment(lapsed._id, "SUBSCRIPTION_INITIAL");

    const stillActive = await makeUser();
    await makeSubscription(stillActive._id, "active");
    await makePayment(stillActive._id, "SUBSCRIPTION_INITIAL");

    const neverPaid = await makeUser();
    await makeSubscription(neverPaid._id, "cancelled"); // e.g. an admin comp grant later cancelled, never a real charge

    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { subscriptionFilter: "lapsed_payer" } })).map(String);
    expect(ids).toContain(String(lapsed._id));
    expect(ids).not.toContain(String(stillActive._id)); // has an active subscription right now — not "lapsed"
    expect(ids).not.toContain(String(neverPaid._id)); // never actually paid
  });

  it("trial_only: claimed the trial, never made a real subscription payment — even after the trial expired", async () => {
    const trialOnly = await makeUser();
    await User.updateOne({ _id: trialOnly._id }, { hasUsedTrial: true });
    await makeSubscription(trialOnly._id, "expired", -10);

    const converted = await makeUser();
    await User.updateOne({ _id: converted._id }, { hasUsedTrial: true });
    await makeSubscription(converted._id, "active");
    await makePayment(converted._id, "SUBSCRIPTION_INITIAL");

    const neverTried = await makeUser();

    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { subscriptionFilter: "trial_only" } })).map(String);
    expect(ids).toContain(String(trialOnly._id));
    expect(ids).not.toContain(String(converted._id)); // claimed AND paid — not "only"
    expect(ids).not.toContain(String(neverTried._id)); // never claimed a trial at all
  });

  it("never_engaged: no trial claimed AND no subscription payment ever", async () => {
    const untouched = await makeUser();
    const triedOnly = await makeUser();
    await User.updateOne({ _id: triedOnly._id }, { hasUsedTrial: true });
    const paidOnly = await makeUser();
    await makePayment(paidOnly._id, "SUBSCRIPTION_INITIAL");

    const ids = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { subscriptionFilter: "never_engaged" } })).map(String);
    expect(ids).toContain(String(untouched._id));
    expect(ids).not.toContain(String(triedOnly._id));
    expect(ids).not.toContain(String(paidOnly._id));
  });

  it("purchased_report / never_purchased_report partition on a paid SCORE_REPORT_PDF payment", async () => {
    const buyer = await makeUser();
    await makePayment(buyer._id, "SCORE_REPORT_PDF");
    const failedOnly = await makeUser();
    await makePayment(failedOnly._id, "SCORE_REPORT_PDF", "failed");
    const neverBought = await makeUser();

    const purchasedIds = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { reportFilter: "purchased_report" } })).map(String);
    expect(purchasedIds).toContain(String(buyer._id));
    expect(purchasedIds).not.toContain(String(failedOnly._id)); // a failed charge doesn't count
    expect(purchasedIds).not.toContain(String(neverBought._id));

    const neverIds = (await audienceService.resolveAudienceUserIds({ audience: "segment", segmentQuery: { reportFilter: "never_purchased_report" } })).map(String);
    expect(neverIds).not.toContain(String(buyer._id));
    expect(neverIds).toContain(String(failedOnly._id));
    expect(neverIds).toContain(String(neverBought._id));
  });

  it("combines a subscription filter with an unrelated dimension (signup date) correctly", async () => {
    const matchesBoth = await makeUser({ createdAt: new Date() });
    await makeSubscription(matchesBoth._id, "active");
    const oldButActive = await makeUser({ createdAt: new Date("2020-01-01") });
    await makeSubscription(oldButActive._id, "active");

    const ids = (
      await audienceService.resolveAudienceUserIds({
        audience: "segment",
        segmentQuery: { subscriptionFilter: "active_subscription", signupFrom: new Date("2025-01-01") },
      })
    ).map(String);
    expect(ids).toContain(String(matchesBoth._id));
    expect(ids).not.toContain(String(oldButActive._id));
  });
});

describe("previewAudience", () => {
  it("returns the count and a masked sample", async () => {
    await makeUser({ name: "Ada Example", email: "ada@example.com" });
    const preview = await audienceService.previewAudience({ audience: "all" });
    expect(preview.count).toBe(1);
    expect(preview.sample[0].name).toBe("Ada Example");
    expect(preview.sample[0].email).not.toBe("ada@example.com");
    expect(preview.sample[0].email).toContain("@example.com");
  });
});

describe("resolveDeliveryChannels", () => {
  it("ignores an opt-out for a category with userOptOutAllowed:false", async () => {
    await NotificationCategory.create({ key: "account", label: "Account", defaultChannels: ["in_app", "email"], userOptOutAllowed: false });
    const userId = new Types.ObjectId();
    await UserNotificationPref.create({ userId, categoryKey: "account", channel: "email", enabled: false });
    const { channels } = await audienceService.resolveDeliveryChannels(userId, "account", ["in_app", "email"]);
    expect(channels).toEqual(["in_app", "email"]);
  });

  it("respects an opt-out for a category with userOptOutAllowed:true", async () => {
    await NotificationCategory.create({ key: "marketing", label: "Marketing", defaultChannels: ["in_app", "email"], userOptOutAllowed: true });
    const userId = new Types.ObjectId();
    await UserNotificationPref.create({ userId, categoryKey: "marketing", channel: "email", enabled: false });
    const { channels } = await audienceService.resolveDeliveryChannels(userId, "marketing", ["in_app", "email"]);
    expect(channels).toEqual(["in_app"]);
  });

  it("passes through every requested channel when no preference row exists", async () => {
    await NotificationCategory.create({ key: "product", label: "Product", defaultChannels: ["in_app"], userOptOutAllowed: true });
    const userId = new Types.ObjectId();
    const { channels } = await audienceService.resolveDeliveryChannels(userId, "product", ["in_app"]);
    expect(channels).toEqual(["in_app"]);
  });
});
