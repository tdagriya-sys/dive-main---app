import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Payment } from "../src/models/Payment";
import { Invoice } from "../src/models/Invoice";
import { Coupon } from "../src/models/Coupon";
import { UserNotification } from "../src/models/UserNotification";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as subscriptionService from "../src/services/subscriptionService";
import * as couponService from "../src/services/couponService";
import * as adminSettingService from "../src/services/adminSettingService";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.2/§3.3/§5.3 — the Razorpay
// Subscriptions lifecycle. `env.razorpay.isPlaceholder` is forced true for
// every test run (tests/setupEnv.ts), so every path here exercises MOCK
// mode — the real-Razorpay-API branches are structurally identical to
// paymentService.ts's already-proven one-off-order equivalents and aren't
// separately unit-tested here for the same reason those aren't either.

let mobileCounter = 9920000000;
async function makeUser(overrides: Partial<{ hasUsedTrial: boolean }> = {}) {
  return User.create({ name: "Sub User", mobile: String(mobileCounter++), email: `sub-${mobileCounter}@example.com`, age: 30, passwordHash: "x", hasUsedTrial: overrides.hasUsedTrial ?? false });
}

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("publishPlanToRazorpay", () => {
  it("mints a mock plan id in mock mode", async () => {
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" });
    const id = await subscriptionService.publishPlanToRazorpay(plan!);
    expect(id).toMatch(/^mock_plan_/);
  });

  it("refuses to publish a free plan", async () => {
    const plan = await SubscriptionPlan.findOne({ key: "freemium" });
    await expect(subscriptionService.publishPlanToRazorpay(plan!)).rejects.toMatchObject({ status: 400 });
  });
});

describe("startSubscription", () => {
  it("returns a mock subscription id for a first-timer", async () => {
    const user = await makeUser();
    const result = await subscriptionService.startSubscription(String(user._id), "premium_monthly");
    expect(result.mock).toBe(true);
    expect(result.subscriptionId).toMatch(/^mock_sub_/);
  });

  // Requirement: a direct "Subscribe" never folds in the 15-day free trial,
  // regardless of hasUsedTrial — that's startFreeTrial's own separate,
  // payment-free flow. Verified end-to-end (immediate "active" status, no
  // start_at delay) in verifySubscriptionPayment's own tests below.
  it("behaves identically for a first-timer and someone who already used their trial", async () => {
    const freshUser = await makeUser();
    const usedTrialUser = await makeUser({ hasUsedTrial: true });
    const freshResult = await subscriptionService.startSubscription(String(freshUser._id), "premium_monthly");
    const usedResult = await subscriptionService.startSubscription(String(usedTrialUser._id), "premium_monthly");
    expect(freshResult.mock).toBe(true);
    expect(usedResult.mock).toBe(true);
  });

  it("refuses Freemium itself", async () => {
    const user = await makeUser();
    await expect(subscriptionService.startSubscription(String(user._id), "freemium")).rejects.toMatchObject({ status: 400 });
  });

  it("refuses re-subscribing to the SAME plan while it's already active", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    await expect(subscriptionService.startSubscription(String(user._id), "premium_monthly")).rejects.toMatchObject({ status: 409 });
  });

  // Requirement: "subscribed to monthly, then after 2 days wants to
  // subscribe to annual" must be allowed — switching to a DIFFERENT plan
  // while one is active is an upgrade, not a disallowed double-subscribe.
  it("allows switching to a DIFFERENT plan while one is already active", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    const result = await subscriptionService.startSubscription(String(user._id), "premium_annual");
    expect(result.mock).toBe(true);
  });

  // Requirement: confirming exactly what "cancel, then buy" does. A
  // cancelled-but-still-active subscription (cancelAtPeriodEnd:true) is
  // still "active" until its period genuinely ends, so the SAME-plan block
  // still applies — reactivateSubscription is the intended path for "I
  // changed my mind about the same plan," not re-buying. A DIFFERENT plan
  // is still a normal switch, clubbing the (still-live) remaining days.
  it("still blocks buying the SAME plan while merely cancelled-but-active (use reactivate instead)", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_cancel_same",
      razorpay_subscription_id: "mock_sub_cancel_same",
      razorpay_signature: "mock",
    });
    await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true });
    await expect(subscriptionService.startSubscription(String(user._id), "premium_monthly")).rejects.toMatchObject({ status: 409, code: "ALREADY_SUBSCRIBED" });
  });

  it("still allows switching to a DIFFERENT plan while merely cancelled-but-active", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_cancel_diff",
      razorpay_subscription_id: "mock_sub_cancel_diff",
      razorpay_signature: "mock",
    });
    await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true });
    const result = await subscriptionService.startSubscription(String(user._id), "premium_annual");
    expect(result.mock).toBe(true);
  });

  // Requirement: a trial and a real paid subscription are separate things —
  // subscribing to the very SAME plan you're already trialing must be
  // allowed (converting the trial to a real paid subscription), unlike the
  // same-plan block above, which only applies to an already-PAID plan.
  it("allows subscribing to the SAME plan while only trialing it (not yet paid)", async () => {
    const user = await makeUser();
    await subscriptionService.startFreeTrial(String(user._id), "premium_monthly");
    const result = await subscriptionService.startSubscription(String(user._id), "premium_monthly");
    expect(result.mock).toBe(true);
  });
});

