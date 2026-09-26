import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { AuditLog } from "../src/models/AuditLog";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// The admin User Activity API: gated by users.view; the CSV export needs
// users.export AND a step-up re-authentication, and every export is written to
// the (staff-only) Audit Log.

const app = createApp();

let mobileCounter = 9220000000;
const nextMobile = () => String(mobileCounter++);

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Activity Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string };
}

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
  const accessToken = confirm.body.accessToken as string;
  const stepUp = await request(app).post("/api/auth/staff/step-up").set("Authorization", `Bearer ${accessToken}`).send({ password: "Passw0rd!" });
  return { userId, accessToken, stepUpToken: stepUp.body.stepUpToken as string };
}

async function seedEvents() {
  const ada = await User.create({ name: "Ada", mobile: nextMobile(), email: "ada-act@example.com", age: 30, passwordHash: "x" });
  await ActivityEvent.create({ userId: ada._id, type: "login", ts: new Date("2026-09-20T05:00:00Z"), ip: "1.1.1.1" });
  await ActivityEvent.create({ userId: ada._id, type: "login_failed", ts: new Date("2026-09-21T05:00:00Z"), props: { reason: "wrong_password" } });
  await ActivityEvent.create({ type: "login_failed", ts: new Date("2026-09-22T05:00:00Z"), props: { reason: "unknown_account", identifier: "z***@example.com" } });
  return ada;
}

describe("permission gating", () => {
  it("requires a staff login", async () => {
    expect((await request(app).get("/api/admin/user-activity")).status).toBe(401);
    expect((await request(app).get("/api/admin/user-activity/types")).status).toBe(401);
    expect((await request(app).get("/api/admin/user-activity/export")).status).toBe(401);
  });

  it("an employee with users.view can view, but cannot export (needs users.export)", async () => {
    const role = await Role.create({ key: "viewer_only", label: "Viewer only", permissions: ["users.view"] });
    const staff = await loginAsStaff(nextMobile(), "act-viewer@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/user-activity").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/user-activity/types").set(auth)).status).toBe(200);
    const exp = await request(app).get("/api/admin/user-activity/export").set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(exp.status).toBe(403);
  });

  it("an employee without users.view sees nothing", async () => {
    const role = await Role.create({ key: "no_users", label: "No users", permissions: ["tickets.view"] });
    const staff = await loginAsStaff(nextMobile(), "act-nousers@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/user-activity").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/admin/user-activity/types").set(auth)).status).toBe(403);
  });

  it("an ordinary (non-staff) user is refused", async () => {
    const { userId } = await signupNormalUser(nextMobile(), "act-normal@example.com");
    void userId;
    const login = await request(app).post("/api/auth/login").send({ identifier: "act-normal@example.com", password: "Passw0rd!" });
    const res = await request(app).get("/api/admin/user-activity").set({ Authorization: `Bearer ${login.body.accessToken}` });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/user-activity", () => {
  it("lists, filters by user / type / group / date, and pages", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin1@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const ada = await seedEvents();

    const all = await request(app).get("/api/admin/user-activity").query({ type: "login_failed" }).set(auth);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.events[0]).toMatchObject({ type: "login_failed", userEmail: null }); // the newest: the unknown-account attempt
    expect(all.body.events[1]).toMatchObject({ userEmail: "ada-act@example.com", label: "Failed login", group: "security" });

    expect((await request(app).get("/api/admin/user-activity").query({ user: String(ada._id) }).set(auth)).body.total).toBe(2);
    expect((await request(app).get("/api/admin/user-activity").query({ user: "ada-act@" }).set(auth)).body.total).toBe(2);
    expect((await request(app).get("/api/admin/user-activity").query({ group: "security" }).set(auth)).body.total).toBeGreaterThanOrEqual(2);
    const day = await request(app).get("/api/admin/user-activity").query({ from: "2026-09-21", to: "2026-09-21" }).set(auth);
    expect(day.body.events.map((e: { type: string }) => e.type)).toEqual(["login_failed"]);
    const paged = await request(app).get("/api/admin/user-activity").query({ limit: 1, page: 2, user: String(ada._id) }).set(auth);
    expect(paged.body).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it("rejects a malformed date, a backwards range, and an oversized page", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin2@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/user-activity").query({ from: "garbage" }).set(auth)).status).toBe(400);
    const range = await request(app).get("/api/admin/user-activity").query({ from: "2026-09-25", to: "2026-09-20" }).set(auth);
    expect(range.status).toBe(400);
    expect(range.body.error).toBe("INVALID_DATE_RANGE");
    expect((await request(app).get("/api/admin/user-activity").query({ limit: 5000 }).set(auth)).status).toBe(400);
    expect((await request(app).get("/api/admin/user-activity").query({ group: "not-a-group" }).set(auth)).status).toBe(400);
  });

  it("the types endpoint returns labelled, grouped types", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin3@example.com", "superadmin");
    const res = await request(app).get("/api/admin/user-activity/types").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.types.find((t: { type: string }) => t.type === "password_changed")).toMatchObject({ label: "Changed their password", group: "security" });
  });
});

describe("GET /admin/user-activity/export", () => {
  it("needs a step-up re-authentication", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin4@example.com", "superadmin");
    const res = await request(app).get("/api/admin/user-activity/export").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("STEP_UP_REQUIRED");
  });

  it("returns a CSV of the filtered rows with row-count headers — and records the export in the Audit Log without the rows", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin5@example.com", "superadmin");
    await seedEvents();
    const res = await request(app)
      .get("/api/admin/user-activity/export")
      .query({ type: "login_failed" })
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="user-activity-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers["x-export-row-count"]).toBe("2");
    expect(res.headers["x-export-truncated"]).toBe("false");
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toContain("time_ist,time_utc,type");
    expect(lines).toHaveLength(3);
    expect(res.text).toContain("ada-act@example.com");

    const audit = await AuditLog.findOne({ action: "user_activity.exported" }).lean();
    expect(audit).toBeTruthy();
    expect(audit?.actorLabel).toBe("act-admin5@example.com");
    expect(audit?.meta).toMatchObject({ rowCount: 2, truncated: false, type: "login_failed" });
    // The audit row records THAT and HOW MUCH was exported — never the personal data itself.
    expect(JSON.stringify(audit)).not.toContain("ada-act@example.com");
  });

  it("validates the same filters as the list", async () => {
    const staff = await loginAsStaff(nextMobile(), "act-admin6@example.com", "superadmin");
    const res = await request(app)
      .get("/api/admin/user-activity/export")
      .query({ from: "garbage" })
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken });
    expect(res.status).toBe(400);
    expect(await AuditLog.countDocuments({ action: "user_activity.exported" })).toBe(0); // nothing exported, nothing logged
  });
});
