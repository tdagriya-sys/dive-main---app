import crypto from "crypto";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Payment } from "../src/models/Payment";
import { Coupon } from "../src/models/Coupon";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as subscriptionService from "../src/services/subscriptionService";

// The paid checkout is confirmed twice — by the browser's verify call and by
// Razorpay's `subscription.charged` webhook — in EITHER order. Both must end up
// on ONE local subscription row that carries the coupon and the charge. (Found
// live: the webhook winning the race created a coupon-less row, verify then
// created a second row, and the charge sat on the cancelled first copy while
// the active copy had no charge recorded.)
//
// Real-Razorpay mode with a mocked SDK. The app also never asks Razorpay to
// CHANGE a subscription's plan any more (Razorpay refuses that on UPI), so
// `subscriptions.update` must never be called.

const mockUpdate = jest.fn();
jest.mock("razorpay", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ subscriptions: { update: (...a: unknown[]) => mockUpdate(...a), cancel: jest.fn() } })),
}));

const CATALOG_PLAN_ID = "plan_catalog_119";
const SUB_ID = "sub_LIVE_race";
const PAY_ID = "pay_LIVE_race";
let mobileCounter = 9310000000;

const realPlaceholder = env.razorpay.isPlaceholder;
beforeAll(() => {
  env.razorpay.isPlaceholder = false; // exercise the real (mocked-SDK) Razorpay branches
});
afterAll(() => {
  env.razorpay.isPlaceholder = realPlaceholder;
});

async function setup(couponOver: Partial<{ discountDuration: "once" | "recurring"; razorpayOfferId: string }> = {}) {
  await seedDefaultSubscriptionPlansIfEmpty();
  await SubscriptionPlan.updateOne({ key: "premium_monthly" }, { razorpayPlanId: CATALOG_PLAN_ID });
  await Coupon.create({ code: "FIRST99", type: "percent", value: 99, discountDuration: "recurring", ...couponOver });
  return User.create({ name: "Race", mobile: String(mobileCounter++), email: `race-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

const signature = (paymentId: string, subscriptionId: string) => crypto.createHmac("sha256", env.razorpay.keySecret as string).update(`${paymentId}|${subscriptionId}`).digest("hex");

function chargedWebhook(userId: string, paymentId = PAY_ID, withCouponNote = true) {
  const now = Math.floor(Date.now() / 1000);
  return subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", {
    subscription: { entity: { id: SUB_ID, status: "active", current_start: now, current_end: now + 2592000, notes: { userId, planKey: "premium_monthly", ...(withCouponNote ? { couponCode: "FIRST99" } : {}) } } },
    payment: { entity: { id: paymentId, order_id: `order_${paymentId}`, amount: 119, subscription_id: SUB_ID } },
  });
}

const verify = (userId: string) =>
  subscriptionService.verifySubscriptionPayment(userId, {
    planKey: "premium_monthly",
    razorpay_payment_id: PAY_ID,
    razorpay_subscription_id: SUB_ID,
    razorpay_signature: signature(PAY_ID, SUB_ID),
    couponCode: "FIRST99",
  });

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({});
});

async function assertSingleHealthyRow(userId: string) {
  const rows = await Subscription.find({ razorpaySubscriptionId: SUB_ID }).lean();
  expect(rows).toHaveLength(1); // never a duplicate
  expect(rows[0]).toMatchObject({ status: "active", couponCode: "FIRST99" });
  const payments = await Payment.find({ userId }).lean();
  expect(payments).toHaveLength(1);
  expect(String(payments[0].subscriptionId)).toBe(String(rows[0]._id)); // the charge sits on the ACTIVE row
  expect(payments[0]).toMatchObject({ purpose: "SUBSCRIPTION_INITIAL", amount: 119, status: "paid" });
  return rows[0];
}

describe("webhook and verify race — both orders converge on one row", () => {
  it("WEBHOOK FIRST, then verify: one row with the coupon and the charge", async () => {
    const user = await setup();
    await chargedWebhook(String(user._id));
    await verify(String(user._id));
    await assertSingleHealthyRow(user._id.toString());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("VERIFY FIRST, then the webhook: the same single row", async () => {
    const user = await setup();
    await verify(String(user._id));
    await chargedWebhook(String(user._id));
    await assertSingleHealthyRow(user._id.toString());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("the webhook alone (browser never confirmed) still carries the coupon from the Razorpay notes", async () => {
    const user = await setup();
    await chargedWebhook(String(user._id));
    const rows = await Subscription.find({ razorpaySubscriptionId: SUB_ID }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].couponCode).toBe("FIRST99");
  });

  it("a duplicate delivery of the same charge changes nothing (one payment, one row)", async () => {
    const user = await setup();
    await chargedWebhook(String(user._id));
    await chargedWebhook(String(user._id));
    await verify(String(user._id));
    await assertSingleHealthyRow(user._id.toString());
  });

  it("the same holds for an offer-mode coupon — and the app still never changes the plan", async () => {
    const user = await setup({ discountDuration: "once", razorpayOfferId: "offer_ABC123" });
    await chargedWebhook(String(user._id));
    await verify(String(user._id));
    await assertSingleHealthyRow(user._id.toString());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("no coupon: the race still yields one row", async () => {
    const user = await setup();
    await chargedWebhook(String(user._id), PAY_ID, false);
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: PAY_ID,
      razorpay_subscription_id: SUB_ID,
      razorpay_signature: signature(PAY_ID, SUB_ID),
    });
    expect(await Subscription.countDocuments({ razorpaySubscriptionId: SUB_ID })).toBe(1);
  });
});

describe("existing duplicate rows (created before the fix) are handled gracefully", () => {
  it("a webhook lands on the newest LIVE row, not on an older cancelled copy", async () => {
    const user = await setup();
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const base = { userId: user._id, planId: plan!._id, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000), startedAt: new Date(), razorpaySubscriptionId: SUB_ID };
    await Subscription.create({ ...base, status: "cancelled", endedAt: new Date(), createdAt: new Date(Date.now() - 60000) });
    const live = await Subscription.create({ ...base, status: "active", couponCode: "FIRST99" });

    await chargedWebhook(String(user._id));

    const payments = await Payment.find({ userId: user._id }).lean();
    expect(payments).toHaveLength(1);
    expect(String(payments[0].subscriptionId)).toBe(String(live._id));
  });
});

describe("plan switches are unchanged", () => {
  it("subscribing again with a DIFFERENT Razorpay subscription still supersedes the old one", async () => {
    const user = await setup();
    await chargedWebhook(String(user._id));
    const other = "sub_LIVE_other";
    const now = Math.floor(Date.now() / 1000);
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", {
      subscription: { entity: { id: other, status: "active", current_start: now, current_end: now + 2592000, notes: { userId: String(user._id), planKey: "premium_annual" } } },
      payment: { entity: { id: "pay_other", order_id: "order_other", amount: 109900, subscription_id: other } },
    });

    expect((await Subscription.findOne({ razorpaySubscriptionId: SUB_ID }).lean())?.status).toBe("cancelled");
    expect((await Subscription.findOne({ razorpaySubscriptionId: other }).lean())?.status).toBe("active");
  });
});