// Requirement: switching plans mid-cycle must "club" the two durations —
// whatever validity remains on the old plan carries over onto the new one,
// instead of being discarded the moment the new plan's own natural period
// is computed from "now".
describe("upsertLocalSubscription — clubbing remaining validity on a plan switch", () => {
  it("carries the old plan's remaining days over onto the new plan's natural period", async () => {
    // hasUsedTrial: true so this first verify buys a genuinely-paid monthly
    // cycle (periodEndFor) rather than a 15-day trial — the trial path is
    // covered separately and isn't what this test is about.
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    const monthlySub = await Subscription.findOne({ userId: user._id, status: "active" });
    expect(monthlySub).toBeTruthy();

    // Simulate "2 days into a 30-day monthly cycle" — 28 days left.
    const remainingEnd = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
    monthlySub!.currentPeriodEnd = remainingEnd;
    await monthlySub!.save();

    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_annual",
      razorpay_payment_id: "mock_payment_2",
      razorpay_subscription_id: "mock_sub_2",
      razorpay_signature: "mock",
    });

    const annualSub = await Subscription.findOne({ userId: user._id, status: "active" });
    expect(annualSub!.razorpaySubscriptionId).toBe("mock_sub_2");

    const naturalAnnualEnd = new Date();
    naturalAnnualEnd.setFullYear(naturalAnnualEnd.getFullYear() + 1);
    const expectedEnd = naturalAnnualEnd.getTime() + 28 * 24 * 60 * 60 * 1000;
    expect(Math.abs(annualSub!.currentPeriodEnd.getTime() - expectedEnd)).toBeLessThan(5000);

    // The old plan's subscription is superseded (cancelled), not left
    // dangling as a second live row.
    const oldSub = await Subscription.findById(monthlySub!._id);
    expect(oldSub!.status).toBe("cancelled");
  });

  it("a fresh purchase (no prior active subscription) gets exactly the plan's natural period, no club", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    const sub = await Subscription.findOne({ userId: user._id, status: "active" });
    const natural = new Date();
    natural.setMonth(natural.getMonth() + 1);
    expect(Math.abs(sub!.currentPeriodEnd.getTime() - natural.getTime())).toBeLessThan(5000);
  });

  // Requirement: converting an ongoing trial into a real paid subscription
  // of the SAME plan clubs the remaining trial days too, exactly like
  // switching between two different paid plans does.
  it("clubs remaining trial days onto a same-plan paid conversion", async () => {
    const user = await makeUser();
    const trial = await subscriptionService.startFreeTrial(String(user._id), "premium_monthly");
    // Simulate "5 days into the 15-day trial" — 10 days left.
    const remainingEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await Subscription.updateOne({ _id: trial._id }, { currentPeriodEnd: remainingEnd });

    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_convert",
      razorpay_subscription_id: "mock_sub_convert",
      razorpay_signature: "mock",
    });

    const paidSub = await Subscription.findOne({ userId: user._id, status: "active" });
    expect(paidSub!.razorpaySubscriptionId).toBe("mock_sub_convert");
    const naturalMonthlyEnd = new Date();
    naturalMonthlyEnd.setMonth(naturalMonthlyEnd.getMonth() + 1);
    const expectedEnd = naturalMonthlyEnd.getTime() + 10 * 24 * 60 * 60 * 1000;
    expect(Math.abs(paidSub!.currentPeriodEnd.getTime() - expectedEnd)).toBeLessThan(5000);

    const oldTrial = await Subscription.findById(trial._id);
    expect(oldTrial!.status).toBe("cancelled");
  });
});

describe("verifySubscriptionPayment", () => {
  it("rejects a malformed mock payment id", async () => {
    const user = await makeUser();
    await expect(
      subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "not-mock", razorpay_subscription_id: "mock_sub_1", razorpay_signature: "mock" })
    ).rejects.toMatchObject({ status: 400 });
  });

  // Regression: a genuinely real (signature-validated, non-`mock_sub_`)
  // subscription payment used to skip creating the Payment/Invoice ledger
  // row entirely — it relied solely on the `subscription.charged` webhook,
  // which can never reach a local/dev server (no public URL) and isn't
  // configured on every production deploy either. The subscription itself
  // still activated correctly (upsertLocalSubscription doesn't depend on
  // this), but the user's own invoice was silently never generated — caught
  // from a real user's live report. Unlike other real-Razorpay branches in
  // this file (which call the actual API and stay untested per this file's
  // own top comment), `validatePaymentVerification` is pure local HMAC
  // verification with no network call, so a genuinely valid signature can
  // be computed here directly, matching exactly what Razorpay's own
  // Checkout handler would have hashed.
  it("for a genuinely real (signature-validated) payment, still creates the Payment ledger row and invoice — not just in mock mode", async () => {
    const crypto = require("crypto");
    const user = await makeUser();
    const subscriptionId = "sub_real_test_123";
    const paymentId = "pay_real_test_456";
    const signature = crypto.createHmac("sha256", "REPLACE_ME").update(`${paymentId}|${subscriptionId}`).digest("hex");

    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: subscriptionId,
      razorpay_signature: signature,
    });
    expect(subscription.status).toBe("active");

    const payment = await Payment.findOne({ userId: user._id }).lean();
    expect(payment).toBeTruthy();
    expect(payment?.purpose).toBe("SUBSCRIPTION_INITIAL");
    expect(payment?.isMock).toBe(false);
    expect(payment?.razorpayPaymentId).toBe(paymentId);

    const invoice = await Invoice.findOne({ userId: user._id }).lean();
    expect(invoice).toBeTruthy();
  });

  // If the webhook happens to win the race (fires before this call reaches
  // the server — the normal production case with a configured webhook URL),
  // verify must not create a second, duplicate Payment row for the same
  // charge. Simulates "the webhook already recorded it" directly (rather
  // than driving the full webhook handler, which has its own plan-resolution
  // prerequisites unrelated to what's being tested here) — what matters is
  // verify's own idempotency guard, keyed on razorpayPaymentId.
  it("is idempotent with an already-recorded Payment row for the same real payment id (webhook won the race)", async () => {
    const user = await makeUser();
    const subscriptionId = "sub_real_test_race";
    const paymentId = "pay_real_test_race";
    const signature = require("crypto").createHmac("sha256", "REPLACE_ME").update(`${paymentId}|${subscriptionId}`).digest("hex");

    await Payment.create({
      userId: user._id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: 11900,
      currency: "INR",
      razorpayOrderId: `sub_${subscriptionId}_${paymentId}`,
      razorpayPaymentId: paymentId,
      status: "paid",
      isMock: false,
    });

    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: subscriptionId,
      razorpay_signature: signature,
    });

    const payments = await Payment.find({ razorpayPaymentId: paymentId }).lean();
    expect(payments.length).toBe(1); // never duplicated
  });

  // Requirement: a direct paid subscribe is always an immediate real charge
  // — never a trial folded in, regardless of whether this is the user's
  // very first subscription and would otherwise have been eligible for one.
  it("for a first-timer, creates an ACTIVE Subscription immediately (no trial folded in) and a paid ledger row", async () => {
    const user = await makeUser();
    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    expect(subscription.status).toBe("active");
    const payment = await Payment.findOne({ userId: user._id }).lean();
    expect(payment?.purpose).toBe("SUBSCRIPTION_INITIAL");
    expect(payment?.status).toBe("paid");
    expect(payment?.amount).toBe(11900);
  });

  // Requirement: subscribing directly without ever claiming the free trial
  // permanently forfeits it (the button disappears, same as if they'd used
  // it) — but tagged distinctly from an actual claim so the admin Trials
  // tab can tell "never claimed, subscribed directly" apart from "claimed
  // a real trial."
  it("tags a first-timer's direct subscribe as hasUsedTrial + forfeited-without-claim", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_1",
      razorpay_subscription_id: "mock_sub_1",
      razorpay_signature: "mock",
    });
    const reloadedUser = await User.findById(user._id).lean();
    expect(reloadedUser?.hasUsedTrial).toBe(true);
    expect(reloadedUser?.trialForfeitedWithoutClaim).toBe(true);
  });

  it("with no trial available, creates an active Subscription AND a paid ledger row (mock mode has no webhook)", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_2",
      razorpay_subscription_id: "mock_sub_2",
      razorpay_signature: "mock",
    });
    expect(subscription.status).toBe("active");
    const payment = await Payment.findOne({ userId: user._id }).lean();
    expect(payment?.purpose).toBe("SUBSCRIPTION_INITIAL");
    expect(payment?.status).toBe("paid");
    expect(payment?.amount).toBe(11900);
  });

  it("supersedes a prior subscription rather than stacking", async () => {
    const user = await makeUser();
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_a", razorpay_subscription_id: "mock_sub_a", razorpay_signature: "mock" });
    await Subscription.updateOne({ razorpaySubscriptionId: "mock_sub_a" }, { status: "cancelled" }); // simulate it ending
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_annual", razorpay_payment_id: "mock_payment_b", razorpay_subscription_id: "mock_sub_b", razorpay_signature: "mock" });
    const live = await Subscription.find({ userId: user._id, status: { $in: ["trialing", "active", "past_due"] } }).lean();
    expect(live.length).toBe(1);
  });
});

