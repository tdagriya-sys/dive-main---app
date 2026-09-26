import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Coupon } from "../src/models/Coupon";
import { UserNotification } from "../src/models/UserNotification";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as subscriptionService from "../src/services/subscriptionService";

// The renewal reminder must state what the customer will REALLY be charged
// next: the discounted amount while a coupon/offer still applies, the normal
// price otherwise — never a flat catalog price that overstates a discounted charge.

const mockFetch = jest.fn();
jest.mock("razorpay", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ subscriptions: { fetch: (...a: unknown[]) => mockFetch(...a) } })),
}));

const CATALOG = 11900; // premium_monthly
let mobileCounter = 9330000000;

const realPlaceholder = env.razorpay.isPlaceholder;
afterAll(() => {
  env.razorpay.isPlaceholder = realPlaceholder;
});
beforeEach(async () => {
  env.razorpay.isPlaceholder = false;
  mockFetch.mockReset();
  await seedDefaultSubscriptionPlansIfEmpty();
});

async function make(opts: { couponCode?: string; status?: "active" | "trialing"; razorpayId?: string; daysOut?: number } = {}) {
  const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
  const user = await User.create({ name: "Rem", mobile: String(mobileCounter++), email: `rem-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
  const sub = await Subscription.create({
    userId: user._id,
    planId: plan!._id,
    status: opts.status ?? "active",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + (opts.daysOut ?? 2) * 86400000),
    startedAt: new Date(),
    razorpaySubscriptionId: opts.razorpayId ?? "sub_LIVE_rem",
    couponCode: opts.couponCode,
  });
  return { plan: plan!, user, sub };
}

describe("expectedNextChargePaise", () => {
  it("no coupon → the catalog price", async () => {
    const { plan, sub } = await make();
    expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
  });

  it("a trial is never discounted, whatever it carries", async () => {
    await Coupon.create({ code: "TRIALCPN", type: "percent", value: 50, discountDuration: "recurring" });
    const { plan, sub } = await make({ couponCode: "TRIALCPN", status: "trialing" });
    expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
  });

  it("an 'every renewal' coupon (no offer) → the discounted price, every cycle, with no Razorpay call", async () => {
    await Coupon.create({ code: "HALF", type: "percent", value: 50, discountDuration: "recurring" });
    const { plan, sub } = await make({ couponCode: "HALF" });
    expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(5950);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a flat coupon works the same way", async () => {
    await Coupon.create({ code: "FLAT20", type: "flat", value: 2000, discountDuration: "recurring" });
    const { plan, sub } = await make({ couponCode: "FLAT20" });
    expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(9900);
  });

  describe("offer mode (Razorpay decides how many cycles are discounted)", () => {
    beforeEach(() => Coupon.create({ code: "OFFER99", type: "percent", value: 99, discountDuration: "once", razorpayOfferId: "offer_ABC123" }));

    it("offer still linked at Razorpay (discounted cycles remain) → the discounted price", async () => {
      mockFetch.mockResolvedValue({ offer_id: "offer_ABC123" });
      const { plan, sub } = await make({ couponCode: "OFFER99" });
      expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(119);
      expect(mockFetch).toHaveBeenCalledWith("sub_LIVE_rem");
    });

    it("offer link gone (the discounted cycles are used up) → the regular price", async () => {
      mockFetch.mockResolvedValue({ offer_id: null });
      const { plan, sub } = await make({ couponCode: "OFFER99" });
      expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
    });

    it("Razorpay can't be reached → falls back to the regular price (a reminder never fails because of it)", async () => {
      mockFetch.mockRejectedValue(new Error("network"));
      const { plan, sub } = await make({ couponCode: "OFFER99" });
      expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
    });

    it("a mock/placeholder-mode subscription never calls Razorpay", async () => {
      const { plan, sub } = await make({ couponCode: "OFFER99", razorpayId: "mock_sub_x" });
      expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
      env.razorpay.isPlaceholder = true;
      const real = await make({ couponCode: "OFFER99" });
      expect(await subscriptionService.expectedNextChargePaise(real.sub, real.plan)).toBe(CATALOG);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("a coupon that has since been deleted → the regular price", async () => {
    const { plan, sub } = await make({ couponCode: "GONE" });
    expect(await subscriptionService.expectedNextChargePaise(sub, plan)).toBe(CATALOG);
  });
});

describe("the reminder message itself", () => {
  it("states the DISCOUNTED amount for a customer on an 'every renewal' coupon", async () => {
    await Coupon.create({ code: "HALF2", type: "percent", value: 50, discountDuration: "recurring" });
    const { user } = await make({ couponCode: "HALF2" });
    await subscriptionService.runRenewalReminderSweep();
    const n = await UserNotification.findOne({ userId: user._id, channel: "in_app" }).lean();
    expect(n?.body).toContain("₹59.50");
    expect(n?.body).not.toContain("₹119");
  });

  it("states the discounted amount while an offer's discounted cycles remain, the regular one after", async () => {
    await Coupon.create({ code: "OFFER99B", type: "percent", value: 99, discountDuration: "once", razorpayOfferId: "offer_XYZ" });
    // Razorpay answers per subscription: A still has its offer linked, B's discounted cycles are used up.
    mockFetch.mockImplementation(async (id: string) => (id === "sub_A" ? { offer_id: "offer_XYZ" } : { offer_id: null }));
    const during = await make({ couponCode: "OFFER99B", razorpayId: "sub_A" });
    const after = await make({ couponCode: "OFFER99B", razorpayId: "sub_B" });

    await subscriptionService.runRenewalReminderSweep();
    const dn = await UserNotification.findOne({ userId: during.user._id, channel: "in_app" }).lean();
    const an = await UserNotification.findOne({ userId: after.user._id, channel: "in_app" }).lean();
    expect(dn?.body).toContain("₹1.19"); // 99% off ₹119 while the offer still applies
    expect(dn?.body).not.toContain("₹119");
    expect(an?.body).toContain("₹119"); // discounted cycles used up -> the regular price
  });

  it("a customer with no coupon still sees the normal price (unchanged behaviour)", async () => {
    const { user } = await make();
    await subscriptionService.runRenewalReminderSweep();
    const n = await UserNotification.findOne({ userId: user._id, channel: "in_app" }).lean();
    expect(n?.body).toMatch(/automatically charged ₹119/);
  });
});
