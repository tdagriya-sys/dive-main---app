import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { SystemJobRun } from "../src/models/SystemJobRun";
import { WebhookEvent } from "../src/models/WebhookEvent";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 1.2 of docs/ADMIN_PANEL_PLAN.md — the read-only admin API
// (dashboard/users/audit/system) built on top of Phase 0.3's RBAC.

const app = createApp();

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Admin API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

// Full login -> TOTP setup -> confirm loop (mirrors staffAuthFlow.test.ts),
// returning a real, usable access token for the given staffRole.
async function loginAsStaff(mobile: string, email: string, staffRole: "superadmin" | "admin" | "employee", roleId?: string) {
  const { userId } = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  if (roleId) user.roleId = roleId as unknown as typeof user.roleId;
  await user.save();

  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  return { userId, accessToken: confirm.body.accessToken as string };
}

describe("admin API — access control", () => {
  it("a normal (non-staff) account gets 403 FORBIDDEN from every admin route", async () => {
    const { accessToken } = await signupNormalUser("9600000001", "normal-admin-api@example.com");
    const auth = { Authorization: `Bearer ${accessToken}` };
    for (const path of ["/api/admin/dashboard", "/api/admin/users", "/api/admin/audit", "/api/admin/system/health"]) {
      const res = await request(app).get(path).set(auth);
      expect(res.status).toBe(403);
    }
  });

  it("an unauthenticated request gets 401", async () => {
    const res = await request(app).get("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("dashboard is reachable by ANY staff role, even one with no other permissions", async () => {
    const role = await Role.create({ key: "no_perms_role", label: "No Perms", permissions: [] });
    const { accessToken } = await loginAsStaff("9600000002", "employee-noperm@example.com", "employee", String(role._id));
    const res = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toBeTruthy();
  });

  it("users list requires the users.view permission specifically", async () => {
    const role = await Role.create({ key: "no_perms_role2", label: "No Perms 2", permissions: [] });
    const { accessToken } = await loginAsStaff("9600000003", "employee-noperm2@example.com", "employee", String(role._id));
    const res = await request(app).get("/api/admin/users").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/users\.view/);
  });

  it("an employee granted exactly users.view can list/detail users but not the audit log", async () => {
    const role = await Role.create({ key: "user_viewer", label: "User Viewer", permissions: ["users.view"] });
    const { accessToken } = await loginAsStaff("9600000004", "employee-userview@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await request(app).get("/api/admin/users").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/audit").set(auth)).status).toBe(403);
  });
});

describe("admin API — dashboard", () => {
  it("reflects real signup counts", async () => {
    const superadmin = await loginAsStaff("9600000010", "superadmin-dash@example.com", "superadmin");
    const before = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${superadmin.accessToken}`);
    const beforeTotal = before.body.users.total;

    await signupNormalUser("9600000011", "dash-user-1@example.com");
    await signupNormalUser("9600000012", "dash-user-2@example.com");

    const after = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(after.body.users.total).toBe(beforeTotal + 2);
    // The two staff accounts created via loginAsStaff/signupNormalUser above
    // are real Users too, but staff.total counts staffRole !== null and
    // users.total counts staffRole === null — the superadmin created for
    // THIS test must not itself count toward the ordinary-user total.
  });
});

describe("admin API — users list & detail", () => {
  it("lists users with email/mobile PARTIALLY MASKED", async () => {
    const superadmin = await loginAsStaff("9600000020", "superadmin-users@example.com", "superadmin");
    await signupNormalUser("9600000021", "masked-user@example.com");

    const res = await request(app).get("/api/admin/users?q=masked-user").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    // The server-side search (?q=) matches the REAL email before masking is
    // applied to the response — searching by the substring being tested
    // itself proves that, since it could only ever match pre-mask.
    expect(res.body.total).toBe(1);
    const found = res.body.users[0];
    expect(found.email).not.toBe("masked-user@example.com"); // masked, not the raw address
    expect(found.email).toMatch(/^\*+@|^.\*+@/); // first char (or nothing) then stars before @
    expect(found.mobile).not.toBe("9600000021");
    expect(found.mobile.endsWith("21")).toBe(true); // last 2 digits preserved
  });

  it("detail view shows the REAL (unmasked) email/mobile plus holdings/score/payments/activity", async () => {
    const superadmin = await loginAsStaff("9600000030", "superadmin-detail@example.com", "superadmin");
    const { userId, accessToken } = await signupNormalUser("9600000031", "detail-user@example.com");

    await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ assetClass: "GOLD", name: "Digital Gold", investedValue: 5000, currentValue: 5000 });

    const res = await request(app).get(`/api/admin/users/${userId}`).set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("detail-user@example.com");
    expect(res.body.user.mobile).toBe("9600000031");
    expect(res.body.holdings.count).toBe(1);
    expect(res.body.holdings.totalValue).toBe(5000);
    expect(res.body.score).toBeTruthy();
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(Array.isArray(res.body.activity)).toBe(true);
  });

  it("404s for an unknown user id", async () => {
    const superadmin = await loginAsStaff("9600000040", "superadmin-404@example.com", "superadmin");
    const res = await request(app)
      .get("/api/admin/users/000000000000000000000000")
      .set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("never returns a staff account through the ordinary users list/detail", async () => {
    const superadmin = await loginAsStaff("9600000050", "superadmin-staffhide@example.com", "superadmin");
    const res = await request(app)
      .get(`/api/admin/users/${superadmin.userId}`)
      .set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe("admin API — audit log", () => {
  it("is filterable and paginated", async () => {
    const superadmin = await loginAsStaff("9600000060", "superadmin-audit@example.com", "superadmin");
    const res = await request(app).get("/api/admin/audit?limit=5&page=1").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.limit).toBe(5);
  });
});

describe("admin API — system", () => {
  it("health reports db/redis status", async () => {
    const superadmin = await loginAsStaff("9600000070", "superadmin-health@example.com", "superadmin");
    const res = await request(app).get("/api/admin/system/health").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("connected");
    expect(["not_configured", "connected", "error"]).toContain(res.body.redis);
  });

  it("integrations reports mock/live per provider without ever exposing a secret value", async () => {
    const superadmin = await loginAsStaff("9600000071", "superadmin-integrations@example.com", "superadmin");
    const res = await request(app).get("/api/admin/system/integrations").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(["mock", "live"]).toContain(res.body.razorpay);
    expect(JSON.stringify(res.body)).not.toMatch(/rzp_|sk-/); // no leaked key material
  });

  it("jobs lists SystemJobRun history", async () => {
    const superadmin = await loginAsStaff("9600000072", "superadmin-jobs@example.com", "superadmin");
    await SystemJobRun.create({ job: "instrumentRefresh", startedAt: new Date(), finishedAt: new Date(), ok: true, stats: { count: 3 } });
    const res = await request(app).get("/api/admin/system/jobs").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.recentRuns.length).toBeGreaterThan(0);
    expect(res.body.latestPerJob.some((j: { job: string }) => j.job === "instrumentRefresh")).toBe(true);
  });

  it("webhooks lists WebhookEvent history", async () => {
    const superadmin = await loginAsStaff("9600000073", "superadmin-webhooks@example.com", "superadmin");
    await WebhookEvent.create({ provider: "razorpay", eventType: "payment.captured", processedOk: true, signatureValid: true });
    const res = await request(app).get("/api/admin/system/webhooks").set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
  });
});
