import { Types } from "mongoose";
import { Coupon } from "../src/models/Coupon";
import { User } from "../src/models/User";
import { Subscription } from "../src/models/Subscription";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as couponService from "../src/services/couponService";

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3 — discount codes.

// None of the plain validateCoupon tests below exercise eligibility (every
// coupon they create defaults to "any"), so this placeholder id never
// actually gets looked up — a real user is only needed in the dedicated
// "eligibility" describe block further down.
const DUMMY_USER_ID = "000000000000000000000000";

let mobileCounter = 9930000000;
async function makeUser(overrides: Partial<{ createdAt: Date }> = {}) {
  const user = await User.create({ name: "Coupon User", mobile: String(mobileCounter++), email: `coupon-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
  if (overrides.createdAt) {
    await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: overrides.createdAt } });
  }
  return user;
}

describe("createCoupon", () => {
  it("creates a coupon, uppercasing the code", async () => {
    const coupon = await couponService.createCoupon({ code: "save20", type: "percent", value: 20 });
    expect(coupon.code).toBe("SAVE20");
  });

  it("defaults discountDuration to 'recurring' (the pre-existing behavior) when not specified", async () => {
    const coupon = await couponService.createCoupon({ code: "NODURATION", type: "percent", value: 20 });
    expect(coupon.discountDuration).toBe("recurring");
  });

  it("persists an explicit 'once' discountDuration", async () => {
    const coupon = await couponService.createCoupon({ code: "FIRSTMONTHONLY", type: "percent", value: 50, discountDuration: "once" });
    expect(coupon.discountDuration).toBe("once");
  });

  it("refuses a duplicate code", async () => {
    await couponService.createCoupon({ code: "DUPE", type: "flat", value: 5000 });
    await expect(couponService.createCoupon({ code: "dupe", type: "flat", value: 100 })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a percent value outside 1-100", async () => {
    await expect(couponService.createCoupon({ code: "TOOBIG", type: "percent", value: 150 })).rejects.toMatchObject({ status: 400 });
  });
});

describe("validateCoupon", () => {
  it("rejects an unknown code", async () => {
    await expect(couponService.validateCoupon("NOPE", "premium_monthly", DUMMY_USER_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects an expired coupon", async () => {
    await couponService.createCoupon({ code: "OLD", type: "percent", value: 10, expiresAt: new Date(Date.now() - 1000) });
    await expect(couponService.validateCoupon("OLD", "premium_monthly", DUMMY_USER_ID)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a coupon that doesn't apply to the given plan", async () => {
    await couponService.createCoupon({ code: "ANNUALONLY", type: "percent", value: 10, appliesToPlanKeys: ["premium_annual"] });
    await expect(couponService.validateCoupon("ANNUALONLY", "premium_monthly", DUMMY_USER_ID)).rejects.toMatchObject({ status: 400 });
    await expect(couponService.validateCoupon("ANNUALONLY", "premium_annual", DUMMY_USER_ID)).resolves.toBeTruthy();
  });

  it("rejects an inactive coupon", async () => {
    const coupon = await couponService.createCoupon({ code: "OFF", type: "flat", value: 100 });
    coupon.isActive = false;
    await coupon.save();
    await expect(couponService.validateCoupon("OFF", "premium_monthly", DUMMY_USER_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects once maxRedemptions is reached", async () => {
    const coupon = await couponService.createCoupon({ code: "ONEUSE", type: "flat", value: 100, maxRedemptions: 1 });
    await couponService.redeemCoupon(String(coupon._id), DUMMY_USER_ID);
    await expect(couponService.validateCoupon("ONEUSE", "premium_monthly", DUMMY_USER_ID)).rejects.toMatchObject({ status: 400 });
  });
});

// Requirement: coupons can be restricted to who's redeeming them, not just
// which plan — an orthogonal dimension on top of appliesToPlanKeys.
describe("validateCoupon — eligibility", () => {
  beforeEach(async () => {
    await seedDefaultSubscriptionPlansIfEmpty();
  });

  it("new_user: accepts an account created within 7 days, rejects an older one", async () => {
    await couponService.createCoupon({ code: "WELCOME7", type: "percent", value: 10, eligibility: "new_user" });
    const freshUser = await makeUser();
    await expect(couponService.validateCoupon("WELCOME7", "premium_monthly", String(freshUser._id))).resolves.toBeTruthy();

    const oldUser = await makeUser({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    await expect(couponService.validateCoupon("WELCOME7", "premium_monthly", String(oldUser._id))).rejects.toMatchObject({ status: 400, code: "COUPON_NOT_ELIGIBLE" });
  });

  it("first_time: accepts a user with no prior subscription, rejects one who already had any", async () => {
    await couponService.createCoupon({ code: "FIRSTTIME", type: "percent", value: 10, eligibility: "first_time" });
    const newSubscriber = await makeUser();
    await expect(couponService.validateCoupon("FIRSTTIME", "premium_monthly", String(newSubscriber._id))).resolves.toBeTruthy();

    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const returningUser = await makeUser();
    await Subscription.create({ userId: returningUser._id, planId: plan!._id, status: "cancelled", currentPeriodStart: new Date(), currentPeriodEnd: new Date(), startedAt: new Date(), endedAt: new Date() });
    await expect(couponService.validateCoupon("FIRSTTIME", "premium_monthly", String(returningUser._id))).rejects.toMatchObject({ status: 400, code: "COUPON_NOT_ELIGIBLE" });
  });

  it("renewal: the exact inverse of first_time", async () => {
    await couponService.createCoupon({ code: "WELCOMEBACK", type: "percent", value: 10, eligibility: "renewal" });
    const newSubscriber = await makeUser();
    await expect(couponService.validateCoupon("WELCOMEBACK", "premium_monthly", String(newSubscriber._id))).rejects.toMatchObject({ status: 400, code: "COUPON_NOT_ELIGIBLE" });

    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const returningUser = await makeUser();
    await Subscription.create({ userId: returningUser._id, planId: plan!._id, status: "cancelled", currentPeriodStart: new Date(), currentPeriodEnd: new Date(), startedAt: new Date(), endedAt: new Date() });
    await expect(couponService.validateCoupon("WELCOMEBACK", "premium_monthly", String(returningUser._id))).resolves.toBeTruthy();
  });

  it("any (default): no eligibility restriction at all", async () => {
    await couponService.createCoupon({ code: "OPENALL", type: "percent", value: 10 });
    const user = await makeUser();
    await expect(couponService.validateCoupon("OPENALL", "premium_monthly", String(user._id))).resolves.toBeTruthy();
  });
});

describe("computeDiscountedPricePaise", () => {
  it("applies a percent discount", async () => {
    const coupon = await couponService.createCoupon({ code: "PCT20", type: "percent", value: 20 });
    expect(couponService.computeDiscountedPricePaise(10000, coupon)).toBe(8000);
  });

  it("applies a flat discount", async () => {
    const coupon = await couponService.createCoupon({ code: "FLAT500", type: "flat", value: 500 });
    expect(couponService.computeDiscountedPricePaise(10000, coupon)).toBe(9500);
  });

  it("never goes below zero even if the flat discount exceeds the price", async () => {
    const coupon = await couponService.createCoupon({ code: "HUGEFLAT", type: "flat", value: 999999 });
    expect(couponService.computeDiscountedPricePaise(10000, coupon)).toBe(0);
  });
});

describe("redeemCoupon — atomic redemption guard", () => {
  it("succeeds while under the cap, fails once it's reached", async () => {
    const coupon = await couponService.createCoupon({ code: "CAP2", type: "flat", value: 100, maxRedemptions: 2 });
    const first = await couponService.redeemCoupon(String(coupon._id), DUMMY_USER_ID);
    const second = await couponService.redeemCoupon(String(coupon._id), DUMMY_USER_ID);
    const third = await couponService.redeemCoupon(String(coupon._id), DUMMY_USER_ID);
    expect(first?.redeemedCount).toBe(1);
    expect(second?.redeemedCount).toBe(2);
    expect(third).toBeNull();
  });

  it("unlimited coupons (no maxRedemptions) always succeed", async () => {
    const coupon = await couponService.createCoupon({ code: "UNLIMITED", type: "flat", value: 100 });
    for (let i = 0; i < 5; i += 1) {
      const result = await couponService.redeemCoupon(String(coupon._id), DUMMY_USER_ID);
      expect(result).not.toBeNull();
    }
    expect((await Coupon.findById(coupon._id))!.redeemedCount).toBe(5);
  });

  it("under simulated concurrency, the cap is never exceeded", async () => {
    const coupon = await couponService.createCoupon({ code: "RACE", type: "flat", value: 100, maxRedemptions: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => couponService.redeemCoupon(String(coupon._id), new Types.ObjectId().toString())));
    const succeeded = results.filter((r) => r !== null);
    expect(succeeded.length).toBe(3);
    expect((await Coupon.findById(coupon._id))!.redeemedCount).toBe(3);
  });

  // Requirement: a per-user limit, independent of (and on top of) the total
  // limit — e.g. "one use per person" on a coupon with no total cap at all.
  it("enforces a per-user cap independently of the total cap", async () => {
    const coupon = await couponService.createCoupon({ code: "ONEPERUSER", type: "flat", value: 100, maxRedemptionsPerUser: 1 });
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();

    const first = await couponService.redeemCoupon(String(coupon._id), userA);
    expect(first?.redeemedCount).toBe(1);

    // Same user, second attempt — blocked by their own per-user cap, even
    // though the coupon's total cap (none set) has plenty of room left.
    const second = await couponService.redeemCoupon(String(coupon._id), userA);
    expect(second).toBeNull();
    expect((await Coupon.findById(coupon._id))!.redeemedCount).toBe(1); // unchanged — not double-counted

    // A different user is unaffected by userA's own cap.
    const otherUser = await couponService.redeemCoupon(String(coupon._id), userB);
    expect(otherUser?.redeemedCount).toBe(2);
  });

  it("rolls back the per-user bump when the total cap turns out to already be reached", async () => {
    const coupon = await couponService.createCoupon({ code: "TOTALCAP1", type: "flat", value: 100, maxRedemptions: 1, maxRedemptionsPerUser: 5 });
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();

    const first = await couponService.redeemCoupon(String(coupon._id), userA);
    expect(first?.redeemedCount).toBe(1);

    // userB has plenty of per-user room (cap 5), but the coupon's total cap
    // (1) is already exhausted by userA — userB's attempt must fail
    // cleanly, and their own per-user counter must not be left incremented
    // for a redemption that never actually went through.
    const second = await couponService.redeemCoupon(String(coupon._id), userB);
    expect(second).toBeNull();

    const userBStillEligible = await couponService.validateCoupon("TOTALCAP1", "premium_monthly", userB).catch((e) => e);
    // Fails for the TOTAL cap reason (COUPON_LIMIT_REACHED), not because
    // userB's own per-user counter was wrongly left at a nonzero value.
    expect(userBStillEligible).toMatchObject({ status: 400, code: "COUPON_LIMIT_REACHED" });
  });
});

describe("updateCoupon", () => {
  it("updates the mutable fields", async () => {
    const coupon = await couponService.createCoupon({ code: "EDITME", type: "percent", value: 10 });
    const updated = await couponService.updateCoupon(String(coupon._id), { isActive: false, maxRedemptions: 50 });
    expect(updated.isActive).toBe(false);
    expect(updated.maxRedemptions).toBe(50);
  });

  it("switches an existing coupon's discountDuration — only affects future redemptions, not ones already in flight", async () => {
    const coupon = await couponService.createCoupon({ code: "SWITCHME", type: "percent", value: 10, discountDuration: "recurring" });
    const updated = await couponService.updateCoupon(String(coupon._id), { discountDuration: "once" });
    expect(updated.discountDuration).toBe("once");
  });

  it("throws for an unknown id", async () => {
    await expect(couponService.updateCoupon("64b000000000000000000000", { isActive: false })).rejects.toMatchObject({ status: 404 });
  });
});
