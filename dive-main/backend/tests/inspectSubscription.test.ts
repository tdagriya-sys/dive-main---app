import { User } from "../src/models/User";
import { Subscription } from "../src/models/Subscription";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Coupon } from "../src/models/Coupon";
import { Payment } from "../src/models/Payment";
import { WebhookEvent } from "../src/models/WebhookEvent";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import { inspectSubscription, renewalVerdict, RenewalVerdictInput } from "../src/scripts/inspectSubscription";
import { analyzeOffer } from "../src/services/razorpayOfferService";

// The read-only "what will the next renewal actually charge?" diagnostic.
// First-month discounts work through a Razorpay OFFER ("offer mode"); the old
// discounted-plan-then-switch approach was removed (Razorpay refuses plan
// changes on UPI subscriptions), so a leftover old-style coupon is flagged.

const CATALOG = 11900;
const DISCOUNTED = 119;

describe("renewalVerdict (the decision itself)", () => {
  const base: RenewalVerdictInput = { couponCode: "FIRST99", couponDuration: "once", catalogPricePaise: CATALOG, firstChargeRecorded: true };
  const rz = (over: Partial<NonNullable<RenewalVerdictInput["razorpay"]>> = {}) => ({ status: "active", currentPlanAmountPaise: DISCOUNTED, hasScheduledChanges: false, ...over });

  it("no coupon: just the normal price", () => {
    expect(renewalVerdict({ ...base, couponCode: null, couponDuration: undefined })).toMatchObject({ level: "info", message: expect.stringContaining("₹119.00") });
  });

  it("a 'recurring' coupon discounts every renewal BY DESIGN — not a fault — and points to offers for first-month-only", () => {
    const v = renewalVerdict({ ...base, couponDuration: "recurring" });
    expect(v.level).toBe("info");
    expect(v.message).toContain("EVERY renewal");
    expect(v.message).toContain("Razorpay offer");
  });

  it("a coupon that no longer exists can't be checked", () => {
    expect(renewalVerdict({ ...base, couponDuration: null }).message).toContain("no longer exists");
  });

  describe("legacy 'first charge only' coupon with NO Razorpay offer (the removed plan-switch approach)", () => {
    it("PROBLEM: the subscription is stuck on the discounted plan — says the switch no longer exists and what to do", () => {
      const v = renewalVerdict({ ...base, razorpay: rz({ paymentMethod: "upi" }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("LEGACY");
      expect(v.message).toContain("switch to full price was removed");
      expect(v.message).toContain("keeps charging ₹1.19 every cycle");
      expect(v.message).toContain("Cancel it");
    });
    it("INFO: already on the normal plan — nothing stuck", () => {
      const v = renewalVerdict({ ...base, razorpay: rz({ currentPlanAmountPaise: CATALOG }) });
      expect(v.level).toBe("info");
      expect(v.message).toContain("old-style");
    });
    it("INFO: without Razorpay data it can only say the coupon is legacy", () => {
      expect(renewalVerdict(base)).toMatchObject({ level: "info", message: expect.stringContaining("no longer be redeemed") });
    });
  });

  describe("offer mode (Razorpay applies the discount itself)", () => {
    const offerBase: RenewalVerdictInput = { ...base, couponDuration: "recurring", couponOfferId: "offer_ABC123", firstChargeRecorded: true };
    it("OK: no offer link left AFTER a discounted first charge and the plan is the normal price — the offer was applied and used up", () => {
      const v = renewalVerdict({ ...offerBase, couponDuration: "once", firstChargeAmountPaise: DISCOUNTED, razorpay: rz({ currentPlanAmountPaise: CATALOG }) });
      expect(v.level).toBe("ok");
      expect(v.message).toContain("Offer applied and used up");
    });
    it("PROBLEM: no offer link AND the first charge was the FULL price — the offer never applied", () => {
      const v = renewalVerdict({ ...offerBase, firstChargeAmountPaise: CATALOG, razorpay: rz({ currentPlanAmountPaise: CATALOG }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("NO offer linked");
    });
    it("OK: on the normal plan with the offer linked — and NOT misreported as a 'recurring' coupon even if its duration is the default", () => {
      const v = renewalVerdict({ ...offerBase, razorpay: rz({ currentPlanAmountPaise: CATALOG, offerId: "offer_ABC123", paymentMethod: "upi" }) });
      expect(v.level).toBe("ok");
      expect(v.message).toContain("Offer mode working as designed");
      expect(v.message).toContain("UPI is fine");
      expect(v.message).not.toContain("EVERY renewal");
    });
    it("PROBLEM: the coupon is in offer mode but Razorpay's subscription has no offer linked (and no discounted charge)", () => {
      const v = renewalVerdict({ ...offerBase, razorpay: rz({ currentPlanAmountPaise: CATALOG }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("NO offer linked");
    });
    it("PROBLEM: offer mode but the Razorpay plan isn't the normal catalog price", () => {
      const v = renewalVerdict({ ...offerBase, razorpay: rz({ currentPlanAmountPaise: DISCOUNTED, offerId: "offer_ABC123" }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("₹1.19");
    });
    it("INFO: without Razorpay data it says it couldn't confirm the link", () => {
      expect(renewalVerdict(offerBase)).toMatchObject({ level: "info", message: expect.stringContaining("OFFER mode") });
    });
  });

  describe("a charge Razorpay collected but the app never recorded — whatever the coupon", () => {
    it("PROBLEM: filed under another duplicate row (the webhook/browser race)", () => {
      const v = renewalVerdict({ ...base, firstChargeRecorded: false, chargeRecordedOnAnotherRow: true, razorpay: rz({ paidCount: 1 }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("ANOTHER local row");
      expect(v.message).toContain("race");
    });
    it("PROBLEM: no payment recorded anywhere", () => {
      const v = renewalVerdict({ ...base, firstChargeRecorded: false, razorpay: rz({ paidCount: 1 }) });
      expect(v.level).toBe("problem");
      expect(v.message).toContain("NO payment recorded");
    });
    it("applies to a subscription with no coupon and to a recurring coupon too", () => {
      expect(renewalVerdict({ couponCode: null, catalogPricePaise: CATALOG, firstChargeRecorded: false, razorpay: rz({ paidCount: 1 }) }).level).toBe("problem");
      expect(renewalVerdict({ ...base, couponDuration: "recurring", firstChargeRecorded: false, razorpay: rz({ paidCount: 1 }) }).level).toBe("problem");
    });
    it("no charge recorded yet AND none collected is not a problem", () => {
      expect(renewalVerdict({ ...base, couponDuration: "recurring", firstChargeRecorded: false, razorpay: rz({ paidCount: 0 }) }).level).toBe("info");
    });
  });
});

describe("inspectSubscription (reads real records, asks Razorpay read-only)", () => {
  let mobileCounter = 9300000000;

  async function setup(opts: { duration?: "once" | "recurring" | null; withPayment?: boolean; razorpayId?: string; offerId?: string; paymentAmount?: number } = {}) {
    await seedDefaultSubscriptionPlansIfEmpty();
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const user = await User.create({ name: "Insp", mobile: String(mobileCounter++), email: `insp-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
    const duration = opts.duration === undefined ? "once" : opts.duration;
    if (duration) await Coupon.create({ code: "FIRST99", type: "percent", value: 99, discountDuration: duration, ...(opts.offerId ? { razorpayOfferId: opts.offerId } : {}) });
    const sub = await Subscription.create({
      userId: user._id,
      planId: plan!._id,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      startedAt: new Date(),
      razorpaySubscriptionId: opts.razorpayId ?? "sub_LIVE1",
      couponCode: duration ? "FIRST99" : undefined,
    });
    if (opts.withPayment !== false) {
      await Payment.create({ userId: user._id, purpose: "SUBSCRIPTION_INITIAL", amount: opts.paymentAmount ?? DISCOUNTED, currency: "INR", razorpayOrderId: `o_${sub._id}`, razorpayPaymentId: `p_${sub._id}`, status: "paid", isMock: false, subscriptionId: sub._id });
    }
    return { user, sub };
  }

  function fakeRazorpay(state: { hasScheduledChanges: boolean; planId?: string; pendingPlanId?: string; throwOn?: "fetch"; paymentMethod?: string; offerId?: string }) {
    const amounts: Record<string, number> = { plan_discounted: DISCOUNTED, plan_full: CATALOG };
    const client = {
      subscriptions: {
        fetch: jest.fn(async () => {
          if (state.throwOn === "fetch") throw { error: { description: "boom from razorpay" } };
          return { status: "active", plan_id: state.planId ?? "plan_discounted", has_scheduled_changes: state.hasScheduledChanges, paid_count: 1, remaining_count: 119, charge_at: 1800000000, change_scheduled_at: 1800000000, payment_method: state.paymentMethod, offer_id: state.offerId };
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

  const has = (r: { lines: string[] }, text: string) => r.lines.some((l) => l.includes(text));

  it("a leftover old-style 'first charge only' coupon still on the ₹1.19 plan is flagged LEGACY", async () => {
    const { user } = await setup();
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, paymentMethod: "upi" }) as never);
    expect(r.found).toBe(true);
    expect(r.verdict?.level).toBe("problem");
    expect(r.verdict?.message).toContain("LEGACY");
    expect(has(r, "FIRST99 — 99% off, duration \"once\"")).toBe(true);
    expect(has(r, "current plan amount  : ₹1.19")).toBe(true);
    expect(has(r, "₹1.19 (paid)")).toBe(true);
    expect(has(r, "Switch to full price")).toBe(false); // that concept no longer exists
  });

  it("offer mode end to end: shows OFFER MODE, the linked offer and the normal plan amount, and reports success", async () => {
    const { user } = await setup({ offerId: "offer_ABC123" });
    const client = fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full", paymentMethod: "upi", offerId: "offer_ABC123" });
    const r = await inspectSubscription(user.email, client as never);

    expect(has(r, "OFFER MODE (offer_ABC123)")).toBe(true);
    expect(has(r, "offer linked         : offer_ABC123")).toBe(true);
    expect(has(r, "current plan amount  : ₹119.00")).toBe(true);
    expect(r.verdict?.level).toBe("ok");
    expect(client.subscriptions.update).not.toHaveBeenCalled();
  });

  it("offer applied and USED UP (first charge discounted, plan is the normal price, no offer link left) is reported as success", async () => {
    const { user } = await setup({ offerId: "offer_ABC123" });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full", paymentMethod: "upi" }) as never);
    expect(r.verdict?.level).toBe("ok");
    expect(r.verdict?.message).toContain("Offer applied and used up");
    expect(r.verdict?.message).toContain("later cycles charge ₹119.00");
  });

  it("THE REPORTED CASE: offer mode, charged FULL price, no offer linked — the offer's own ₹100 maximum is named as the likely cause", async () => {
    const { user } = await setup({ offerId: "offer_ABC123", paymentAmount: CATALOG });
    const badOffer = {
      id: "offer_ABC123", status: "ACTIVE", starts_at: "1", ends_at: "9999999999", applicable_channels: ["RZP_CHECKOUT"],
      rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ["upi"] }, order: { min_amount: "100", max_amount: "10000" } } }, benefits: { items: [{ unit: "PERCENTAGE", value: "9900" }] } }] },
    };
    const checkOffer = async (_id: string, plans: Array<{ name: string; pricePaise: number }>, pct?: number) => analyzeOffer(badOffer, { plans, couponPercent: pct });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full", paymentMethod: "upi" }) as never, checkOffer);

    expect(has(r, "The Razorpay offer (offer_ABC123) itself")).toBe(true);
    expect(has(r, "MAXIMUM order amount is ₹100")).toBe(true);
    expect(r.verdict?.level).toBe("problem");
    expect(r.verdict?.message).toContain("NO offer linked");
    expect(r.verdict?.message).toContain("LIKELY CAUSE");
    expect(r.verdict?.message).toContain("MAXIMUM order amount is ₹100");
  });

  it("when the offer's rules fit, the inspector says so and adds no 'likely cause'", async () => {
    const { user } = await setup({ offerId: "offer_ABC123" });
    const goodOffer = {
      id: "offer_ABC123", status: "ACTIVE", starts_at: "1", ends_at: "9999999999", applicable_channels: ["RZP_CHECKOUT"],
      rules: { items: [{ criteria: { includes: { paymentInstrument: { methods: ["upi"] }, order: { min_amount: "100", max_amount: "100000" } } }, benefits: { items: [{ unit: "PERCENTAGE", value: "9900" }] } }] },
    };
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full", offerId: "offer_ABC123" }) as never, async (_id, plans, pct) => analyzeOffer(goodOffer, { plans, couponPercent: pct }));
    expect(has(r, "its rules fit this plan")).toBe(true);
    expect(r.verdict?.level).toBe("ok");
    expect(r.verdict?.message).not.toContain("LIKELY CAUSE");
  });

  it("passes the coupon's own max-uses to the offer check", async () => {
    const { user } = await setup({ offerId: "offer_ABC123" });
    await Coupon.updateOne({ code: "FIRST99" }, { maxRedemptions: 50 });
    const seen: Array<number | undefined> = [];
    await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full" }) as never, async (_id, _plans, _pct, maxUses) => {
      seen.push(maxUses);
      return { found: true, problems: [], notes: [] };
    });
    expect(seen).toEqual([50]);
  });

  it("prints the payment method as a plain fact (no plan-switch commentary)", async () => {
    const { user } = await setup({ offerId: "offer_ABC123" });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, planId: "plan_full", paymentMethod: "upi" }) as never);
    expect(r.lines).toContain("  payment method       : upi");
  });

  it("the duplicate-row situation: charge filed under another row for the same Razorpay id → names the race, lists both rows and the webhooks", async () => {
    const { user, sub } = await setup({ withPayment: false, duration: "recurring" });
    const dup = await Subscription.create({
      userId: user._id, planId: sub.planId, status: "cancelled", endedAt: new Date(),
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000), startedAt: new Date(),
      razorpaySubscriptionId: sub.razorpaySubscriptionId, createdAt: new Date(Date.now() - 60000),
    });
    await Payment.create({ userId: user._id, purpose: "SUBSCRIPTION_INITIAL", amount: DISCOUNTED, currency: "INR", razorpayOrderId: "o_dup", razorpayPaymentId: "p_dup", status: "paid", isMock: false, subscriptionId: dup._id });
    await WebhookEvent.create({ provider: "razorpay", eventType: "subscription.charged", signatureValid: true, processedOk: true, payload: { payload: { subscription: { entity: { id: sub.razorpaySubscriptionId } } } } });
    await WebhookEvent.create({ provider: "razorpay", eventType: "payment.captured", signatureValid: true, processedOk: false, error: "boom", payload: { payload: { payment: { entity: { subscription_id: sub.razorpaySubscriptionId } } } } });

    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false }) as never);

    expect(r.verdict?.level).toBe("problem");
    expect(r.verdict?.message).toContain("ANOTHER local row");
    const out = r.lines.join("\n");
    expect(out).toContain("All subscription rows for this user");
    expect(out).toContain("cancelled");
    expect(out).toContain("payments=1");
    expect(out).toContain("subscription.charged");
    expect(out).toContain("payment.captured");
    expect(out).toContain("processed=FAILED  error: boom");
  });

  it("shows when Razorpay never delivered any webhook for the subscription", async () => {
    const { user } = await setup();
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false }) as never);
    expect(has(r, "none recorded")).toBe(true);
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
    const { user } = await setup({ offerId: "offer_ABC123" });
    const r = await inspectSubscription(user.email, fakeRazorpay({ hasScheduledChanges: false, throwOn: "fetch" }) as never);
    expect(has(r, "Couldn't read Razorpay")).toBe(true);
    expect(r.verdict?.level).toBe("info"); // offer mode, but it couldn't be confirmed
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
