import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { Payment } from "../src/models/Payment";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as invoiceService from "../src/services/invoiceService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §5.3 — billing polish: coupons,
// invoices, revenue analytics (MRR/movement/failed-payments), refunds.

const app = createApp();

let mobileCounter = 9980000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Billing API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

async function loginAsStaff(mobile: string, email: string, staffRole: "superadmin" | "admin" | "employee") {
  const { userId } = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  await user.save();

  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  const accessToken = confirm.body.accessToken as string;

  const stepUp = await request(app).post("/api/auth/staff/step-up").set("Authorization", `Bearer ${accessToken}`).send({ password: "Passw0rd!" });
  return { userId, accessToken, stepUpToken: stepUp.body.stepUpToken as string };
}

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("coupons admin CRUD", () => {
  it("creates, lists, and updates a coupon (gated by plans.manage)", async () => {
    const staff = await loginAsStaff(nextMobile(), "coupon-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/coupons").set(auth).send({ code: "admin20", type: "percent", value: 20 });
    expect(create.status).toBe(201);
    expect(create.body.coupon.code).toBe("ADMIN20");
    const id = create.body.coupon.id;

    const list = await request(app).get("/api/admin/coupons").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.coupons.some((c: { code: string }) => c.code === "ADMIN20")).toBe(true);

    const update = await request(app).patch(`/api/admin/coupons/${id}`).set(auth).send({ isActive: false });
    expect(update.status).toBe(200);
    expect(update.body.coupon.isActive).toBe(false);
  });

  // Requirement: eligibility sub-categories beyond plan targeting (all
  // paid/monthly/annual) — new users, first-time subscribers, renewals.
  it("creates and updates a coupon's eligibility category, defaulting to 'any'", async () => {
    const staff = await loginAsStaff(nextMobile(), "coupon-eligibility-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const defaulted = await request(app).post("/api/admin/coupons").set(auth).send({ code: "defaulted", type: "percent", value: 10 });
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.coupon.eligibility).toBe("any");

    const created = await request(app).post("/api/admin/coupons").set(auth).send({ code: "newuseronly", type: "percent", value: 15, eligibility: "new_user" });
    expect(created.status).toBe(201);
    expect(created.body.coupon.eligibility).toBe("new_user");

    const updated = await request(app).patch(`/api/admin/coupons/${created.body.coupon.id}`).set(auth).send({ eligibility: "renewal" });
    expect(updated.status).toBe(200);
    expect(updated.body.coupon.eligibility).toBe("renewal");
  });

  it("creates and updates a coupon's discountDuration, defaulting to 'recurring'", async () => {
    const staff = await loginAsStaff(nextMobile(), "coupon-duration-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const defaulted = await request(app).post("/api/admin/coupons").set(auth).send({ code: "durationdefault", type: "percent", value: 10 });
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.coupon.discountDuration).toBe("recurring");

    const created = await request(app).post("/api/admin/coupons").set(auth).send({ code: "firstmonthonly", type: "percent", value: 50, discountDuration: "once" });
    expect(created.status).toBe(201);
    expect(created.body.coupon.discountDuration).toBe("once");

    const updated = await request(app).patch(`/api/admin/coupons/${created.body.coupon.id}`).set(auth).send({ discountDuration: "recurring" });
    expect(updated.status).toBe(200);
    expect(updated.body.coupon.discountDuration).toBe("recurring");
  });

  it("refuses a non-plans.manage employee", async () => {
    const role = await Role.create({ key: "no_plans", label: "No Plans", permissions: ["revenue.view"] });
    const staff = await loginAsStaff(nextMobile(), "no-plans@example.com", "employee");
    // requireStaff re-resolves permissions from the DB on every request, so
    // assigning the role after login still takes effect on the next call.
    await User.updateOne({ _id: staff.userId }, { roleId: role._id });
    const res = await request(app).get("/api/admin/coupons").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(403);
  });
});