describe("cancelSubscription", () => {
  it("cancelAtPeriodEnd:true just flags it, doesn't end access immediately", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_c", razorpay_subscription_id: "mock_sub_c", razorpay_signature: "mock" });
    const cancelled = await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true });
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(cancelled.status).toBe("active");
  });

  it("atPeriodEnd:false ends it immediately", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_d", razorpay_subscription_id: "mock_sub_d", razorpay_signature: "mock" });
    const cancelled = await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: false });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).toBeTruthy();
  });

  it("throws when there's no active subscription to cancel", async () => {
    const user = await makeUser();
    await expect(subscriptionService.cancelSubscription(String(user._id))).rejects.toMatchObject({ status: 404 });
  });

  // Requirement: cancel no longer calls Razorpay immediately by default —
  // only jobs/subscriptionCancelNotice.cron.ts's daily sweep (or an explicit
  // notifyRazorpayNow) does. A mock subscription never reaches the real
  // -Razorpay branch either way, but razorpayCancelRequestedAt staying unset
  // here is what lets reactivateSubscription below freely undo it.
  it("leaves razorpayCancelRequestedAt unset on a plain at-period-end cancel", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_notify1", razorpay_subscription_id: "mock_sub_notify1", razorpay_signature: "mock" });
    const cancelled = await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true, notifyRazorpayNow: false });
    expect(cancelled.razorpayCancelRequestedAt).toBeFalsy();
  });
});

// Requirement: undo an at-period-end cancel — self-serve, no re-payment,
// no re-clubbing needed since currentPeriodEnd was never touched by cancel.
describe("reactivateSubscription", () => {
  it("flips cancelAtPeriodEnd back off, leaving status/currentPeriodEnd untouched", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_react1", razorpay_subscription_id: "mock_sub_react1", razorpay_signature: "mock" });
    const cancelled = await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true });
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    const originalPeriodEnd = cancelled.currentPeriodEnd.getTime();

    const reactivated = await subscriptionService.reactivateSubscription(String(user._id));
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
    expect(reactivated.status).toBe("active");
    expect(reactivated.currentPeriodEnd.getTime()).toBe(originalPeriodEnd);
  });

  it("throws if there's no active subscription", async () => {
    const user = await makeUser();
    await expect(subscriptionService.reactivateSubscription(String(user._id))).rejects.toMatchObject({ status: 404 });
  });

  it("throws if the subscription isn't actually scheduled to cancel", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_react2", razorpay_subscription_id: "mock_sub_react2", razorpay_signature: "mock" });
    await expect(subscriptionService.reactivateSubscription(String(user._id))).rejects.toMatchObject({ status: 400, code: "NOT_CANCELLED" });
  });

  // Requirement: once Razorpay has actually been notified (here simulated
  // directly on the doc, standing in for either an explicit notifyRazorpayNow
  // cancel or runCancelNoticeSweep having already run), reactivate must
  // refuse honestly instead of flipping the local flag and pretending
  // auto-billing is restored — see reactivateSubscription's own comment.
  it("honestly refuses once Razorpay has already been notified, and leaves cancelAtPeriodEnd untouched", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_react3", razorpay_subscription_id: "mock_sub_react3", razorpay_signature: "mock" });
    await subscriptionService.cancelSubscription(String(user._id), { atPeriodEnd: true });
    await Subscription.updateOne({ razorpaySubscriptionId: "mock_sub_react3" }, { razorpayCancelRequestedAt: new Date() });

    await expect(subscriptionService.reactivateSubscription(String(user._id))).rejects.toMatchObject({ status: 409, code: "RAZORPAY_ALREADY_NOTIFIED" });
    const stillCancelled = await Subscription.findOne({ razorpaySubscriptionId: "mock_sub_react3" }).lean();
    expect(stillCancelled?.cancelAtPeriodEnd).toBe(true);
  });
});

