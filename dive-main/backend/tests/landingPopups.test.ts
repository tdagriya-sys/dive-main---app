import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { LandingPopup } from "../src/models/LandingPopup";
import * as landingPopupService from "../src/services/landingPopupService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Public landing-page pop-ups: shown to logged-out visitors, no per-user
// rows. Covers the service (render-at-save, active-is-locked), the PUBLIC
// endpoint (no auth, only active popups, only the fields a browser needs),
// and the admin API (permission gating, step-up on activate).

const app = createApp();

let mobileCounter = 9830000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Landing Popup Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
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

const CONTENT = { name: "Spring sale", title: "Spring sale is live", bodyMarkdown: "Get ==50% off== today. [See offers](https://example.com/offers)" };

describe("landingPopupService", () => {
  it("creates an INACTIVE popup with the body rendered once at save time (callout, highlight, link, and button included)", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-svc-create@example.com", "superadmin");
    const popup = await landingPopupService.createLandingPopup({
      ...CONTENT,
      callout: { text: "Big news", linkUrl: "/?go=signup" },
      button: { label: "Sign up", url: "/?go=signup" },
      createdBy: staff.userId,
    });
    expect(popup.isActive).toBe(false);
    expect(popup.bodyHtml).toContain("Big news");
    expect(popup.bodyHtml).toContain('<span style="color:#D4AF37;font-weight:bold">50% off</span>');
    expect(popup.bodyHtml).toContain(">See offers</a>");
    expect(popup.bodyHtml).toContain(">Sign up</a>");
  });

  it("re-renders bodyHtml on update, and null clears the button/callout", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-svc-update@example.com", "superadmin");
    const popup = await landingPopupService.createLandingPopup({ ...CONTENT, button: { label: "Sign up", url: "/?go=signup" }, createdBy: staff.userId });
    const updated = await landingPopupService.updateLandingPopup(String(popup._id), { bodyMarkdown: "Brand new text", button: null });
    expect(updated.bodyHtml).toBe("Brand new text");
    expect(updated.button).toBeUndefined();
  });

  it("locks an ACTIVE popup: it can't be edited or deleted until deactivated", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-svc-lock@example.com", "superadmin");
    const popup = await landingPopupService.createLandingPopup({ ...CONTENT, createdBy: staff.userId });
    await landingPopupService.setLandingPopupActive(String(popup._id), true);

    await expect(landingPopupService.updateLandingPopup(String(popup._id), { title: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(landingPopupService.deleteLandingPopup(String(popup._id))).rejects.toMatchObject({ status: 400 });

    await landingPopupService.setLandingPopupActive(String(popup._id), false);
    await expect(landingPopupService.updateLandingPopup(String(popup._id), { title: "Edited" })).resolves.toMatchObject({ title: "Edited" });
    await landingPopupService.deleteLandingPopup(String(popup._id));
    expect(await LandingPopup.findById(popup._id)).toBeNull();
  });

  it("lists only active popups publicly, oldest-activated first, with a version stamp that changes on re-activation", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-svc-public@example.com", "superadmin");
    const first = await landingPopupService.createLandingPopup({ ...CONTENT, name: "First", createdBy: staff.userId });
    const second = await landingPopupService.createLandingPopup({ ...CONTENT, name: "Second", title: "Second title", createdBy: staff.userId });
    await landingPopupService.createLandingPopup({ ...CONTENT, name: "Never activated", createdBy: staff.userId });

    await landingPopupService.setLandingPopupActive(String(second._id), true);
    await new Promise((r) => setTimeout(r, 5));
    await landingPopupService.setLandingPopupActive(String(first._id), true);

    const list = await landingPopupService.listPublicLandingPopups();
    expect(list.map((p) => p.title)).toEqual(["Second title", CONTENT.title]);
    expect(Object.keys(list[0]).sort()).toEqual(["bodyHtml", "id", "title", "version"]);

    const versionBefore = list[1].version;
    await landingPopupService.setLandingPopupActive(String(first._id), false);
    await new Promise((r) => setTimeout(r, 5));
    await landingPopupService.setLandingPopupActive(String(first._id), true);
    const after = await landingPopupService.listPublicLandingPopups();
    expect(after.find((p) => p.id === String(first._id))!.version).toBeGreaterThan(versionBefore);
  });
});

