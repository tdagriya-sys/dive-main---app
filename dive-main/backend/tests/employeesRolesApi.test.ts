import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { StaffInvite } from "../src/models/StaffInvite";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 3 of docs/ADMIN_PANEL_PLAN.md — the admin HTTP surface over
// employees/roles: permission gating (both superadmin-only), the full
// invite -> accept -> login journey, and roles CRUD.

const app = createApp();

let mobileCounter = 9810000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Employees API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
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

describe("admin employees/roles API — permission gating", () => {
  it("an admin (not superadmin) is forbidden from every employees/roles route", async () => {
    const staff = await loginAsStaff(nextMobile(), "admin-forbidden@example.com", "admin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/employees").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/admin/roles").set(auth)).status).toBe(403);
    expect(
      (await request(app).post("/api/admin/employees/invite").set(auth).set("x-step-up-token", staff.stepUpToken).send({ email: "x@example.com", staffRole: "admin" })).status
    ).toBe(403);
  });

  it("a superadmin can reach both", async () => {
    const staff = await loginAsStaff(nextMobile(), "superadmin-allowed@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/employees").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/roles").set(auth)).status).toBe(200);
  });
});

describe("admin employees API — invite / accept / login journey", () => {
  it("invite requires step-up", async () => {
    const staff = await loginAsStaff(nextMobile(), "no-stepup@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/employees/invite")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ email: "invited-nostepup@example.com", staffRole: "admin" });
    expect(res.status).toBe(401);
  });

  it("invites a new admin, and the invite shows up in the employees list as pending", async () => {
    const staff = await loginAsStaff(nextMobile(), "inviter1@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };

    const invite = await request(app).post("/api/admin/employees/invite").set(auth).send({ email: "invited1@example.com", staffRole: "admin" });
    expect(invite.status).toBe(201);
    expect(invite.body.devInviteLink).toMatch(/accept-invite\?token=/);

    const list = await request(app).get("/api/admin/employees").set("Authorization", `Bearer ${staff.accessToken}`);
    expect(list.body.invites.some((i: { email: string; status: string }) => i.email === "invited1@example.com" && i.status === "pending")).toBe(true);
  });

  it("the full journey: invite -> preview -> accept -> normal staff login", async () => {
    const staff = await loginAsStaff(nextMobile(), "inviter2@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };

    const invite = await request(app).post("/api/admin/employees/invite").set(auth).send({ email: "invited2@example.com", staffRole: "admin" });
    const rawToken = invite.body.devInviteLink.split("token=")[1];

    const preview = await request(app).get(`/api/auth/staff/invite/${rawToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ email: "invited2@example.com", staffRole: "admin" });

    const accept = await request(app).post("/api/auth/staff/accept-invite").send({
      token: rawToken, name: "Invited Admin", mobile: nextMobile(), age: 29, password: "Passw0rd!", confirmPassword: "Passw0rd!",
    });
    expect(accept.status).toBe(201);
    expect(accept.body.email).toBe("invited2@example.com");

    // The new account can now log in normally, hitting the same
    // pending-token -> TOTP-enrolment path every staff account goes through.
    const login = await request(app).post("/api/auth/login").send({ identifier: "invited2@example.com", password: "Passw0rd!" });
    expect(login.status).toBe(200);
    expect(login.body.staffAuthRequired).toBe(true);
    expect(login.body.totpEnrolled).toBe(false);
  });

  it("rejects accepting with mismatched confirmPassword", async () => {
    const staff = await loginAsStaff(nextMobile(), "inviter3@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const invite = await request(app).post("/api/admin/employees/invite").set(auth).send({ email: "invited3@example.com", staffRole: "admin" });
    const rawToken = invite.body.devInviteLink.split("token=")[1];

    const accept = await request(app).post("/api/auth/staff/accept-invite").send({
      token: rawToken, name: "A", mobile: nextMobile(), age: 29, password: "Passw0rd!", confirmPassword: "Different1!",
    });
    expect(accept.status).toBe(400);
  });

  it("invite preview 404s for an unknown token", async () => {
    const res = await request(app).get("/api/auth/staff/invite/not-a-real-token");
    expect(res.status).toBe(404);
  });

  it("revoking an invite removes it from the pending list", async () => {
    const staff = await loginAsStaff(nextMobile(), "inviter4@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const invite = await request(app).post("/api/admin/employees/invite").set(auth).send({ email: "invited4@example.com", staffRole: "admin" });
    const inviteId = invite.body.invite.id;

    const revoke = await request(app).post(`/api/admin/employees/invites/${inviteId}/revoke`).set(auth).send();
    expect(revoke.status).toBe(200);
    expect(revoke.body.invite.status).toBe("revoked");

    const list = await request(app).get("/api/admin/employees").set("Authorization", `Bearer ${staff.accessToken}`);
    expect(list.body.invites.some((i: { email: string }) => i.email === "invited4@example.com")).toBe(false);
  });

  it("employee invite requires a roleId", async () => {
    const staff = await loginAsStaff(nextMobile(), "inviter5@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const res = await request(app).post("/api/admin/employees/invite").set(auth).send({ email: "e@example.com", staffRole: "employee" });
    expect(res.status).toBe(400);
  });
});

describe("admin employees API — updateEmployee", () => {
  it("cannot edit a superadmin account", async () => {
    const staff = await loginAsStaff(nextMobile(), "target-superadmin@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const res = await request(app).patch(`/api/admin/employees/${staff.userId}`).set(auth).send({ status: "suspended" });
    expect(res.status).toBe(400);
  });

  it("suspends an admin account", async () => {
    const superadmin = await loginAsStaff(nextMobile(), "actor-superadmin@example.com", "superadmin");
    const target = await loginAsStaff(nextMobile(), "target-admin@example.com", "admin");
    const auth = { Authorization: `Bearer ${superadmin.accessToken}`, "x-step-up-token": superadmin.stepUpToken };

    const res = await request(app).patch(`/api/admin/employees/${target.userId}`).set(auth).send({ status: "suspended" });
    expect(res.status).toBe(200);
    expect(res.body.employee.status).toBe("suspended");

    const reloaded = await User.findById(target.userId).lean();
    expect(reloaded!.status).toBe("suspended");
  });
});

describe("admin roles API — CRUD", () => {
  it("creates, updates, and deletes a role", async () => {
    const staff = await loginAsStaff(nextMobile(), "roles-crud@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };

    const create = await request(app).post("/api/admin/roles").set(auth).send({ key: "content_editor", label: "Content Editor", permissions: ["tickets.view"] });
    expect(create.status).toBe(201);
    const roleId = create.body.role._id;

    const update = await request(app).patch(`/api/admin/roles/${roleId}`).set(auth).send({ label: "Content Editor v2", permissions: ["tickets.view", "tickets.respond"] });
    expect(update.status).toBe(200);
    expect(update.body.role.label).toBe("Content Editor v2");

    const del = await request(app).delete(`/api/admin/roles/${roleId}`).set(auth).send();
    expect(del.status).toBe(200);
    expect(await Role.findById(roleId).lean()).toBeNull();
  });

  it("rejects a role with an unknown permission", async () => {
    const staff = await loginAsStaff(nextMobile(), "roles-badperm@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const res = await request(app).post("/api/admin/roles").set(auth).send({ key: "bad_role", label: "Bad", permissions: ["not.a.real.permission"] });
    expect(res.status).toBe(400);
  });

  it("rejects deleting a role that still has employees assigned", async () => {
    const staff = await loginAsStaff(nextMobile(), "roles-inuse@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const role = await Role.create({ key: "in_use_role", label: "In Use" });
    await loginAsStaff(nextMobile(), "role-holder@example.com", "employee", String(role._id));

    const res = await request(app).delete(`/api/admin/roles/${role._id}`).set(auth).send();
    expect(res.status).toBe(400);
  });

  it("rejects creating a role with a duplicate key", async () => {
    const staff = await loginAsStaff(nextMobile(), "roles-dupkey@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    await request(app).post("/api/admin/roles").set(auth).send({ key: "dup_role", label: "Dup" });
    const res = await request(app).post("/api/admin/roles").set(auth).send({ key: "dup_role", label: "Dup 2" });
    expect(res.status).toBe(409);
  });
});