describe("runCancelNoticeSweep", () => {
  async function makeCancelledSubscription(userId: string, opts: { razorpaySubscriptionId?: string; currentPeriodEnd: Date; cancelAtPeriodEnd?: boolean; status?: "active" | "past_due"; razorpayCancelRequestedAt?: Date }) {
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const now = new Date();
    return Subscription.create({
      userId,
      planId: plan!._id,
      status: opts.status ?? "active",
      currentPeriodStart: now,
      currentPeriodEnd: opts.currentPeriodEnd,
      startedAt: now,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? true,
      razorpaySubscriptionId: opts.razorpaySubscriptionId,
      razorpayCancelRequestedAt: opts.razorpayCancelRequestedAt,
    });
  }

  it("picks up a real (non-mock) cancelled subscription renewing within the buffer window", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h out, well inside the 48h default buffer
    await makeCancelledSubscription(String(user._id), { razorpaySubscriptionId: "sub_real_due_soon", currentPeriodEnd: soon });

    const summary = await subscriptionService.runCancelNoticeSweep();
    expect(summary.checked).toBe(1);
  });

  it("leaves alone a cancelled subscription that isn't renewing soon", async () => {
    const user = await makeUser();
    const farOut = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000); // 20 days out
    await makeCancelledSubscription(String(user._id), { razorpaySubscriptionId: "sub_real_not_due", currentPeriodEnd: farOut });

    const summary = await subscriptionService.runCancelNoticeSweep();
    expect(summary.checked).toBe(0);
  });

  it("ignores a subscription that isn't cancelled at all", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await makeCancelledSubscription(String(user._id), { razorpaySubscriptionId: "sub_real_not_cancelled", currentPeriodEnd: soon, cancelAtPeriodEnd: false });

    const summary = await subscriptionService.runCancelNoticeSweep();
    expect(summary.checked).toBe(0);
  });

  it("never re-notifies a subscription Razorpay has already been told about", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await makeCancelledSubscription(String(user._id), { razorpaySubscriptionId: "sub_real_already_notified", currentPeriodEnd: soon, razorpayCancelRequestedAt: new Date() });

    const summary = await subscriptionService.runCancelNoticeSweep();
    expect(summary.checked).toBe(0);
  });

  // env.razorpay.isPlaceholder is forced true for the whole test run (tests
  // /setupEnv.ts), so even a matched candidate is never actually notified
  // here — same "only mock mode is unit-tested" convention as every other
  // Razorpay-touching sweep in this codebase (see runDunningSweep's tests).
  it("never actually notifies Razorpay while running in placeholder/mock mode", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await makeCancelledSubscription(String(user._id), { razorpaySubscriptionId: "sub_real_placeholder_mode", currentPeriodEnd: soon });

    const summary = await subscriptionService.runCancelNoticeSweep();
    expect(summary.notified).toBe(0);
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: "sub_real_placeholder_mode" }).lean();
    expect(subscription?.razorpayCancelRequestedAt).toBeFalsy();
  });
});

