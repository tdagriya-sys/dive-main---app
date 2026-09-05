import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

async function signupAndLogin(mobile: string, email: string, age = 30) {
  const signup = { name: "Payment Tester", mobile, email, age, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

async function addEquityHolding(auth: { Authorization: string }) {
  return request(app).post("/api/holdings/manual").set(auth).send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 11000 });
}

// No real RAZORPAY_KEY_ID/SECRET are set for the test env, so every one of
// these exercises paymentService.ts's mock-payment path — the exact same
// path a local dev run without real Razorpay keys uses. See
// scoreReportPdfService.test.ts's payForReport() for the identical flow
// used from the PDF-download side; this file tests the payment endpoints
// themselves in depth.
describe("POST /api/payments/report/order", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/payments/report/order");
    expect(res.status).toBe(401);
  });

  it("creates a mock order (no real Razorpay keys in this test env)", async () => {
    const token = await signupAndLogin("9600000001", "pay1@example.com");
    const res = await request(app).post("/api/payments/report/order").set("Authorization", `Bearer ${token}`).send();
    expect(res.status).toBe(201);
    expect(res.body.mock).toBe(true);
    expect(res.body.keyId).toBeNull(); // mock mode never hands the frontend a real key to load real Checkout.js with
    expect(res.body.orderId).toMatch(/^mock_order_/);
    expect(res.body.amount).toBe(9900); // Rs. 99, in paise — REPORT_PRICE_PAISE default
    expect(res.body.currency).toBe("INR");
  });
});

describe("POST /api/payments/report/verify", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/payments/report/verify").send({});
    expect(res.status).toBe(401);
  });

  it("rejects a garbage/unknown order id", async () => {
    const token = await signupAndLogin("9600000002", "pay2@example.com");
    const res = await request(app)
      .post("/api/payments/report/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ razorpay_order_id: "mock_order_does-not-exist", razorpay_payment_id: "mock_payment_x", razorpay_signature: "mock" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ORDER");
  });

  it("rejects a mock order confirmed with a malformed mock payment id", async () => {
    const token = await signupAndLogin("9600000003", "pay3@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    const res = await request(app)
      .post("/api/payments/report/verify")
      .set(auth)
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: "not-shaped-like-a-mock-payment", razorpay_signature: "mock" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_MOCK_PAYMENT");
  });

  it("verifies a real mock order end-to-end and unlocks the report", async () => {
    const token = await signupAndLogin("9600000004", "pay4@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);

    const blockedBefore = await request(app).get("/api/score/breakdown/pdf").set(auth);
    expect(blockedBefore.status).toBe(402);

    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    const verify = await request(app)
      .post("/api/payments/report/verify")
      .set(auth)
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);

    const unlockedAfter = await request(app).get("/api/score/breakdown/pdf").set(auth);
    expect(unlockedAfter.status).toBe(200);
    expect(unlockedAfter.headers["content-type"]).toBe("application/pdf");
  });

  // Bug report: once RAZORPAY_WEBHOOK_SECRET was configured live, real
  // payments started showing "Payment succeeded, but we couldn't verify it
  // just now" — Razorpay's webhook (handleReportWebhookPaymentCaptured)
  // routinely wins the race against this browser round-trip and marks the
  // order "paid" FIRST, so this endpoint's own verify call was rejecting an
  // already-genuinely-paid order as INVALID_ORDER. Calling verify twice with
  // the exact same, already-matching proof (same order id + same payment id)
  // must be a harmless no-op, not an error — it's indistinguishable from the
  // webhook-then-frontend race that's now routine in production.
  it("verifying the same already-paid order again with the same payment id is a harmless no-op (webhook-then-frontend race)", async () => {
    const token = await signupAndLogin("9600000005", "pay5@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    const payload = { razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" };

    const first = await request(app).post("/api/payments/report/verify").set(auth).send(payload);
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/payments/report/verify").set(auth).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.verified).toBe(true);
  });

  // The actual regression this bug report was about: the webhook (not a
  // second frontend call) settles the order first, then the frontend's own
  // post-checkout verify call arrives with the real payment id Razorpay's
  // Checkout handler gave it — this must succeed and unlock the download,
  // not throw INVALID_ORDER just because status was already "paid" by the
  // time it got here.
  it("succeeds when the webhook already settled the order before the frontend's own verify call arrives", async () => {
    const paymentService = require("../src/services/paymentService");
    const token = await signupAndLogin("9600000021", "pay21@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    const paymentId = `mock_payment_${order.body.orderId}`;

    // Webhook wins the race.
    await paymentService.handleReportWebhookPaymentCaptured(order.body.orderId, paymentId);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    // Frontend's own verify call arrives after — must not be treated as an error.
    const verify = await request(app)
      .post("/api/payments/report/verify")
      .set(auth)
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: paymentId, razorpay_signature: "mock" });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
  });

  // A mismatched payment id against an already-settled order is still a
  // genuinely invalid request (someone guessing/forging an order id that
  // isn't backed by the payment id they're claiming) — the idempotent
  // success above only applies when the two actually match.
  it("still rejects a mismatched payment id against an already-paid order", async () => {
    const token = await signupAndLogin("9600000022", "pay22@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    const payload = { razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" };
    await request(app).post("/api/payments/report/verify").set(auth).send(payload);

    const res = await request(app)
      .post("/api/payments/report/verify")
      .set(auth)
      .send({ ...payload, razorpay_payment_id: "mock_payment_some_other_id" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ORDER");
  });

  it("rejects an order id that belongs to a different user", async () => {
    const tokenA = await signupAndLogin("9600000006", "pay6a@example.com");
    const tokenB = await signupAndLogin("9600000007", "pay6b@example.com");
    const order = await request(app).post("/api/payments/report/order").set("Authorization", `Bearer ${tokenA}`).send();

    const res = await request(app)
      .post("/api/payments/report/verify")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ORDER");
  });
});

