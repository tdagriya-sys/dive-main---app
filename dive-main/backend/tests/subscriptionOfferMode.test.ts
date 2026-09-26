import crypto from "crypto";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Payment } from "../src/models/Payment";
import { Coupon } from "../src/models/Coupon";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as subscriptionService from "../src/services/subscriptionService";

// "Offer mode": a coupon carrying a Razorpay-Dashboard offer id subscribes to
// the NORMAL catalog plan with `offer_id` linked, and Razorpay applies the
// discount — so there is no discounted one-off plan and no plan switch
// afterwards (Razorpay refuses plan changes on UPI subscriptions, which is what
// broke the "first charge only" flow). Real-Razorpay mode with a mocked SDK.

const mockPlansCreate = jest.fn();
const mockSubsCreate = jest.fn();
const mockSubsUpdate = jest.fn();
const mockPaymentsFetch = jest.fn();
const mockSubsFetch = jest.fn();
const mockSubsCancel = jest.fn();
jest.mock("razorpay", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    plans: { create: (...a: unknown[]) => mockPlansCreate(...a) },
    subscriptions: { create: (...a: unknown[]) => mockSubsCreate(...a), update: (...a: unknown[]) => mockSubsUpdate(...a), fetch: (...a: unknown[]) => mockSubsFetch(...a), cancel: (...a: unknown[]) => mockSubsCancel(...a) },
    payments: { fetch: (...a: unknown[]) => mockPaymentsFetch(...a) },
  })),
}));

const CATALOG_PLAN_ID = "plan_catalog_119";
const OFFER_ID = "offer_JHD834hjbxzhd38d";
let mobileCounter = 9320000000;

const realPlaceholder = env.razorpay.isPlaceholder;
beforeAll(() => {
  env.razorpay.isPlaceholder = false;
});
afterAll(() => {
  env.razorpay.isPlaceholder = realPlaceholder;
});