describe("runRenewalReminderSweep", () => {
  async function makeReminderSubscription(
    userId: string,
    opts: { currentPeriodEnd: Date; status?: "active" | "trialing" | "past_due"; cancelAtPeriodEnd?: boolean; renewalReminderPeriodEnd?: Date; renewalRemindersSentDays?: number[] }
  ) {
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const now = new Date();
    return Subscription.create({
      userId,
      planId: plan!._id,
      status: opts.status ?? "active",
      currentPeriodStart: now,
      currentPeriodEnd: opts.currentPeriodEnd,
      startedAt: now,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
      renewalReminderPeriodEnd: opts.renewalReminderPeriodEnd,
      renewalRemindersSentDays: opts.renewalRemindersSentDays,
    });
  }

  // The default AdminSetting document doesn't exist yet in a fresh test DB,
  // so getRenewalReminderSettings() falls back to env.renewalReminderDaysBefore
  // — [7, 3, 0] per tests/setupEnv.ts's own default env, i.e. every one of
  // these tests runs against that three-tier default unless a test
  // overrides it via adminSettingService.setRenewalReminderSettings.

  it("notifies a renewing subscriber within the default window, folding every newly-due threshold into one notice", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days out — crosses both the 7-day and 3-day thresholds at once
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 1, notified: 1 });

    const notifications = await UserNotification.find({ userId: user._id }).lean();
    expect(notifications.map((n) => n.channel).sort()).toEqual(["email", "in_app"]);
    expect(notifications[0].title).toMatch(/renews/i);
    expect(notifications[0].body).toMatch(/renews on/i);
    expect(notifications[0].body).toMatch(/automatically charged/i);

    const subscription = await Subscription.findOne({ userId: user._id }).lean();
    expect(subscription?.renewalRemindersSentDays?.sort()).toEqual([3, 7]);
  });

  // Trials never auto-charge — startFreeTrial never creates a Razorpay
  // subscription at all, so the message must never claim a charge is coming
  // (or that one won't happen either, since that still implies one COULD).
  it("tells a trialing subscriber their trial is ending, with no charge language either way", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon, status: "trialing" });

    await subscriptionService.runRenewalReminderSweep();
    const notification = await UserNotification.findOne({ userId: user._id, channel: "in_app" }).lean();
    expect(notification?.title).toMatch(/trial/i);
    expect(notification?.body).not.toMatch(/charged/i);
  });

  it("gives a trialing subscriber the same trial-ending message whether or not they already cancelled it", async () => {
    const user1 = await makeUser();
    const user2 = await makeUser();
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user1._id), { currentPeriodEnd: soon, status: "trialing", cancelAtPeriodEnd: false });
    await makeReminderSubscription(String(user2._id), { currentPeriodEnd: soon, status: "trialing", cancelAtPeriodEnd: true });

    await subscriptionService.runRenewalReminderSweep();
    const [n1, n2] = await Promise.all([
      UserNotification.findOne({ userId: user1._id, channel: "in_app" }).lean(),
      UserNotification.findOne({ userId: user2._id, channel: "in_app" }).lean(),
    ]);
    expect(n1?.title).toBe(n2?.title);
    expect(n1?.body).toBe(n2?.body);
  });

  it("tells a subscriber with auto-renew off that access is ending, not renewing", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon, cancelAtPeriodEnd: true });

    await subscriptionService.runRenewalReminderSweep();
    const notification = await UserNotification.findOne({ userId: user._id, channel: "in_app" }).lean();
    expect(notification?.title).toMatch(/ending soon/i);
    expect(notification?.body).toMatch(/auto-renew is turned off/i);
  });

  it("leaves alone a subscription that isn't renewing soon", async () => {
    const user = await makeUser();
    const farOut = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: farOut });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 0, notified: 0 });
  });

  it("skips a past_due subscription — dunningService already sends its own notice", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon, status: "past_due" });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 0, notified: 0 });
  });

  it("never re-notifies once every currently-due threshold has already fired", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // daysRemaining ~2 → only the 7-day and 3-day thresholds are due
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon, renewalReminderPeriodEnd: soon, renewalRemindersSentDays: [7, 3] });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 0, notified: 0 });
  });

  it("sends a second, separate reminder once a later threshold becomes due", async () => {
    const user = await makeUser();
    const dueToday = new Date(Date.now() + 12 * 60 * 60 * 1000); // ~0 days out — the 0-day threshold, still unsent
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: dueToday, renewalReminderPeriodEnd: dueToday, renewalRemindersSentDays: [7, 3] });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 1, notified: 1 });
    const subscription = await Subscription.findOne({ userId: user._id }).lean();
    expect(subscription?.renewalRemindersSentDays?.sort()).toEqual([0, 3, 7]);
  });

  it("becomes eligible again once currentPeriodEnd moves forward past a prior reminder", async () => {
    const user = await makeUser();
    const oldPeriodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const newSoon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const subscription = await makeReminderSubscription(String(user._id), { currentPeriodEnd: oldPeriodEnd, renewalReminderPeriodEnd: oldPeriodEnd, renewalRemindersSentDays: [7] });
    // Simulate a renewal that moved currentPeriodEnd forward without touching the old reminder tracking.
    subscription.currentPeriodEnd = newSoon;
    await subscription.save();

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 1, notified: 1 });
    const refreshed = await Subscription.findOne({ userId: user._id }).lean();
    expect(refreshed?.renewalReminderPeriodEnd?.getTime()).toBe(newSoon.getTime());
  });

  it("honors an admin-configured reminder window wider than the default", async () => {
    const current = await adminSettingService.getRenewalReminderSettings();
    await adminSettingService.setRenewalReminderSettings({ ...current, daysBefore: [15, 10] }, "admin@example.com");
    const user = await makeUser();
    const twelveDaysOut = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000); // outside the [7,3,0] default, inside a [15,10] window
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: twelveDaysOut });

    const summary = await subscriptionService.runRenewalReminderSweep();
    expect(summary).toEqual({ checked: 1, notified: 1 });
  });

  it("uses the admin-edited message template, with tokens substituted", async () => {
    const current = await adminSettingService.getRenewalReminderSettings();
    await adminSettingService.setRenewalReminderSettings(
      { ...current, messages: { ...current.messages, renewal: { title: "Custom renewal title", body: "{{planName}} renews on {{periodEnd}} for INR {{price}}." } } },
      "admin@example.com"
    );
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon });

    await subscriptionService.runRenewalReminderSweep();
    const notification = await UserNotification.findOne({ userId: user._id, channel: "in_app" }).lean();
    expect(notification?.title).toBe("Custom renewal title");
    expect(notification?.body).toBe(`Premium (Monthly) renews on ${soon.toLocaleDateString("en-IN")} for INR 119.`);
  });

  it("never creates a popup notification while enablePopup is off (the default)", async () => {
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon });

    await subscriptionService.runRenewalReminderSweep();
    const popup = await UserNotification.findOne({ userId: user._id, channel: "popup" }).lean();
    expect(popup).toBeNull();
  });

  it("creates a popup notification, with the message's own highlightStyle baked into bodyHtml, once enablePopup is on", async () => {
    const current = await adminSettingService.getRenewalReminderSettings();
    await adminSettingService.setRenewalReminderSettings(
      {
        ...current,
        enablePopup: true,
        messages: {
          ...current.messages,
          renewal: { title: "Renews soon", body: "Renews in ==3 days==!", highlightStyle: { color: "#D4AF37", fontWeight: "bold" } },
        },
      },
      "admin@example.com"
    );
    const user = await makeUser();
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await makeReminderSubscription(String(user._id), { currentPeriodEnd: soon });

    await subscriptionService.runRenewalReminderSweep();
    const popup = await UserNotification.findOne({ userId: user._id, channel: "popup" }).lean();
    expect(popup?.title).toBe("Renews soon");
    expect(popup?.bodyHtml).toBe('Renews in <span style="color:#D4AF37;font-weight:bold">3 days</span>!');
  });
});

