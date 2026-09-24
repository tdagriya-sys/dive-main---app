import request from "supertest";
import { createApp } from "../src/app";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as couponService from "../src/services/couponService";
import { Subscription } from "../src/models/Subscription";
import { Payment } from "../src/models/Payment";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md — the logged-in user's own
// subscription surface (/api/subscriptions, /api/me/entitlements).

const app = createApp();

let mobileCounter = 9930000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Subscriptions API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("GET /api/me/entitlements", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/me/entitlements");
    expect(res.status).toBe(401);
  });

  it("returns Freemium for a fresh account, with zeroed usage counters", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "entitlements@example.com");
    const res = await request(app).get("/api/me/entitlements").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.planKey).toBe("freemium");
    expect(res.body.isPremium).toBe(false);
    expect(res.body.usage).toEqual({
      bot_scan: { weekly: 0, monthly: 0 },
      doc_upload: { weekly: 0, monthly: 0 },
      portfolio_edit: { weekly: 0, monthly: 0 },
    });
  });
});

describe("GET /api/subscriptions/plans", () => {
  it("lists only active, public plans", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "plans-list@example.com");
    const res = await request(app).get("/api/subscriptions/plans").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p: { key: string }) => p.key).sort()).toEqual(["freemium", "premium_annual", "premium_monthly"]);
  });
});

describe("POST /api/subscriptions — start", () => {
  it("returns a mock subscription id", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "start@example.com");
    const res = await request(app).post("/api/subscriptions").set("Authorization", `Bearer ${accessToken}`).send({ planKey: "premium_monthly" });
    expect(res.status).toBe(201);
    expect(res.body.mock).toBe(true);
    expect(res.body.subscriptionId).toMatch(/^mock_sub_/);
  });

  it("rejects an unknown plan", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "start-bad@example.com");
    const res = await request(app).post("/api/subscriptions").set("Authorization", `Bearer ${accessToken}`).send({ planKey: "nonexistent" });
    expect(res.status).toBe(404);
  });
});

// Requirement: a genuinely payment-free trial — no Razorpay order, no
// Checkout.js, no payment method ever requested — one-time-ever per user.
describe("POST /api/subscriptions/trial/start", () => {
  it("grants a trialing subscription with no Razorpay subscription id and no Payment row", async () => {
    const { userId, accessToken } = await signupNormalUser(nextMobile(), "trial@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };

    const res = await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "premium_monthly" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("trialing");

    const entitlements = await request(app).get("/api/me/entitlements").set(auth);
    expect(entitlements.body.isPremium).toBe(true);
    expect(entitlements.body.hasUsedTrial).toBe(true);

    const subscription = await Subscription.findOne({ userId }).lean();
    expect(subscription?.razorpaySubscriptionId).toBeUndefined();
    expect(await Payment.countDocuments({ userId })).toBe(0);
  });

  it("blocks a second trial claim once one has already been used", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "trial-twice@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "premium_monthly" });
    await request(app).post("/api/subscriptions/cancel").set(auth).send({ atPeriodEnd: false });

    const res = await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "premium_annual" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("TRIAL_ALREADY_USED");
  });

  it("blocks claiming a trial while already subscribed", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "trial-already-subbed@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });

    const res = await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "premium_annual" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_SUBSCRIBED");
  });

  it("rejects a plan with no trial days", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "trial-no-trial-plan@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    // Freemium has trialDays: 0 and is also rejected as a non-paid plan.
    const res = await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "freemium" });
    expect(res.status).toBe(400);
  });
});

describe("full mock subscribe → verify → cancel journey", () => {
  it("subscribes, sees Premium entitlements, then self-serve cancels at period end", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "journey@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };

    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    const verify = await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });
    expect(verify.status).toBe(200);
    // A direct subscribe is always an immediate real charge, never a trial
    // folded in — see subscriptionService.ts's own comment.
    expect(verify.body.status).toBe("active");

    const entitlements = await request(app).get("/api/me/entitlements").set(auth);
    expect(entitlements.body.isPremium).toBe(true);
    expect(entitlements.body.entitlements.portfolioEditWeekly).toBeNull();

    const cancel = await request(app).post("/api/subscriptions/cancel").set(auth).send({ atPeriodEnd: true });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);

    // Access continues until currentPeriodEnd — cancelling at period end
    // doesn't immediately downgrade.
    const stillPremium = await request(app).get("/api/me/entitlements").set(auth);
    expect(stillPremium.body.isPremium).toBe(true);
  });

  // Requirement: a trial and a real subscription are separate things now —
  // claiming a trial then subscribing to the SAME plan (converting it to a
  // real paid subscription) must be allowed via the ordinary API surface,
  // not just at the service layer.
  it("claims a trial, then converts it to a real paid subscription of the same plan", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "trial-convert@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };

    const trial = await request(app).post("/api/subscriptions/trial/start").set(auth).send({ planKey: "premium_monthly" });
    expect(trial.status).toBe(201);
    expect(trial.body.status).toBe("trialing");

    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    expect(start.status).toBe(201);

    const verify = await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("active");

    const entitlements = await request(app).get("/api/me/entitlements").set(auth);
    expect(entitlements.body.subscription.status).toBe("active");
  });

  it("rejects a malformed mock payment confirmation", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "bad-verify@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    const verify = await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: "not-a-mock-id", razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });
    expect(verify.status).toBe(400);
  });
});

