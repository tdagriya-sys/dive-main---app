import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { Coupon } from "../src/models/Coupon";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import { seedDefaultTicketCategoriesIfEmpty } from "../src/services/ticketService";
import * as subscriptionService from "../src/services/subscriptionService";

// The extra user events the User Activity page shows: failed logins, one-time-
// code failures, password reset / change, profile and preference changes,
// account deletion, support tickets, payment failures and coupon redemptions.
// emitActivity is fire-and-forget, so the tests poll briefly for the row.
// Every event must name WHAT happened but never carry a secret or a personal value.

const app = createApp();
const PASSWORD = "Passw0rd!";
const NEW_PASSWORD = "Newpassw0rd!9";

async function waitFor(type: string, match: Record<string, unknown> = {}, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ev = await ActivityEvent.findOne({ type, ...match }).lean();
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

let mobileCounter = 9230000000;
async function signup(email: string, agent = request.agent(app)) {
  const mobile = String(mobileCounter++);
  const body = { name: "Event Tester", mobile, email, age: 30, password: PASSWORD, confirmPassword: PASSWORD };
  const start = await agent.post("/api/auth/signup/start").send(body);
  const verify = await agent.post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { agent, mobile, email, userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

// Nothing the tests ever typed (passwords) may appear in any recorded event.
async function assertNoSecretsRecorded() {
  const all = JSON.stringify(await ActivityEvent.find({}).lean());
  expect(all).not.toContain(PASSWORD);
  expect(all).not.toContain(NEW_PASSWORD);
}

afterEach(assertNoSecretsRecorded);

describe("failed logins", () => {
  it("a wrong password is recorded against the account, with the reason", async () => {
    const u = await signup("evt-wrongpw@example.com");
    const res = await request(app).post("/api/auth/login").send({ identifier: u.email, password: "not-the-password" });
    expect(res.status).toBe(401);
    const ev = await waitFor("login_failed", { userId: u.userId });
    expect(ev?.props).toMatchObject({ reason: "wrong_password" });
    expect(ev?.ip).toBeTruthy();
  });

  it("an unknown account is recorded with only a MASKED identifier — never the full email or mobile", async () => {
    await request(app).post("/api/auth/login").send({ identifier: "stranger@example.com", password: "whatever1A" });
    await request(app).post("/api/auth/login").send({ identifier: "9876500011", password: "whatever1A" });
    await new Promise((r) => setTimeout(r, 100)); // emitActivity is fire-and-forget
    const recorded = await ActivityEvent.find({ type: "login_failed" }).lean();
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(recorded);
    expect(text).toContain("s***@example.com");
    expect(text).toContain("98******11");
    expect(text).not.toContain("stranger@example.com");
    expect(text).not.toContain("9876500011");
    expect(recorded.every((e) => (e.props as { reason?: string }).reason === "unknown_account")).toBe(true);
    expect(recorded.every((e) => !e.userId)).toBe(true);
  });

  it("a suspended account's login attempt is recorded (with the right password, so the reason is the status)", async () => {
    const u = await signup("evt-suspended@example.com");
    await User.updateOne({ _id: u.userId }, { status: "suspended" });
    const res = await request(app).post("/api/auth/login").send({ identifier: u.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect((await waitFor("login_failed", { userId: u.userId }))?.props).toMatchObject({ reason: "account_not_active" });
  });

  it("a successful login still records only 'login', not a failure", async () => {
    const u = await signup("evt-okay@example.com");
    await request(app).post("/api/auth/login").send({ identifier: u.email, password: PASSWORD });
    expect(await waitFor("login", { userId: u.userId })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(await ActivityEvent.countDocuments({ type: "login_failed", userId: u.userId })).toBe(0);
  });
});

describe("one-time codes and password reset", () => {
  it("a wrong sign-up code is recorded with a masked mobile and no user", async () => {
    const mobile = String(mobileCounter++);
    await request(app).post("/api/auth/signup/start").send({ name: "Nope", mobile, email: "evt-otp-signup@example.com", age: 30, password: PASSWORD, confirmPassword: PASSWORD });
    const res = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: "000000" });
    expect(res.status).toBe(400);
    const ev = await waitFor("otp_failed");
    expect(ev?.props).toMatchObject({ purpose: "signup", identifier: `${mobile.slice(0, 2)}******${mobile.slice(-2)}` });
    expect(ev?.userId).toBeUndefined();
    expect(JSON.stringify(ev)).not.toContain(mobile);
  });

  it("the whole reset flow: requested → wrong code → completed, each recorded against the account", async () => {
    const u = await signup("evt-reset@example.com");

    const start = await request(app).post("/api/auth/forgot-password/start").send({ identifier: u.email });
    expect(start.status).toBe(200);
    expect((await waitFor("password_reset_requested", { userId: u.userId }))?.props).toMatchObject({ result: "code_sent" });

    await request(app).post("/api/auth/forgot-password/verify").send({ mobile: u.mobile, otp: "000000" });
    const failed = await waitFor("otp_failed", { userId: u.userId });
    expect(failed?.props).toMatchObject({ purpose: "password_reset" });

    const verify = await request(app).post("/api/auth/forgot-password/verify").send({ mobile: u.mobile, otp: start.body.devOtp });
    expect(verify.status).toBe(200);
    const reset = await request(app).post("/api/auth/forgot-password/reset").send({ resetToken: verify.body.resetToken, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect((await waitFor("password_reset_completed", { userId: u.userId }))?.props).toMatchObject({ sessionsRevoked: true });
  });

  it("asking to reset an unknown account is recorded (masked), not silently ignored", async () => {
    await request(app).post("/api/auth/forgot-password/start").send({ identifier: "ghost@example.com" });
    const ev = await waitFor("password_reset_requested", { userId: { $exists: false } });
    expect(ev?.props).toMatchObject({ result: "unknown_account", identifier: "g***@example.com" });
    expect(JSON.stringify(ev)).not.toContain("ghost@example.com");
  });
});

describe("account changes", () => {
  it("changing the password: a wrong current password is recorded as a failure, a right one as a change", async () => {
    const u = await signup("evt-chpw@example.com");
    const auth = { Authorization: `Bearer ${u.accessToken}` };

    const bad = await request(app).patch("/api/users/me/password").set(auth).send({ currentPassword: "wrong-current1A", newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD });
    expect(bad.status).toBe(401);
    expect((await waitFor("password_change_failed", { userId: u.userId }))?.props).toMatchObject({ reason: "wrong_current_password" });

    const ok = await request(app).patch("/api/users/me/password").set(auth).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await waitFor("password_changed", { userId: u.userId }))?.props).toMatchObject({ sessionsRevoked: true });
  });

  it("profile and preference updates record WHICH fields changed, never the values", async () => {
    const u = await signup("evt-profile@example.com");
    const auth = { Authorization: `Bearer ${u.accessToken}` };

    await request(app).patch("/api/users/me/profile").set(auth).send({ name: "Brand New Name", age: 41 });
    const p = await waitFor("profile_updated", { userId: u.userId });
    expect(p?.props).toEqual({ fields: ["name", "age"] });
    expect(JSON.stringify(p)).not.toContain("Brand New Name");

    await request(app).patch("/api/users/me/preferences").set(auth).send({ risk: "Aggressive" });
    const pr = await waitFor("preferences_updated", { userId: u.userId });
    expect(pr?.props).toEqual({ fields: ["risk"] });
    expect(JSON.stringify(pr)).not.toContain("Aggressive");
  });

  it("a data-export request is recorded", async () => {
    const u = await signup("evt-export@example.com");
    await request(app).post("/api/users/me/data-export-request").set({ Authorization: `Bearer ${u.accessToken}` }).send();
    expect(await waitFor("data_export_requested", { userId: u.userId })).toBeTruthy();
  });

  it("deleting the account records 'account_deleted' (by id only) even though the account is gone", async () => {
    const u = await signup("evt-delete@example.com");
    const res = await request(app).delete("/api/users/me").set({ Authorization: `Bearer ${u.accessToken}` });
    expect(res.status).toBe(200);
    const ev = await waitFor("account_deleted", { userId: u.userId });
    expect(ev).toBeTruthy();
    expect(ev?.props).toBeUndefined();
    expect(await User.countDocuments({ _id: u.userId })).toBe(0);
  });
});

describe("sessions", () => {
  it("presenting an already-used refresh token records 'session_reuse_detected'", async () => {
    const u = await signup("evt-reuse@example.com");
    const oldCookie = (await request(app).post("/api/auth/login").send({ identifier: u.email, password: PASSWORD })).headers["set-cookie"][0];
    const first = await request(app).post("/api/auth/refresh").set("Cookie", oldCookie);
    expect(first.status).toBe(200); // rotates the token
    const replay = await request(app).post("/api/auth/refresh").set("Cookie", oldCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("REFRESH_TOKEN_REUSED");
    expect((await waitFor("session_reuse_detected", { userId: u.userId }))?.props).toMatchObject({ sessionsRevoked: true });
  });
});

describe("support and billing", () => {
  it("raising a support ticket is recorded with its category, not its text", async () => {
    await seedDefaultTicketCategoriesIfEmpty();
    const u = await signup("evt-ticket@example.com");
    const res = await request(app).post("/api/tickets").set({ Authorization: `Bearer ${u.accessToken}` }).send({ subject: "My private complaint", categoryKey: "technical", description: "Secret details about my finances." });
    expect(res.status).toBe(201);
    const ev = await waitFor("ticket_created", { userId: u.userId });
    expect(ev?.props).toMatchObject({ categoryKey: "technical", source: "in_app", callbackRequested: false });
    expect(JSON.stringify(ev)).not.toContain("private complaint");
    expect(JSON.stringify(ev)).not.toContain("Secret details");
  });

  it("a failed subscription payment is recorded with Razorpay's short reason", async () => {
    await seedDefaultSubscriptionPlansIfEmpty();
    const u = await signup("evt-payfail@example.com");
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({ userId: u.userId, planId: plan!._id, status: "active", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000), startedAt: new Date(), razorpaySubscriptionId: "sub_evt_fail" });

    await subscriptionService.handleSubscriptionWebhookEvent("payment.failed", { payment: { entity: { id: "pay_evt_fail", subscription_id: "sub_evt_fail", amount: 11900, error_description: "Card declined" } } });
    expect((await waitFor("payment_failed", { userId: u.userId }))?.props).toMatchObject({ reason: "Card declined", purpose: "initial" });
  });

  it("redeeming a coupon at checkout is recorded with the code", async () => {
    await seedDefaultSubscriptionPlansIfEmpty();
    await Coupon.create({ code: "EVENT10", type: "percent", value: 10, discountDuration: "recurring" });
    const u = await signup("evt-coupon@example.com");
    const started = await subscriptionService.startSubscription(u.userId, "premium_monthly", "EVENT10");
    await subscriptionService.verifySubscriptionPayment(u.userId, { planKey: "premium_monthly", razorpay_payment_id: "mock_payment_evt", razorpay_subscription_id: started.subscriptionId, razorpay_signature: "mock", couponCode: "EVENT10" });
    expect((await waitFor("coupon_redeemed", { userId: u.userId }))?.props).toEqual({ code: "EVENT10" });
  });
});