describe("grantComplimentarySubscription", () => {
  it("creates a fully local active Subscription with no Razorpay id", async () => {
    const user = await makeUser();
    const subscription = await subscriptionService.grantComplimentarySubscription(String(user._id), "premium_monthly", 30);
    expect(subscription.status).toBe("active");
    expect(subscription.razorpaySubscriptionId).toBeUndefined();
    const daysLeft = (subscription.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(29);
  });
});

describe("startFreeTrial", () => {
  it("grants a trialing subscription with no Razorpay id, flips hasUsedTrial, no Payment row", async () => {
    const user = await makeUser();
    const subscription = await subscriptionService.startFreeTrial(String(user._id), "premium_monthly");
    expect(subscription.status).toBe("trialing");
    expect(subscription.razorpaySubscriptionId).toBeUndefined();
    expect(await Payment.countDocuments({ userId: user._id })).toBe(0);
    const reloadedUser = await User.findById(user._id).lean();
    expect(reloadedUser?.hasUsedTrial).toBe(true);
    // A genuine claim, not a forfeit — distinct from a direct-subscribe's
    // own tagging (see verifySubscriptionPayment's own tests).
    expect(reloadedUser?.trialForfeitedWithoutClaim).toBe(false);
  });

  it("refuses a user who has already used their one-time trial", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await expect(subscriptionService.startFreeTrial(String(user._id), "premium_monthly")).rejects.toMatchObject({ status: 409, code: "TRIAL_ALREADY_USED" });
  });

  it("refuses a user who already has an active subscription", async () => {
    const user = await makeUser();
    await subscriptionService.grantComplimentarySubscription(String(user._id), "premium_monthly", 30);
    await expect(subscriptionService.startFreeTrial(String(user._id), "premium_annual")).rejects.toMatchObject({ status: 409, code: "ALREADY_SUBSCRIBED" });
  });

  it("refuses Freemium and any plan with trialDays: 0", async () => {
    const user = await makeUser();
    await expect(subscriptionService.startFreeTrial(String(user._id), "freemium")).rejects.toMatchObject({ status: 400 });

    await SubscriptionPlan.updateOne({ key: "premium_monthly" }, { trialDays: 0 });
    await expect(subscriptionService.startFreeTrial(String(user._id), "premium_monthly")).rejects.toMatchObject({ status: 400, code: "NO_TRIAL_AVAILABLE" });
  });
});

// The daily sweep (jobs/trialExpiry.cron.ts) — tidies up admin-visible
// status for a free trial whose currentPeriodEnd has passed. Real-time
// access already reverts via entitlementService's own currentPeriodEnd
// filter without this; this only covers the STATUS field.
describe("sweepExpiredFreeTrials", () => {
  it("expires a payment-free trial past its currentPeriodEnd, leaves a real (Razorpay-backed) trial alone", async () => {
    const user1 = await makeUser();
    const trial = await subscriptionService.startFreeTrial(String(user1._id), "premium_monthly");
    await Subscription.updateOne({ _id: trial._id }, { currentPeriodEnd: new Date(Date.now() - 1000) });

    const user2 = await makeUser({ hasUsedTrial: true });
    const razorpayBacked = await Subscription.create({
      userId: user2._id,
      planId: trial.planId,
      status: "trialing",
      currentPeriodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() - 1000),
      razorpaySubscriptionId: "mock_sub_still_trialing",
      startedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    });

    const summary = await subscriptionService.sweepExpiredFreeTrials();
    expect(summary.expired).toBe(1);

    expect((await Subscription.findById(trial._id).lean())?.status).toBe("expired");
    expect((await Subscription.findById(razorpayBacked._id).lean())?.status).toBe("trialing");
  });

  it("leaves a still-live trial alone", async () => {
    const user = await makeUser();
    const trial = await subscriptionService.startFreeTrial(String(user._id), "premium_monthly");
    const summary = await subscriptionService.sweepExpiredFreeTrials();
    expect(summary.expired).toBe(0);
    expect((await Subscription.findById(trial._id).lean())?.status).toBe("trialing");
  });
});

describe("changeSubscriptionPlan", () => {
  it("swaps the local planId (mock subscription, no real Razorpay call)", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_e", razorpay_subscription_id: "mock_sub_e", razorpay_signature: "mock" });
    const subscription = await Subscription.findOne({ userId: user._id });
    const annual = await SubscriptionPlan.findOne({ key: "premium_annual" }).lean();
    const updated = await subscriptionService.changeSubscriptionPlan(subscription!, "premium_annual");
    expect(String(updated.planId)).toBe(String(annual!._id));
  });
});

