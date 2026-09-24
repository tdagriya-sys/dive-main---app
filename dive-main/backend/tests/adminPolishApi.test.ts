import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { FeatureFlag } from "../src/models/FeatureFlag";
import { DataRequest } from "../src/models/DataRequest";
import { _generateCurrentCodeForTests } from "../src/services/totpService";
import { env } from "../src/config/env";

// Phase 7 of docs/ADMIN_PANEL_PLAN.md — feature flags, announcement/
// maintenance settings, read-only impersonation, DPDP request queue.

const app = createApp();

let mobileCounter = 9910000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Polish API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
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

afterEach(async () => {
  // The maintenance-mode gate caches its value for 5s in-process
  // (adminSettingService.ts::getMaintenanceCached) — reset it between tests
  // so one test's maintenance-mode toggle can't leak into the next.
  const adminSettingService = require("../src/services/adminSettingService");
  await adminSettingService.setMaintenance({ enabled: false, message: "" }, "test-reset");
});

describe("feature flags admin API", () => {
  it("creates, lists, and updates a flag (gated by feature_flags.manage, no step-up)", async () => {
    const staff = await loginAsStaff(nextMobile(), "flags-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/feature-flags").set(auth).send({ key: "new_dashboard", enabled: true, rolloutPct: 50 });
    expect(create.status).toBe(201);
    const id = create.body.flag.id;

    const list = await request(app).get("/api/admin/feature-flags").set(auth);
    expect(list.body.flags.some((f: { key: string }) => f.key === "new_dashboard")).toBe(true);

    const update = await request(app).patch(`/api/admin/feature-flags/${id}`).set(auth).send({ rolloutPct: 100 });
    expect(update.status).toBe(200);
    expect(update.body.flag.rolloutPct).toBe(100);
  });

  it("refuses a non-feature_flags.manage employee", async () => {
    const staff = await loginAsStaff(nextMobile(), "flags-guard@example.com", "employee");
    const res = await request(app).get("/api/admin/feature-flags").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/me/feature-flags", () => {
  it("resolves a real user's own flags", async () => {
    await FeatureFlag.create({ key: "for_users", enabled: true, rolloutPct: 100 });
    const user = await signupNormalUser(nextMobile(), "flags-user@example.com");
    const res = await request(app).get("/api/me/feature-flags").set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.flags.for_users).toBe(true);
  });
});

describe("announcement / maintenance settings", () => {
  it("GET /admin/system/settings starts with both off", async () => {
    const staff = await loginAsStaff(nextMobile(), "settings-admin@example.com", "superadmin");
    const res = await request(app).get("/api/admin/system/settings").set("Authorization", `Bearer ${staff.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.announcement.enabled).toBe(false);
    expect(res.body.maintenance.enabled).toBe(false);
  });

  it("updates the announcement and it shows up on the public endpoint", async () => {
    const staff = await loginAsStaff(nextMobile(), "announce-admin@example.com", "superadmin");
    const update = await request(app)
      .patch("/api/admin/system/settings/announcement")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ text: "New Premium plans are live!", level: "info", enabled: true, dismissible: true });
    expect(update.status).toBe(200);

    const publicRes = await request(app).get("/api/app-settings");
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.announcement.text).toBe("New Premium plans are live!");
    expect(publicRes.body.announcement.enabled).toBe(true);
  });

  it("refuses a non-system.manage employee from editing settings", async () => {
    const staff = await loginAsStaff(nextMobile(), "settings-guard@example.com", "employee");
    const res = await request(app)
      .patch("/api/admin/system/settings/maintenance")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ enabled: true, message: "down" });
    expect(res.status).toBe(403);
  });

  it("maintenance mode blocks a normal user-facing route but not /auth, /admin, or /health", async () => {
    const staff = await loginAsStaff(nextMobile(), "maint-admin@example.com", "superadmin");
    const user = await signupNormalUser(nextMobile(), "maint-user@example.com");

    await request(app)
      .patch("/api/admin/system/settings/maintenance")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ enabled: true, message: "Down for a bit." });

    const blocked = await request(app).get("/api/me/entitlements").set("Authorization", `Bearer ${user.accessToken}`);
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe("MAINTENANCE_MODE");

    const healthOk = await request(app).get("/api/health");
    expect(healthOk.status).toBe(200);

    // Staff can still reach /admin to turn it back off.
    const adminStillWorks = await request(app).get("/api/admin/system/settings").set("Authorization", `Bearer ${staff.accessToken}`);
    expect(adminStillWorks.status).toBe(200);

    await request(app)
      .patch("/api/admin/system/settings/maintenance")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ enabled: false, message: "" });
  });
});

describe("read-only impersonation", () => {
  it("requires step-up, then mints a working read-only token", async () => {
    const staff = await loginAsStaff(nextMobile(), "imp-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "imp-target@example.com");

    const noStepUp = await request(app).post(`/api/admin/users/${target.userId}/impersonate`).set(auth);
    expect(noStepUp.status).toBe(401);

    const impersonate = await request(app).post(`/api/admin/users/${target.userId}/impersonate`).set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(impersonate.status).toBe(200);
    expect(impersonate.body.user.email).toBe("imp-target@example.com");
    const impToken = impersonate.body.accessToken as string;

    // Reads work.
    const read = await request(app).get("/api/me/entitlements").set("Authorization", `Bearer ${impToken}`);
    expect(read.status).toBe(200);

    // Writes are rejected — centrally, with no per-route change needed.
    const write = await request(app).patch("/api/users/me/preferences").set("Authorization", `Bearer ${impToken}`).send({ risk: "Aggressive" });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("READONLY_SESSION");
  });

  it("refuses to impersonate a staff account", async () => {
    const staff = await loginAsStaff(nextMobile(), "imp-guard@example.com", "superadmin");
    const otherStaff = await loginAsStaff(nextMobile(), "imp-guard-target@example.com", "admin");
    const res = await request(app)
      .post(`/api/admin/users/${otherStaff.userId}/impersonate`)
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken });
    expect(res.status).toBe(404);
  });
});

describe("DPDP data-request queue admin API", () => {
  it("lists requests and fulfils an export with step-up, returning a JSON download", async () => {
    const staff = await loginAsStaff(nextMobile(), "dpdp-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "dpdp-target@example.com");

    const created = await request(app).post("/api/users/me/data-export-request").set("Authorization", `Bearer ${target.accessToken}`).send({ type: "export" });
    expect(created.status).toBe(201);

    const list = await request(app).get("/api/admin/data-requests?status=pending").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.requests.length).toBeGreaterThanOrEqual(1);
    const requestId = list.body.requests[0].id;

    const noStepUp = await request(app).post(`/api/admin/data-requests/${requestId}/fulfil-export`).set(auth);
    expect(noStepUp.status).toBe(401);

    const fulfil = await request(app).post(`/api/admin/data-requests/${requestId}/fulfil-export`).set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(fulfil.status).toBe(200);
    expect(fulfil.headers["content-type"]).toMatch(/application\/json/);
    const bundle = JSON.parse(fulfil.text);
    expect(bundle.profile.email).toBe("dpdp-target@example.com");
  });

  it("fulfils a delete request with step-up, actually deleting the account", async () => {
    const staff = await loginAsStaff(nextMobile(), "dpdp-delete-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "dpdp-delete-target@example.com");
    const dataRequest = await DataRequest.create({ userId: target.userId, userEmailSnapshot: "dpdp-delete-target@example.com", type: "delete", status: "pending" });

    const fulfil = await request(app).post(`/api/admin/data-requests/${dataRequest._id}/fulfil-delete`).set(auth);
    expect(fulfil.status).toBe(200);
    expect(fulfil.body.request.status).toBe("fulfilled");
    expect(await User.findById(target.userId)).toBeNull();
  });

  it("rejects a pending request without step-up", async () => {
    const staff = await loginAsStaff(nextMobile(), "dpdp-reject-admin@example.com", "superadmin");
    const target = await signupNormalUser(nextMobile(), "dpdp-reject-target@example.com");
    const created = await request(app).post("/api/users/me/data-export-request").set("Authorization", `Bearer ${target.accessToken}`).send({ type: "export" });

    const res = await request(app)
      .post(`/api/admin/data-requests/${created.body.id}/reject`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ reason: "Could not verify identity" });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("rejected");
  });

  it("a user's own self-serve account deletion is logged as an already-fulfilled DataRequest", async () => {
    const target = await signupNormalUser(nextMobile(), "self-delete@example.com");
    const del = await request(app).delete("/api/users/me").set("Authorization", `Bearer ${target.accessToken}`);
    expect(del.status).toBe(200);

    const logged = await DataRequest.findOne({ userId: target.userId, type: "delete" }).lean();
    expect(logged?.status).toBe("fulfilled");
    expect(logged?.handledBy).toBeUndefined();
  });

  // Regression for a real gap: before POST /api/admin/data-requests existed,
  // nothing ever created a PENDING "delete" row — self-serve deletion always
  // creates its row already fulfilled — so a staff-initiated deletion for a
  // request that arrived outside the app (e.g. email) had no reachable path
  // at all. This exercises the full real lifecycle end to end: log it, list
  // it as pending, then fulfil it exactly like a self-serve export request.
  it("an admin can log a request that arrived outside the app, then fulfil it — the full real lifecycle", async () => {
    const staff = await loginAsStaff(nextMobile(), "dpdp-log-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "dpdp-emailed-in@example.com");

    const logged = await request(app).post("/api/admin/data-requests").set(auth).send({ email: "dpdp-emailed-in@example.com", type: "delete" });
    expect(logged.status).toBe(201);
    expect(logged.body.request.status).toBe("pending");
    expect(logged.body.request.type).toBe("delete");

    const list = await request(app).get("/api/admin/data-requests?status=pending").set(auth);
    expect(list.body.requests.map((r: { id: string }) => r.id)).toContain(logged.body.request.id);

    const fulfil = await request(app)
      .post(`/api/admin/data-requests/${logged.body.request.id}/fulfil-delete`)
      .set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(fulfil.status).toBe(200);
    expect(fulfil.body.request.status).toBe("fulfilled");
    expect(await User.findById(target.userId)).toBeNull();
  });

  it("refuses to log a second pending request of the same type for the same user, and 404s an unknown email", async () => {
    const staff = await loginAsStaff(nextMobile(), "dpdp-log-dupe-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await signupNormalUser(nextMobile(), "dpdp-log-dupe@example.com");

    const first = await request(app).post("/api/admin/data-requests").set(auth).send({ email: "dpdp-log-dupe@example.com", type: "export" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/admin/data-requests").set(auth).send({ email: "dpdp-log-dupe@example.com", type: "export" });
    expect(second.status).toBe(409);

    const unknown = await request(app).post("/api/admin/data-requests").set(auth).send({ email: "no-such-user@example.com", type: "export" });
    expect(unknown.status).toBe(404);
  });
});

describe("user suspend / reactivate / force-logout", () => {
  it("suspending a user revokes their sessions and blocks both login and refresh, until reactivated", async () => {
    const staff = await loginAsStaff(nextMobile(), "suspend-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const targetMobile = nextMobile();
    await signupNormalUser(targetMobile, "suspend-target@example.com");
    // clientType:"extension" hands the raw refresh token back in the body
    // (authController.ts's own extension-support flag) so this test can
    // exercise real revocation without a shared cookie jar.
    const targetLogin = await request(app).post("/api/auth/login").send({ identifier: targetMobile, password: "Passw0rd!", clientType: "extension" });
    const targetUserId = targetLogin.body.user.id as string;
    const targetRefreshToken = targetLogin.body.refreshToken as string;

    const suspend = await request(app).post(`/api/admin/users/${targetUserId}/suspend`).set(auth);
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe("suspended");

    // The refresh token issued at login is now revoked outright.
    const refreshAttempt = await request(app).post("/api/auth/refresh").send({ refreshToken: targetRefreshToken, clientType: "extension" });
    expect(refreshAttempt.status).toBe(401);

    // A fresh login attempt is also blocked (authController.ts::login's own
    // status check).
    const loginAttempt = await request(app).post("/api/auth/login").send({ identifier: targetMobile, password: "Passw0rd!" });
    expect(loginAttempt.status).toBe(403);
    expect(loginAttempt.body.error).toBe("ACCOUNT_SUSPENDED");

    const doubleSuspend = await request(app).post(`/api/admin/users/${targetUserId}/suspend`).set(auth);
    expect(doubleSuspend.status).toBe(400);

    const reactivate = await request(app).post(`/api/admin/users/${targetUserId}/reactivate`).set(auth);
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.status).toBe("active");

    const loginAfterReactivate = await request(app).post("/api/auth/login").send({ identifier: targetMobile, password: "Passw0rd!" });
    expect(loginAfterReactivate.status).toBe(200);

    const reactivateAgain = await request(app).post(`/api/admin/users/${targetUserId}/reactivate`).set(auth);
    expect(reactivateAgain.status).toBe(400);
  });

  it("force-logout revokes sessions without changing status", async () => {
    const staff = await loginAsStaff(nextMobile(), "logout-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const targetMobile = nextMobile();
    await signupNormalUser(targetMobile, "logout-target@example.com");
    const targetLogin = await request(app).post("/api/auth/login").send({ identifier: targetMobile, password: "Passw0rd!", clientType: "extension" });
    const targetUserId = targetLogin.body.user.id as string;
    const targetRefreshToken = targetLogin.body.refreshToken as string;

    const forceLogout = await request(app).post(`/api/admin/users/${targetUserId}/force-logout`).set(auth);
    expect(forceLogout.status).toBe(200);
    expect(forceLogout.body.ok).toBe(true);
    expect((await User.findById(targetUserId))?.status).toBe("active");

    const refreshAttempt = await request(app).post("/api/auth/refresh").send({ refreshToken: targetRefreshToken, clientType: "extension" });
    expect(refreshAttempt.status).toBe(401);
  });

  it("every action requires the users.suspend permission and step-up", async () => {
    const staff = await loginAsStaff(nextMobile(), "suspend-guard@example.com", "employee");
    const target = await signupNormalUser(nextMobile(), "suspend-guard-target@example.com");

    const noPerm = await request(app)
      .post(`/api/admin/users/${target.userId}/suspend`)
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken });
    expect(noPerm.status).toBe(403);

    const superadmin = await loginAsStaff(nextMobile(), "suspend-guard-super@example.com", "superadmin");
    const noStepUp = await request(app)
      .post(`/api/admin/users/${target.userId}/suspend`)
      .set("Authorization", `Bearer ${superadmin.accessToken}`);
    expect(noStepUp.status).toBe(401);
  });

  it("refuses to suspend a staff account", async () => {
    const staff = await loginAsStaff(nextMobile(), "suspend-self-admin@example.com", "superadmin");
    const otherStaff = await loginAsStaff(nextMobile(), "suspend-self-target@example.com", "admin");
    const res = await request(app)
      .post(`/api/admin/users/${otherStaff.userId}/suspend`)
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken });
    expect(res.status).toBe(404);
  });
});

// Regression: middleware/auth.ts::requireAdminIpAllowlist has its own unit
// tests (rbacMiddleware.test.ts) — this confirms it's actually WIRED into
// the real admin router (admin.routes.ts), ahead of requireAuth, rather than
// just existing as an unused export.
describe("admin IP allowlist (wired into the real router)", () => {
  afterEach(() => {
    env.adminIpAllowlist = [];
  });

  it("blocks an otherwise-valid staff request once an allowlist is configured that excludes the caller", async () => {
    const staff = await loginAsStaff(nextMobile(), "ip-allowlist-admin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const before = await request(app).get("/api/admin/dashboard").set(auth);
    expect(before.status).toBe(200);

    env.adminIpAllowlist = ["203.0.113.5"]; // deliberately not supertest's own loopback address
    const blocked = await request(app).get("/api/admin/dashboard").set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("IP_NOT_ALLOWED");
  });
});