describe("GET /api/landing-popups (public)", () => {
  it("needs no login and returns only active popups, with no admin-only fields", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-public@example.com", "superadmin");
    const live = await landingPopupService.createLandingPopup({ ...CONTENT, name: "Live", title: "Live one", createdBy: staff.userId });
    await landingPopupService.createLandingPopup({ ...CONTENT, name: "Hidden", title: "Hidden one", createdBy: staff.userId });
    await landingPopupService.setLandingPopupActive(String(live._id), true);

    const res = await request(app).get("/api/landing-popups");
    expect(res.status).toBe(200);
    expect(res.body.popups.map((p: { title: string }) => p.title)).toEqual(["Live one"]);
    expect(res.body.popups[0].bodyHtml).toContain("50% off");
    expect(res.body.popups[0].bodyMarkdown).toBeUndefined();
    expect(res.body.popups[0].name).toBeUndefined();
    expect(res.body.popups[0].createdBy).toBeUndefined();
  });

  it("returns an empty list when nothing is active", async () => {
    const res = await request(app).get("/api/landing-popups");
    expect(res.status).toBe(200);
    expect(res.body.popups).toEqual([]);
  });
});

describe("/api/admin/landing-popups", () => {
  it("requires notifications.send — an employee with only notifications.manage_templates is refused", async () => {
    const role = await Role.create({ key: "lp_templates_only", label: "Templates only", permissions: ["notifications.manage_templates"] });
    const staff = await loginAsStaff(nextMobile(), "lp-perm@example.com", "employee", String(role._id));
    const res = await request(app).get("/api/admin/landing-popups").set({ Authorization: `Bearer ${staff.accessToken}` });
    expect(res.status).toBe(403);
    expect((await request(app).get("/api/admin/landing-popups")).status).toBe(401);
  });

  it("creates (inactive), lists, edits, and validates content", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-crud@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/landing-popups").set(auth).send({ ...CONTENT, button: { label: "Sign up", url: "/?go=signup" } });
    expect(create.status).toBe(201);
    expect(create.body.popup.isActive).toBe(false);
    expect(create.body.popup.bodyHtml).toContain(">Sign up</a>");

    const list = await request(app).get("/api/admin/landing-popups").set(auth);
    expect(list.body.popups.map((p: { name: string }) => p.name)).toContain("Spring sale");

    const edit = await request(app).patch(`/api/admin/landing-popups/${create.body.popup.id}`).set(auth).send({ title: "New title", button: null });
    expect(edit.status).toBe(200);
    expect(edit.body.popup.title).toBe("New title");
    expect(edit.body.popup.button).toBeNull();

    const bad = await request(app).post("/api/admin/landing-popups").set(auth).send({ ...CONTENT, button: { label: "Go", url: "javascript:alert(1)" } });
    expect(bad.status).toBe(400);
    const empty = await request(app).post("/api/admin/landing-popups").set(auth).send({ name: "x" });
    expect(empty.status).toBe(400);
  });

  it("requires step-up to ACTIVATE, but not to deactivate; an active popup can't be edited or deleted", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-activate@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app).post("/api/admin/landing-popups").set(auth).send(CONTENT);
    const id = create.body.popup.id;

    const noStepUp = await request(app).post(`/api/admin/landing-popups/${id}/activate`).set(auth).send({});
    expect(noStepUp.status).toBe(401);
    expect((await request(app).get("/api/landing-popups")).body.popups).toEqual([]);

    const activate = await request(app).post(`/api/admin/landing-popups/${id}/activate`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(activate.status).toBe(200);
    expect(activate.body.popup.isActive).toBe(true);
    expect((await request(app).get("/api/landing-popups")).body.popups).toHaveLength(1);

    expect((await request(app).patch(`/api/admin/landing-popups/${id}`).set(auth).send({ title: "Sneaky live edit" })).status).toBe(400);
    expect((await request(app).delete(`/api/admin/landing-popups/${id}`).set(auth)).status).toBe(400);

    const deactivate = await request(app).post(`/api/admin/landing-popups/${id}/deactivate`).set(auth).send({});
    expect(deactivate.status).toBe(200);
    expect((await request(app).get("/api/landing-popups")).body.popups).toEqual([]);

    expect((await request(app).delete(`/api/admin/landing-popups/${id}`).set(auth)).status).toBe(200);
  });

  it("returns 404 for an unknown popup id", async () => {
    const staff = await loginAsStaff(nextMobile(), "lp-404@example.com", "superadmin");
    const res = await request(app).patch("/api/admin/landing-popups/64b000000000000000000000").set({ Authorization: `Bearer ${staff.accessToken}` }).send({ title: "x" });
    expect(res.status).toBe(404);
  });
});