describe("handleSubscriptionWebhookEvent", () => {
  async function createRealLikeSubscription(userId: string) {
    // Simulates the "webhook wins the race" path — no prior verify call,
    // just notes carrying enough to self-create (see subscriptionService.ts's
    // findOrCreateLocalSubscription).
    return { subscriptionEntityId: "sub_real_1", userId };
  }

  it("subscription.charged self-creates the Subscription via notes when it wins the race, and records the ledger row", async () => {
    const user = await makeUser();
    const { subscriptionEntityId } = await createRealLikeSubscription(String(user._id));

    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", {
      subscription: { entity: { id: subscriptionEntityId, status: "active", current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000, notes: { userId: String(user._id), planKey: "premium_monthly" } } },
      payment: { entity: { id: "pay_1", order_id: "order_1", amount: 11900, subscription_id: subscriptionEntityId } },
    });

    const subscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionEntityId }).lean();
    expect(subscription?.status).toBe("active");
    const payment = await Payment.findOne({ razorpayPaymentId: "pay_1" }).lean();
    expect(payment?.purpose).toBe("SUBSCRIPTION_INITIAL");
    expect(payment?.amount).toBe(11900);
  });

  it("a second subscription.charged for the same subscription records a RENEWAL, not another INITIAL", async () => {
    const user = await makeUser();
    const subId = "sub_real_2";
    const baseSub = { id: subId, status: "active", current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000, notes: { userId: String(user._id), planKey: "premium_monthly" } };
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", { subscription: { entity: baseSub }, payment: { entity: { id: "pay_a", order_id: "order_a", amount: 11900, subscription_id: subId } } });
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", { subscription: { entity: baseSub }, payment: { entity: { id: "pay_b", order_id: "order_b", amount: 11900, subscription_id: subId } } });

    const renewals = await Payment.find({ subscriptionId: (await Subscription.findOne({ razorpaySubscriptionId: subId }))!._id }).lean();
    expect(renewals.length).toBe(2);
    expect(renewals.map((p) => p.purpose).sort()).toEqual(["SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL"]);
  });

  it("subscription.cancelled marks the local row cancelled", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_f", razorpay_subscription_id: "mock_sub_f", razorpay_signature: "mock" });
    await Subscription.updateOne({ razorpaySubscriptionId: "mock_sub_f" }, { razorpaySubscriptionId: "sub_cancel_test" });
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.cancelled", { subscription: { entity: { id: "sub_cancel_test", status: "cancelled" } } });
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: "sub_cancel_test" }).lean();
    expect(subscription?.status).toBe("cancelled");
    expect(subscription?.endedAt).toBeTruthy();
  });

  it("subscription.halted marks the local row past_due", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_g", razorpay_subscription_id: "mock_sub_g", razorpay_signature: "mock" });
    await Subscription.updateOne({ razorpaySubscriptionId: "mock_sub_g" }, { razorpaySubscriptionId: "sub_halt_test" });
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.halted", { subscription: { entity: { id: "sub_halt_test", status: "halted" } } });
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: "sub_halt_test" }).lean();
    expect(subscription?.status).toBe("past_due");
  });

  it("payment.failed records a failed ledger row and marks past_due", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    await subscriptionService.verifySubscriptionPayment(String(user._id), { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_h", razorpay_subscription_id: "mock_sub_h", razorpay_signature: "mock" });
    await Subscription.updateOne({ razorpaySubscriptionId: "mock_sub_h" }, { razorpaySubscriptionId: "sub_fail_test" });
    await subscriptionService.handleSubscriptionWebhookEvent("payment.failed", { payment: { entity: { id: "pay_fail_1", subscription_id: "sub_fail_test", amount: 11900, error_description: "Card declined" } } });
    const subscription = await Subscription.findOne({ razorpaySubscriptionId: "sub_fail_test" }).lean();
    expect(subscription?.status).toBe("past_due");
    const failedPayment = await Payment.findOne({ razorpayPaymentId: "pay_fail_1" }).lean();
    expect(failedPayment?.status).toBe("failed");
    expect(failedPayment?.failureReason).toBe("Card declined");
  });

  it("ignores an unrecognized subscription id gracefully (no crash)", async () => {
    await expect(
      subscriptionService.handleSubscriptionWebhookEvent("subscription.cancelled", { subscription: { entity: { id: "sub_unknown", status: "cancelled" } } })
    ).resolves.toBeUndefined();
  });
});

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §9's "6b" row — GST invoicing now
// piggybacks on every "paid" transition this file already exercises.
describe("invoice generation on a paid subscription charge", () => {
  it("generates a matching GST invoice the moment verify creates a real (non-trial) Payment", async () => {
    const user = await makeUser({ hasUsedTrial: true });
    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_inv1",
      razorpay_subscription_id: "mock_sub_inv1",
      razorpay_signature: "mock",
    });
    const payment = await Payment.findOne({ subscriptionId: subscription._id }).lean();
    const invoice = await Invoice.findOne({ paymentId: payment!._id }).lean();
    expect(invoice).toBeTruthy();
    expect(invoice!.totalPaise).toBe(11900);
  });

  // The only path that's genuinely payment-free is startFreeTrial — a
  // direct subscribe (verifySubscriptionPayment) is always an immediate
  // real charge now, so it always produces an invoice; there's no "trial
  // verify" case reachable through it anymore.
  it("generates nothing for a payment-free trial claim — no charge happened", async () => {
    const user = await makeUser();
    await subscriptionService.startFreeTrial(String(user._id), "premium_monthly");
    expect(await Invoice.countDocuments({ userId: user._id })).toBe(0);
    expect(await Payment.countDocuments({ userId: user._id })).toBe(0);
  });

  it("generates a matching invoice from a subscription.charged webhook too", async () => {
    const user = await makeUser();
    await subscriptionService.handleSubscriptionWebhookEvent("subscription.charged", {
      subscription: { entity: { id: "sub_inv_webhook", status: "active", current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000, notes: { userId: String(user._id), planKey: "premium_monthly" } } },
      payment: { entity: { id: "pay_inv_webhook", order_id: "order_inv_webhook", amount: 11900, subscription_id: "sub_inv_webhook" } },
    });
    const payment = await Payment.findOne({ razorpayPaymentId: "pay_inv_webhook" }).lean();
    const invoice = await Invoice.findOne({ paymentId: payment!._id }).lean();
    expect(invoice).toBeTruthy();
    expect(invoice!.totalPaise).toBe(11900);
  });
});