describe("invoices admin", () => {
  it("lists issued invoices and downloads one as a PDF", async () => {
    const staff = await loginAsStaff(nextMobile(), "invoice-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "invoice-target@example.com");

    const payment = await Payment.create({
      userId: target.userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: `order_admin_inv_${Date.now()}`,
      razorpayPaymentId: `pay_admin_inv_${Date.now()}`,
      status: "paid",
      isMock: true,
    });
    const invoice = await invoiceService.generateInvoiceForPayment(payment);

    const list = await request(app).get("/api/admin/invoices").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.invoices.some((i: { id: string }) => i.id === String(invoice!._id))).toBe(true);

    const download = await request(app).get(`/api/admin/invoices/${invoice!._id}/pdf`).set(auth);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
  });
});

describe("revenue analytics", () => {
  it("GET /admin/revenue/mrr-summary returns the shape the Revenue screen expects", async () => {
    const staff = await loginAsStaff(nextMobile(), "mrr-admin@example.com", "superadmin");
    const res = await request(app).get("/api/admin/revenue/mrr-summary").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ mrrPaise: expect.any(Number), arrPaise: expect.any(Number), arpuPaise: expect.any(Number), activePayingCount: expect.any(Number) })
    );
  });

  it("GET /admin/revenue/mrr-movement returns a per-month breakdown", async () => {
    const staff = await loginAsStaff(nextMobile(), "movement-admin@example.com", "superadmin");
    const res = await request(app).get("/api/admin/revenue/mrr-movement?months=3").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.movement).toHaveLength(3);
  });

  it("GET /admin/revenue/failed-payments lists only failed ones", async () => {
    const staff = await loginAsStaff(nextMobile(), "failed-admin@example.com", "superadmin");
    const target = await signupNormalUser(nextMobile(), "failed-target@example.com");
    await Payment.create({ userId: target.userId, purpose: "SUBSCRIPTION_RENEWAL", amount: 11900, currency: "INR", razorpayOrderId: "order_fail_admin", status: "failed", isMock: false, failureReason: "Insufficient funds" });

    const res = await request(app).get("/api/admin/revenue/failed-payments").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.payments.some((p: { failureReason?: string }) => p.failureReason === "Insufficient funds")).toBe(true);
  });

  it("GET /admin/revenue/plan-performance breaks revenue down per plan", async () => {
    const staff = await loginAsStaff(nextMobile(), "planperf-admin@example.com", "superadmin");
    const res = await request(app).get("/api/admin/revenue/plan-performance").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
  });
});

describe("POST /api/admin/payments/:id/refund", () => {
  it("requires step-up, then refunds a mock payment fully", async () => {
    const staff = await loginAsStaff(nextMobile(), "refund-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "refund-target@example.com");
    const payment = await Payment.create({
      userId: target.userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: `order_refund_${Date.now()}`,
      razorpayPaymentId: `pay_refund_${Date.now()}`,
      status: "paid",
      isMock: true,
    });

    const noStepUp = await request(app).post(`/api/admin/payments/${payment._id}/refund`).set(auth).send({});
    expect(noStepUp.status).toBe(401);

    const refund = await request(app).post(`/api/admin/payments/${payment._id}/refund`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(refund.status).toBe(200);
    expect(refund.body.payment.refundedAmountPaise).toBe(9900);
    expect(refund.body.payment.refundIds[0]).toMatch(/^mock_refund_/);
  });

  it("refuses a refund larger than what remains unrefunded", async () => {
    const staff = await loginAsStaff(nextMobile(), "refund-guard@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "refund-guard-target@example.com");
    const payment = await Payment.create({
      userId: target.userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: `order_refund_guard_${Date.now()}`,
      razorpayPaymentId: `pay_refund_guard_${Date.now()}`,
      status: "paid",
      isMock: true,
    });
    const res = await request(app).post(`/api/admin/payments/${payment._id}/refund`).set(auth).send({ amountPaise: 20000 });
    expect(res.status).toBe(400);
  });

  it("refuses to refund a payment that was never paid", async () => {
    const staff = await loginAsStaff(nextMobile(), "refund-unpaid@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "refund-unpaid-target@example.com");
    const payment = await Payment.create({
      userId: target.userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: `order_unpaid_${Date.now()}`,
      status: "created",
      isMock: true,
    });
    const res = await request(app).post(`/api/admin/payments/${payment._id}/refund`).set(auth).send({});
    expect(res.status).toBe(400);
  });
});