// The user-confirmed product rule: a paid report stays downloadable for
// free until the portfolio it describes actually changes, then requires a
// fresh Rs. 99 purchase — see models/User.ts's portfolioVersion field and
// paymentService.ts's hasPaidForReport/invalidateReportPurchase.
describe("Paid report access — invalidated by portfolio changes, not by time", () => {
  async function payForReport(auth: { Authorization: string }) {
    const order = await request(app).post("/api/payments/report/order").set(auth).send();
    await request(app)
      .post("/api/payments/report/verify")
      .set(auth)
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" });
  }

  it("stays unlocked across repeat downloads with nothing changed", async () => {
    const token = await signupAndLogin("9600000010", "pay10@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    await payForReport(auth);

    const first = await request(app).get("/api/score/breakdown/pdf").set(auth);
    const second = await request(app).get("/api/score/breakdown/pdf").set(auth);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // no second payment needed
  });

  it("locks again after adding a holding, and a fresh payment unlocks it again", async () => {
    const token = await signupAndLogin("9600000011", "pay11@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    await payForReport(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    await addEquityHolding(auth); // a second holding — the report they paid for is now stale
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);

    await payForReport(auth); // fresh purchase for the now-current portfolio
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);
  });

  it("locks again after editing a holding", async () => {
    const token = await signupAndLogin("9600000012", "pay12@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const created = await addEquityHolding(auth);
    await payForReport(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    await request(app).patch(`/api/holdings/${created.body.holding._id}`).set(auth).send({ currentValue: 999999 });
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);
  });

  it("locks again after deleting a holding", async () => {
    const token = await signupAndLogin("9600000013", "pay13@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const created = await addEquityHolding(auth);
    await payForReport(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    await request(app).delete(`/api/holdings/${created.body.holding._id}`).set(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);
  });

  it("locks again after a profile age change (feeds the report's context/persona sub-scores)", async () => {
    const token = await signupAndLogin("9600000014", "pay14@example.com", 30);
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    await payForReport(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    await request(app).patch("/api/users/me/profile").set(auth).send({ age: 45 });
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);
  });

  it("does NOT lock on an unrelated profile save (name only) or a preferences/planner save", async () => {
    const token = await signupAndLogin("9600000015", "pay15@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    await payForReport(auth);

    await request(app).patch("/api/users/me/profile").set(auth).send({ name: "Renamed Tester" });
    await request(app).patch("/api/users/me/planner").set(auth).send({ lumpsumAmount: 75000 });
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);
  });

  it("locks again after an AA sync brings in new holdings", async () => {
    const token = await signupAndLogin("9600000016", "pay16@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    await payForReport(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    const consent = await request(app).post("/api/aa/consent/request").set(auth);
    await request(app).post(`/api/aa/consent/${consent.body.consentHandle}/approve`).set(auth);
    await request(app).post(`/api/aa/consent/${consent.body.consentHandle}/fetch`).set(auth);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);
  });
});

describe("POST /api/payments/webhook", () => {
  it("acknowledges but does nothing when no RAZORPAY_WEBHOOK_SECRET is configured (this test env's default)", async () => {
    const res = await request(app).post("/api/payments/webhook").send({ event: "payment.captured" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, processed: false });
  });
});

// Unit-level: the actual "mark this order paid" logic the webhook calls once
// a signature has verified — see paymentController.ts's razorpayWebhook.
// Signature verification itself is Razorpay's own SDK function
// (Razorpay.validateWebhookSignature), not re-tested here.
describe("handleReportWebhookPaymentCaptured", () => {
  it("marks a still-pending order paid, and is a no-op for an order that's already settled", async () => {
    const paymentService = require("../src/services/paymentService");
    const token = await signupAndLogin("9600000020", "pay20@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await addEquityHolding(auth);
    const order = await request(app).post("/api/payments/report/order").set(auth).send();

    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(402);
    await paymentService.handleReportWebhookPaymentCaptured(order.body.orderId, `mock_payment_${order.body.orderId}`);
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth)).status).toBe(200);

    // Already "paid" now — a duplicate/retried webhook delivery for the same
    // order must not throw or double-charge/double-process.
    await expect(paymentService.handleReportWebhookPaymentCaptured(order.body.orderId, `mock_payment_${order.body.orderId}`)).resolves.toBeUndefined();
  });

  it("is a no-op for an order id that isn't ours", async () => {
    const paymentService = require("../src/services/paymentService");
    await expect(paymentService.handleReportWebhookPaymentCaptured("order_not_ours", "pay_not_ours")).resolves.toBeUndefined();
  });
});