// Phase 6b — coupons. See couponService.ts's own top comment for why only
// the mock-mode discount path is exercised here (the real-Razorpay branch
// that creates an ephemeral discounted Plan follows the same
// "only mock is unit-tested" convention as every other Razorpay call in this
// file).
describe("startSubscription / verifySubscriptionPayment with a coupon", () => {
  it("applies a percent discount to the mock subscription amount and the resulting Payment", async () => {
    await couponService.createCoupon({ code: "HALFOFF", type: "percent", value: 50 });
    const user = await makeUser({ hasUsedTrial: true });

    const started = await subscriptionService.startSubscription(String(user._id), "premium_monthly", "HALFOFF");
    expect(started.amount).toBe(5950); // 50% of 11900

    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_coupon1",
      razorpay_subscription_id: started.subscriptionId,
      razorpay_signature: "mock",
      couponCode: "HALFOFF",
    });
    const payment = await Payment.findOne({ subscriptionId: subscription._id }).lean();
    expect(payment!.amount).toBe(5950);
    expect(subscription.couponCode).toBe("HALFOFF");
  });

  // Requirement / bug fix: a coupon must only be counted as redeemed once
  // the payment actually completes — a user who starts checkout with a
  // coupon applied and then abandons/exits the payment page (never calling
  // verify) must not burn a redemption for a purchase that never happened.
  it("does NOT redeem the coupon just from starting checkout — only once verify actually completes", async () => {
    const coupon = await couponService.createCoupon({ code: "ONCE", type: "flat", value: 1000, maxRedemptions: 1 });
    const user = await makeUser({ hasUsedTrial: true });

    const started = await subscriptionService.startSubscription(String(user._id), "premium_monthly", "ONCE");
    expect((await Coupon.findById(coupon._id))!.redeemedCount).toBe(0); // not yet — checkout merely started

    // A second, different user can also validate/start against the SAME
    // still-unredeemed coupon in the meantime — the slot hasn't been
    // consumed by the first user's still-pending checkout.
    const user2 = await makeUser({ hasUsedTrial: true });
    await expect(subscriptionService.startSubscription(String(user2._id), "premium_monthly", "ONCE")).resolves.toBeTruthy();

    // The first user actually completes payment — NOW it's redeemed.
    await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_once",
      razorpay_subscription_id: started.subscriptionId,
      razorpay_signature: "mock",
      couponCode: "ONCE",
    });
    expect((await Coupon.findById(coupon._id))!.redeemedCount).toBe(1);

    // With the sole slot now actually spent, a third user is refused at
    // the validation stage before ever reaching checkout.
    const user3 = await makeUser({ hasUsedTrial: true });
    await expect(subscriptionService.startSubscription(String(user3._id), "premium_monthly", "ONCE")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a coupon that doesn't apply to the requested plan", async () => {
    await couponService.createCoupon({ code: "MONTHLYONLY", type: "percent", value: 10, appliesToPlanKeys: ["premium_monthly"] });
    const user = await makeUser();
    await expect(subscriptionService.startSubscription(String(user._id), "premium_annual", "MONTHLYONLY")).rejects.toMatchObject({ status: 400 });
  });

  // env.razorpay.isPlaceholder is forced true for the whole test run, so the
  // actual Razorpay revert call (subscriptions.update) is never reachable
  // here — same "only mock mode is unit-tested" convention as every other
  // Razorpay-touching branch in this file. What IS fully testable without
  // Razorpay is the DECISION of whether a revert is due at all, which is
  // exactly what verifySubscriptionPayment consults before ever reaching
  // the (here, unreachable) Razorpay call.
  it("never actually schedules a revert in mock mode, even for a 'once' coupon", async () => {
    await couponService.createCoupon({ code: "FIRSTMONTHHALF", type: "percent", value: 50, discountDuration: "once" });
    const user = await makeUser({ hasUsedTrial: true });
    const started = await subscriptionService.startSubscription(String(user._id), "premium_monthly", "FIRSTMONTHHALF");
    const subscription = await subscriptionService.verifySubscriptionPayment(String(user._id), {
      planKey: "premium_monthly",
      razorpay_payment_id: "mock_payment_oncecoupon",
      razorpay_subscription_id: started.subscriptionId,
      razorpay_signature: "mock",
      couponCode: "FIRSTMONTHHALF",
    });
    expect(subscription.couponOnceRevertScheduledAt).toBeFalsy();
  });
});

describe("resolveOneTimeCouponRevertPlanId", () => {
  async function makeSubscriptionWithCoupon(couponCode: string | undefined, opts: { couponOnceRevertScheduledAt?: Date } = {}) {
    const user = await makeUser();
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const now = new Date();
    return Subscription.create({
      userId: user._id,
      planId: plan!._id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      startedAt: now,
      couponCode,
      couponOnceRevertScheduledAt: opts.couponOnceRevertScheduledAt,
    });
  }

  it("returns the catalog plan's razorpayPlanId for a subscription with an unspent 'once' coupon", async () => {
    // Freshly seeded plans have no razorpayPlanId until published — set one
    // directly rather than going through publishPlanToRazorpay, since mock
    // mode's return value there is never persisted onto the plan document.
    await SubscriptionPlan.updateOne({ key: "premium_monthly" }, { razorpayPlanId: "plan_catalog_monthly_real" });
    await couponService.createCoupon({ code: "REVERTME", type: "percent", value: 50, discountDuration: "once" });
    const subscription = await makeSubscriptionWithCoupon("REVERTME");

    const revertPlanId = await subscriptionService.resolveOneTimeCouponRevertPlanId(subscription);
    expect(revertPlanId).toBe("plan_catalog_monthly_real");
  });

  it("returns null for a 'recurring' coupon — the discount is meant to last the subscription's whole life", async () => {
    await couponService.createCoupon({ code: "FOREVEROFF", type: "percent", value: 50, discountDuration: "recurring" });
    const subscription = await makeSubscriptionWithCoupon("FOREVEROFF");
    expect(await subscriptionService.resolveOneTimeCouponRevertPlanId(subscription)).toBeNull();
  });

  it("returns null when no coupon was ever redeemed", async () => {
    const subscription = await makeSubscriptionWithCoupon(undefined);
    expect(await subscriptionService.resolveOneTimeCouponRevertPlanId(subscription)).toBeNull();
  });

  it("returns null once the revert has already been scheduled — never re-schedules", async () => {
    await couponService.createCoupon({ code: "ALREADYDONE", type: "percent", value: 50, discountDuration: "once" });
    const subscription = await makeSubscriptionWithCoupon("ALREADYDONE", { couponOnceRevertScheduledAt: new Date() });
    expect(await subscriptionService.resolveOneTimeCouponRevertPlanId(subscription)).toBeNull();
  });

  it("returns null if the coupon was since deleted", async () => {
    const subscription = await makeSubscriptionWithCoupon("LONGGONE");
    expect(await subscriptionService.resolveOneTimeCouponRevertPlanId(subscription)).toBeNull();
  });
});