async function setup(couponOver: Partial<{ razorpayOfferId: string; discountDuration: "once" | "recurring" }> = {}) {
  await seedDefaultSubscriptionPlansIfEmpty();
  await SubscriptionPlan.updateOne({ key: "premium_monthly" }, { razorpayPlanId: CATALOG_PLAN_ID });
  await Coupon.create({ code: "FIRST99", type: "percent", value: 99, discountDuration: "once", ...couponOver });
  return User.create({ name: "Offer", mobile: String(mobileCounter++), email: `offer-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

beforeEach(() => {
  mockPlansCreate.mockReset().mockResolvedValue({ id: "plan_discounted_1" });
  // By default Razorpay reports the offer as linked; individual tests override.
  mockSubsCreate.mockReset().mockResolvedValue({ id: "sub_OFFER1", offer_id: OFFER_ID });
  mockSubsFetch.mockReset();
  mockSubsCancel.mockReset().mockResolvedValue({});
  mockSubsUpdate.mockReset().mockResolvedValue({});
  mockPaymentsFetch.mockReset();
});

describe("startSubscription — offer mode vs the discounted-plan ('every renewal') approach", () => {
  it("OFFER MODE: subscribes to the NORMAL plan with the offer linked; no discounted plan is created", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    const r = await subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99");

    expect(mockPlansCreate).not.toHaveBeenCalled();
    expect(mockSubsCreate).toHaveBeenCalledTimes(1);
    expect(mockSubsCreate.mock.calls[0][0]).toMatchObject({ plan_id: CATALOG_PLAN_ID, offer_id: OFFER_ID, notes: { userId: String(user._id), planKey: "premium_monthly", couponCode: "FIRST99" } });
    expect(r).toMatchObject({ subscriptionId: "sub_OFFER1", amount: 119, mock: false }); // 99% off ₹119 shown as ₹1.19
  });

  // Razorpay silently ignores an offer whose rules don't fit (e.g. its maximum
  // order amount is below the plan price): the subscription comes back with
  // offer_id null. Charging full price after showing a discount is the worst
  // outcome, so checkout must refuse.
  it("FAILS CLOSED when Razorpay did not link the offer: cancels the new subscription and refuses, so no full-price charge follows a discount", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockSubsCreate.mockResolvedValue({ id: "sub_NOOFFER", offer_id: null });
    mockSubsFetch.mockResolvedValue({ id: "sub_NOOFFER", offer_id: null });

    await expect(subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99")).rejects.toMatchObject({ status: 400, code: "OFFER_NOT_APPLIED" });
    expect(mockSubsCancel).toHaveBeenCalledWith("sub_NOOFFER", false);
  });

  it("re-checks the subscription when the create response lacks offer_id, and proceeds if it IS linked there", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockSubsCreate.mockResolvedValue({ id: "sub_LATE" }); // create response without the field
    mockSubsFetch.mockResolvedValue({ id: "sub_LATE", offer_id: OFFER_ID });

    const r = await subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99");
    expect(r.subscriptionId).toBe("sub_LATE");
    expect(mockSubsFetch).toHaveBeenCalledWith("sub_LATE");
    expect(mockSubsCancel).not.toHaveBeenCalled();
  });

  it("if the re-check itself fails it is treated as not linked (safe side), and a failed cancel doesn't hide the refusal", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockSubsCreate.mockResolvedValue({ id: "sub_X" });
    mockSubsFetch.mockRejectedValue(new Error("network"));
    mockSubsCancel.mockRejectedValue(new Error("cannot cancel a created subscription"));
    await expect(subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99")).rejects.toMatchObject({ code: "OFFER_NOT_APPLIED" });
  });

  it("a leftover 'first charge only' coupon WITHOUT an offer id is refused before anything is sent to Razorpay", async () => {
    const user = await setup({ discountDuration: "once" }); // legacy: made before the offer requirement
    await expect(subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99")).rejects.toMatchObject({ status: 404, code: "COUPON_INVALID" });
    expect(mockPlansCreate).not.toHaveBeenCalled();
    expect(mockSubsCreate).not.toHaveBeenCalled();
  });

  it("the offer check applies only to offer-mode coupons: a plain coupon or no coupon never re-fetches or cancels", async () => {
    const user = await setup({ discountDuration: "recurring" });
    await subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99");
    await subscriptionService.startSubscription(String(user._id), "premium_monthly");
    expect(mockSubsFetch).not.toHaveBeenCalled();
    expect(mockSubsCancel).not.toHaveBeenCalled();
  });

  it("an 'every renewal' coupon (no offer id) behaves exactly as before: a discounted one-off plan for the subscription's life, no offer_id", async () => {
    const user = await setup({ discountDuration: "recurring" });
    await subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRST99");

    expect(mockPlansCreate).toHaveBeenCalledTimes(1);
    expect(mockPlansCreate.mock.calls[0][0].item.amount).toBe(119);
    expect(mockSubsCreate.mock.calls[0][0].plan_id).toBe("plan_discounted_1");
    expect(mockSubsCreate.mock.calls[0][0]).not.toHaveProperty("offer_id");
  });

  it("no coupon: the normal plan, no offer", async () => {
    const user = await setup({ discountDuration: "recurring" });
    await subscriptionService.startSubscription(String(user._id), "premium_monthly");
    expect(mockPlansCreate).not.toHaveBeenCalled();
    expect(mockSubsCreate.mock.calls[0][0]).toMatchObject({ plan_id: CATALOG_PLAN_ID });
    expect(mockSubsCreate.mock.calls[0][0]).not.toHaveProperty("offer_id");
  });
});

describe("after payment — offer mode needs no plan switch", () => {
  const SUB_ID = "sub_OFFER1";
  const PAY_ID = "pay_OFFER1";
  const signature = () => crypto.createHmac("sha256", env.razorpay.keySecret as string).update(`${PAY_ID}|${SUB_ID}`).digest("hex");
  const verify = (userId: string) =>
    subscriptionService.verifySubscriptionPayment(userId, { planKey: "premium_monthly", razorpay_payment_id: PAY_ID, razorpay_subscription_id: SUB_ID, razorpay_signature: signature(), couponCode: "FIRST99" });

  it("a 'once' coupon in offer mode NEVER asks Razorpay to change the plan (the call UPI refuses)", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockPaymentsFetch.mockResolvedValue({ amount: 119 });
    await verify(String(user._id));
    const now = Math.floor(Date.now() / 1000);
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", {
      subscription: { entity: { id: SUB_ID, status: "active", current_start: now, current_end: now + 2592000, notes: { userId: String(user._id), planKey: "premium_monthly", couponCode: "FIRST99" } } },
      payment: { entity: { id: PAY_ID, order_id: "o1", amount: 119, subscription_id: SUB_ID } },
    });

    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(await Subscription.countDocuments({ razorpaySubscriptionId: SUB_ID })).toBe(1);
  });

  it("records the amount Razorpay ACTUALLY charged (its offer settings decide), not just the locally computed one", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockPaymentsFetch.mockResolvedValue({ amount: 500 }); // e.g. the dashboard offer was set to a flat discount
    await verify(String(user._id));
    const payment = await Payment.findOne({ userId: user._id }).lean();
    expect(mockPaymentsFetch).toHaveBeenCalledWith(PAY_ID);
    expect(payment?.amount).toBe(500);
  });

  it("falls back to the expected discounted amount if Razorpay can't be asked", async () => {
    const user = await setup({ razorpayOfferId: OFFER_ID });
    mockPaymentsFetch.mockRejectedValue(new Error("network"));
    await verify(String(user._id));
    expect((await Payment.findOne({ userId: user._id }).lean())?.amount).toBe(119);
  });

  it("a coupon without an offer never queries Razorpay for the amount (unchanged behaviour)", async () => {
    const user = await setup();
    await verify(String(user._id));
    expect(mockPaymentsFetch).not.toHaveBeenCalled();
    expect((await Payment.findOne({ userId: user._id }).lean())?.amount).toBe(119);
  });
});
