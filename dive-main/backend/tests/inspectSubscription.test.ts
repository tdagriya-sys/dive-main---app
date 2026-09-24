import { User } from "../src/models/User";
import { Subscription } from "../src/models/Subscription";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Coupon } from "../src/models/Coupon";
import { Payment } from "../src/models/Payment";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import { inspectSubscription, renewalVerdict, RenewalVerdictInput } from "../src/scripts/inspectSubscription";

// The read-only "what will the next renewal actually charge?" diagnostic,
// built for a "first charge only" coupon whose autopay showed the discounted
// amount.

const CATALOG = 11900;
const DISCOUNTED = 119;

describe("renewalVerdict (the decision itself)", () => {
  const base: RenewalVerdictInput = { couponCode: "FIRST99", couponDuration: "once", catalogPricePaise: CATALOG, revertScheduledLocally: true, firstChargeRecorded: true };
  const rz = (over: Partial<NonNullable<RenewalVerdictInput["razorpay"]>> = {}) => ({ status: "active", currentPlanAmountPaise: DISCOUNTED, hasScheduledChanges: false, ...over });

  it("no coupon: just the normal price", () => {
    expect(renewalVerdict({ ...base, couponCode: null, couponDuration: undefined })).toMatchObject({ level: "info", message: expect.stringContaining("₹119.00") });
  });

  it("a 'recurring' coupon discounts every renewal BY DESIGN — not a fault", () => {
    const v = renewalVerdict({ ...base, couponDuration: "recurring" });
    expect(v.level).toBe("info");
    expect(v.message).toContain("EVERY renewal");
  });

  it("a coupon that no longer exists can't be checked", () => {
    expect(renewalVerdict({ ...base, couponDuration: null }).message).toContain("no longer exists");
  });

  it("'once' but no first charge recorded yet: nothing is expected to be scheduled", () => {
    expect(renewalVerdict({ ...base, firstChargeRecorded: false, revertScheduledLocally: false })).toMatchObject({ level: "info", message: expect.stringContaining("no first charge") });
  });

  it("OK: Razorpay has a scheduled switch to the full price (and explains the ₹1.19 mandate is expected)", () => {
    const v = renewalVerdict({ ...base, razorpay: rz({ hasScheduledChanges: true, pendingPlanAmountPaise: CATALOG }) });
    expect(v.level).toBe("ok");
    expect(v.message).toContain("Working as designed");
    expect(v.message).toContain("₹1.19");
    expect(v.message).toContain("₹119.00");
  });

  it("OK: the subscription is already on the full-price plan", () => {
    expect(renewalVerdict({ ...base, razorpay: rz({ currentPlanAmountPaise: CATALOG }) }).level).toBe("ok");
  });

  it("PROBLEM: 'once' coupon, Razorpay has no scheduled switch, still on the discounted plan", () => {
    const v = renewalVerdict({ ...base, revertScheduledLocally: false, razorpay: rz() });
    expect(v.level).toBe("problem");
    expect(v.message).toContain("NO scheduled switch");
    expect(v.message).toContain("every cycle");
    expect(v.message).toContain("failed to revert one-time-coupon");
  });

  it("PROBLEM: the app thought it scheduled the switch but Razorpay doesn't have it", () => {
    const v = renewalVerdict({ ...base, revertScheduledLocally: true, razorpay: rz() });
    expect(v.level).toBe("problem");
    expect(v.message).toContain("schedule seems to have been lost");
  });

  it("PROBLEM: Razorpay has a scheduled change, but to some other amount", () => {
    const v = renewalVerdict({ ...base, razorpay: rz({ hasScheduledChanges: true, pendingPlanAmountPaise: 5000 }) });
    expect(v.level).toBe("problem");
    expect(v.message).toContain("₹50.00");
  });

  it("without Razorpay data, falls back to what the app recorded", () => {
    expect(renewalVerdict({ ...base, revertScheduledLocally: true }).level).toBe("ok");
    expect(renewalVerdict({ ...base, revertScheduledLocally: false }).level).toBe("problem");
  });
});