describe("POST /api/subscriptions/cancel with no active subscription", () => {
  it("returns 404", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "no-sub-cancel@example.com");
    const res = await request(app).post("/api/subscriptions/cancel").set("Authorization", `Bearer ${accessToken}`).send({});
    expect(res.status).toBe(404);
  });
});

describe("POST /api/subscriptions/reactivate", () => {
  it("undoes a cancel, keeping the same currentPeriodEnd", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "reactivate@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });

    const cancel = await request(app).post("/api/subscriptions/cancel").set(auth).send({ atPeriodEnd: true });
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);

    const reactivate = await request(app).post("/api/subscriptions/reactivate").set(auth).send({});
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.cancelAtPeriodEnd).toBe(false);
    expect(reactivate.body.currentPeriodEnd).toBe(cancel.body.currentPeriodEnd);

    const entitlements = await request(app).get("/api/me/entitlements").set(auth);
    expect(entitlements.body.isPremium).toBe(true);
    expect(entitlements.body.subscription.cancelAtPeriodEnd).toBe(false);
  });

  it("returns 400 when the subscription wasn't scheduled to cancel", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "reactivate-noop@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });

    const res = await request(app).post("/api/subscriptions/reactivate").set(auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NOT_CANCELLED");
  });

  it("returns 409 and leaves cancelAtPeriodEnd untouched once Razorpay has already been notified", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "reactivate-notified@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });

    const cancel = await request(app).post("/api/subscriptions/cancel").set(auth).send({ atPeriodEnd: true });
    expect(cancel.body.razorpayCancelRequestedAt).toBeNull();
    // Simulates jobs/subscriptionCancelNotice.cron.ts's sweep having already
    // told Razorpay — the API-level guard should refuse honestly, same as
    // the service-level test.
    await Subscription.updateOne({ razorpaySubscriptionId: start.body.subscriptionId }, { razorpayCancelRequestedAt: new Date() });

    const res = await request(app).post("/api/subscriptions/reactivate").set(auth).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("RAZORPAY_ALREADY_NOTIFIED");

    const stillCancelled = await Subscription.findOne({ razorpaySubscriptionId: start.body.subscriptionId }).lean();
    expect(stillCancelled?.cancelAtPeriodEnd).toBe(true);
  });

  it("returns 404 with no active subscription at all", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "reactivate-none@example.com");
    const res = await request(app).post("/api/subscriptions/reactivate").set("Authorization", `Bearer ${accessToken}`).send({});
    expect(res.status).toBe(404);
  });
});

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §9's "6b" row.
describe("POST /api/subscriptions/coupons/preview", () => {
  it("previews a discount without redeeming it", async () => {
    await couponService.createCoupon({ code: "PREVIEW20", type: "percent", value: 20 });
    const { accessToken } = await signupNormalUser(nextMobile(), "coupon-preview@example.com");
    const res = await request(app)
      .post("/api/subscriptions/coupons/preview")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "preview20", planKey: "premium_monthly" });
    expect(res.status).toBe(200);
    expect(res.body.discountedPricePaise).toBe(9520); // 20% off 11900
    expect(res.body.originalPricePaise).toBe(11900);
  });

  it("rejects an invalid code", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "coupon-bad@example.com");
    const res = await request(app)
      .post("/api/subscriptions/coupons/preview")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "DOESNOTEXIST", planKey: "premium_monthly" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/subscriptions/invoices", () => {
  // A direct subscribe is always an immediate real charge now (never a
  // trial folded in), so a single subscribe → verify already produces an
  // invoice — no need to burn-then-resubscribe to force a non-trial charge.
  it("starts empty, then lists an invoice once a subscribe → verify charge has happened", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "invoices@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await request(app).get("/api/subscriptions/invoices").set(auth)).body.invoices).toEqual([]);

    const start = await request(app).post("/api/subscriptions").set(auth).send({ planKey: "premium_monthly" });
    const verify = await request(app)
      .post("/api/subscriptions/verify")
      .set(auth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });
    expect(verify.body.status).toBe("active"); // immediate real charge

    const list = await request(app).get("/api/subscriptions/invoices").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.invoices.length).toBe(1);

    const download = await request(app).get(`/api/subscriptions/invoices/${list.body.invoices[0].id}/pdf`).set(auth);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
  });

  it("refuses to download another user's invoice", async () => {
    const userA = await signupNormalUser(nextMobile(), "invoice-owner@example.com");
    const userB = await signupNormalUser(nextMobile(), "invoice-intruder@example.com");
    const authA = { Authorization: `Bearer ${userA.accessToken}` };
    const authB = { Authorization: `Bearer ${userB.accessToken}` };

    const start = await request(app).post("/api/subscriptions").set(authA).send({ planKey: "premium_monthly" });
    await request(app)
      .post("/api/subscriptions/verify")
      .set(authA)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });

    const invoices = await request(app).get("/api/subscriptions/invoices").set(authA);
    const invoiceId = invoices.body.invoices[0].id;

    const res = await request(app).get(`/api/subscriptions/invoices/${invoiceId}/pdf`).set(authB);
    expect(res.status).toBe(404);
  });
});
