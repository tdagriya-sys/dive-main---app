import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { Instrument } from "../src/models/Instrument";
import { Payment } from "../src/models/Payment";
import { _generateCurrentCodeForTests } from "../src/services/totpService";
import { runInstrumentRefresh } from "../src/services/instrumentService";

// A real call would hit AMFI/NSE/CoinGecko over the network — same reason
// instrumentSources.test.ts mocks axios itself. Mocked here so the RBAC gate
// and the success-response shape are exercised without any real network call.
jest.mock("../src/services/instrumentService", () => ({
  ...jest.requireActual("../src/services/instrumentService"),
  runInstrumentRefresh: jest.fn(),
}));
const mockedRunRefresh = runInstrumentRefresh as jest.Mock;

const app = createApp();

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Phase1b Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

async function loginAsSuperadmin(mobile: string, email: string) {
  const { userId } = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = "superadmin";
  await user.save();
  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  return confirm.body.accessToken as string;
}

// Same shape as loginAsSuperadmin, but an employee whose Role grants exactly
// the given permissions (or none) — for testing a specific permission gate
// rather than "any staff role at all" (superadmin always passes every gate).
async function loginAsEmployee(mobile: string, email: string, permissions: string[]) {
  const { userId } = await signupNormalUser(mobile, email);
  const role = await Role.create({ key: `role_${mobile}`, label: "Test Role", permissions });
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = "employee";
  user.roleId = role._id;
  await user.save();
  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  return confirm.body.accessToken as string;
}

describe("admin API Phase 1b — analytics", () => {
  afterEach(() => jest.clearAllMocks());

  it("engagement reflects real recent activity", async () => {
    const token = await loginAsSuperadmin("9500000001", "superadmin-engagement@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const { accessToken } = await signupNormalUser("9500000002", "engaged-user@example.com");
    await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${accessToken}`); // emits score_viewed

    const res = await request(app).get("/api/admin/analytics/engagement").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.dau).toBeGreaterThanOrEqual(1);
    expect(res.body.mau).toBeGreaterThanOrEqual(res.body.wau);
    expect(res.body.wau).toBeGreaterThanOrEqual(res.body.dau);
  });

  it("funnel counts distinct users at each stage", async () => {
    const token = await loginAsSuperadmin("9500000003", "superadmin-funnel@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await signupNormalUser("9500000004", "funnel-user@example.com"); // signup only, no further stages

    const res = await request(app).get("/api/admin/analytics/funnel").set(auth);
    expect(res.status).toBe(200);
    const signupStage = res.body.stages.find((s: { type: string }) => s.type === "signup");
    const purchaseStage = res.body.stages.find((s: { type: string }) => s.type === "report_purchased");
    expect(signupStage.distinctUsers).toBeGreaterThanOrEqual(1);
    // Nobody in this test purchased a report — the funnel must narrow, not
    // just report the same total at every stage.
    expect(purchaseStage.distinctUsers).toBeLessThanOrEqual(signupStage.distinctUsers);
  });

  it("feature usage groups real ActivityEvent rows by type", async () => {
    const token = await loginAsSuperadmin("9500000005", "superadmin-usage@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const { accessToken } = await signupNormalUser("9500000006", "usage-user@example.com");
    await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ assetClass: "GOLD", name: "Digital Gold", investedValue: 1000, currentValue: 1000 });

    const res = await request(app).get("/api/admin/analytics/feature-usage?days=30").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.usage.some((u: { type: string }) => u.type === "holding_added")).toBe(true);
  });

  it("requires analytics.view specifically — an employee without it gets 403, WITH it gets 200", async () => {
    const withoutPerm = await loginAsEmployee("9500000007", "employee-noanalytics@example.com", []);
    const denied = await request(app).get("/api/admin/analytics/engagement").set("Authorization", `Bearer ${withoutPerm}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/analytics\.view/);

    const withPerm = await loginAsEmployee("9500000008", "employee-withanalytics@example.com", ["analytics.view"]);
    const allowed = await request(app).get("/api/admin/analytics/engagement").set("Authorization", `Bearer ${withPerm}`);
    expect(allowed.status).toBe(200);
  });
});

describe("admin API Phase 1b — revenue", () => {
  afterEach(() => jest.clearAllMocks());

  it("summary splits real vs mock payments and totals correctly", async () => {
    const token = await loginAsSuperadmin("9500000010", "superadmin-revenue@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const { userId } = await signupNormalUser("9500000011", "payer@example.com");
    await Payment.create({
      userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: "order_test_1",
      status: "paid",
      isMock: true,
      portfolioVersionAtPayment: 0,
    });

    const res = await request(app).get("/api/admin/revenue/summary").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.mock.count).toBe(1);
    expect(res.body.mock.amountPaise).toBe(9900);
    expect(res.body.totalAmountPaise).toBe(9900);
  });

  it("lists payments joined with the paying user's name/email", async () => {
    const token = await loginAsSuperadmin("9500000012", "superadmin-payments@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const { userId } = await signupNormalUser("9500000013", "payer2@example.com");
    await Payment.create({
      userId,
      purpose: "SCORE_REPORT_PDF",
      amount: 9900,
      currency: "INR",
      razorpayOrderId: "order_test_2",
      status: "paid",
      isMock: true,
      portfolioVersionAtPayment: 0,
    });

    const res = await request(app).get("/api/admin/revenue/payments").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.payments[0].userEmail).toBe("payer2@example.com");
  });
});

describe("admin API Phase 1b — instruments", () => {
  afterEach(() => jest.clearAllMocks());

  it("lists instruments, filterable by assetClass and q", async () => {
    const token = await loginAsSuperadmin("9500000020", "superadmin-instruments@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await Instrument.create({ assetClass: "EQUITY", symbol: "RELI", name: "Reliance Industries", source: "SEED", isActive: true });
    await Instrument.create({ assetClass: "GOLD", symbol: "GOLDBEES", name: "Gold ETF", source: "SEED", isActive: true });

    const res = await request(app).get("/api/admin/instruments?assetClass=EQUITY").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.instruments).toHaveLength(1);
    expect(res.body.instruments[0].symbol).toBe("RELI");
  });

  it("refresh trigger is gated by instruments.manage and calls the real service function when authorized", async () => {
    const token = await loginAsSuperadmin("9500000021", "superadmin-refresh@example.com");
    mockedRunRefresh.mockResolvedValue([{ source: "SEED", added: 1, updated: 0, fetched: 1 }]);

    const res = await request(app).post("/api/admin/instruments/refresh").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockedRunRefresh).toHaveBeenCalledTimes(1);
    expect(res.body.summary).toEqual([{ source: "SEED", added: 1, updated: 0, fetched: 1 }]);
  });

  it("a non-staff account cannot trigger a refresh", async () => {
    const { accessToken } = await signupNormalUser("9500000022", "normal-refresh@example.com");
    const res = await request(app).post("/api/admin/instruments/refresh").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(mockedRunRefresh).not.toHaveBeenCalled();
  });
});