describe("inspectSubscription (reads real records, asks Razorpay read-only)", () => {
  let mobileCounter = 9300000000;

  async function setup(opts: { duration?: "once" | "recurring" | null; withPayment?: boolean; revertStamped?: boolean; razorpayId?: string } = {}) {
    await seedDefaultSubscriptionPlansIfEmpty();
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const user = await User.create({ name: "Insp", mobile: String(mobileCounter++), email: `insp-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
    const duration = opts.duration === undefined ? "once" : opts.duration;
    if (duration) await Coupon.create({ code: "FIRST99", type: "percent", value: 99, discountDuration: duration });
    const sub = await Subscription.create({
      userId: user._id,
      planId: plan!._id,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      startedAt: new Date(),
      razorpaySubscriptionId: opts.razorpayId ?? "sub_LIVE1",
      couponCode: duration ? "FIRST99" : undefined,
      couponOnceRevertScheduledAt: opts.revertStamped ? new Date() : undefined,
    });
    if (opts.withPayment !== false) {
      await Payment.create({ userId: user._id, purpose: "SUBSCRIPTION_INITIAL", amount: DISCOUNTED, currency: "INR", razorpayOrderId: `o_${sub._id}`, razorpayPaymentId: `p_${sub._id}`, status: "paid", isMock: false, subscriptionId: sub._id });
    }
    return { user, sub };
  }

  function fakeRazorpay(state: { hasScheduledChanges: boolean; planId?: string; pendingPlanId?: string; throwOn?: "fetch" }) {
    const amounts: Record<string, number> = { plan_discounted: DISCOUNTED, plan_full: CATALOG };
    const client = {
      subscriptions: {
        fetch: jest.fn(async () => {
          if (state.throwOn === "fetch") throw { error: { description: "boom from razorpay" } };
          return { status: "active", plan_id: state.planId ?? "plan_discounted", has_scheduled_changes: state.hasScheduledChanges, paid_count: 1, remaining_count: 119, charge_at: 1800000000, change_scheduled_at: 1800000000 };
        }),
        pendingUpdate: jest.fn(async () => ({ plan_id: state.pendingPlanId })),
        // If the diagnostic ever tried to change anything, these would be called:
        update: jest.fn(),
        cancel: jest.fn(),
      },
      plans: { fetch: jest.fn(async (id: string) => ({ item: { amount: amounts[id] } })), create: jest.fn() },
    };
    return client;
  }

  it("the reported case: once-coupon, still on the ₹1.19 plan, nothing scheduled → flags the problem", async () => {
    const { user } = await setup();
    const client = fakeRazorpay({ hasScheduledChanges: false });
    const r = await inspectSubscription(user.email, client as never);

    expect(r.found).toBe(true);
    expect(r.verdict?.level).toBe("problem");
    const out = r.lines.join("\n");
    expect(out).toContain("FIRST99 — 99% off, duration \"once\"");
    expect(out).toContain("current plan amount  : ₹1.19");
    expect(out).toContain("scheduled plan change: none");
    expect(out).toContain("₹1.19 (paid)");
  });

  it("healthy case: Razorpay has the scheduled switch to the full-price plan", async () => {
    const { user } = await setup({ revertStamped: true });
    const client = fakeRazorpay({ hasScheduledChanges: true, pendingPlanId: "plan_full" });
    const r = await inspectSubscription(user.email, client as never);

    expect(r.verdict?.level).toBe("ok");
    expect(r.lines.join("\n")).toContain("scheduled plan change: yes → ₹119.00");
    expect(client.subscriptions.pendingUpdate).toHaveBeenCalled();
  });

  it("a 'recurring' coupon is reported as by-design, not a problem", async () => {
    const { user } = await setup({ duration: "recurring" });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false }) as never);
    expect(r.verdict?.level).toBe("info");
    expect(r.verdict?.message).toContain("recurring");
  });

  it("STRICTLY read-only: only fetches — never updates/cancels at Razorpay, never changes the database", async () => {
    const { user, sub } = await setup();
    const client = fakeRazorpay({ hasScheduledChanges: false });
    const before = JSON.stringify(await Subscription.findById(sub._id).lean());

    await inspectSubscription(user.email, client as never);

    expect(client.subscriptions.update).not.toHaveBeenCalled();
    expect(client.subscriptions.cancel).not.toHaveBeenCalled();
    expect(client.plans.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await Subscription.findById(sub._id).lean())).toBe(before);
    expect(await Payment.countDocuments({})).toBe(1);
  });

  it("if Razorpay can't be read, says so and still gives a verdict from the app's own records", async () => {
    const { user } = await setup({ revertStamped: false });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, throwOn: "fetch" }) as never);
    expect(r.lines.join("\n")).toContain("Couldn't read Razorpay");
    expect(r.verdict?.level).toBe("problem"); // never scheduled, per the app's own record
  });

  it("a mock (test-mode) subscription is not sent to Razorpay at all", async () => {
    const { user } = await setup({ razorpayId: "mock_sub_abc" });
    const client = fakeRazorpay({ hasScheduledChanges: false });
    await inspectSubscription(user.email, client as never);
    expect(client.subscriptions.fetch).not.toHaveBeenCalled();
  });

  it("reports a missing user or a user with no subscription", async () => {
    expect(await inspectSubscription("nobody@example.com")).toMatchObject({ found: false });
    const user = await User.create({ name: "No Sub", mobile: String(mobileCounter++), email: "nosub@example.com", age: 30, passwordHash: "x" });
    expect((await inspectSubscription(user.email)).lines.join("\n")).toContain("no subscription");
  });
});
