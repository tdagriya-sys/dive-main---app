import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { SCORING_CONFIG_DEFAULTS } from "../src/config/scoringDefaults";
import { CONTEXT_CONFIG_DEFAULTS } from "../src/config/contextDefaults";
import { SUGGESTION_CONFIG_DEFAULTS } from "../src/config/suggestionDefaults";
import { LOOKTHROUGH_CONFIG_DEFAULTS } from "../src/config/lookthroughDefaults";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 2 of docs/ADMIN_PANEL_PLAN.md — the admin HTTP surface over the three
// config-driven models (Dive Score / Context Engine / Suggestion layer),
// built on scoringConfigService.ts/contextConfigService.ts/
// suggestionConfigService.ts, already unit-tested in isolation. This file
// covers the routing/permission/step-up wiring, not the lifecycle logic
// itself (no need to re-prove validate/publish/rollback correctness here).

const app = createApp();

// A shared counter (not base.length, which collides: "/api/admin/scoring-config"
// and "/api/admin/context-config" are the same length) keeps every generated
// mobile number both valid (exactly 10 digits, starting 9) and unique across
// every it() in this file, regardless of which describe.each fixture is running.
let mobileCounter = 9700000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Config API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
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

  const stepUp = await request(app)
    .post("/api/auth/staff/step-up")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ password: "Passw0rd!" });
  return { userId, accessToken, stepUpToken: stepUp.body.stepUpToken as string };
}

describe.each([
  { base: "/api/admin/scoring-config", defaults: SCORING_CONFIG_DEFAULTS, tweakField: "cryptoWithinClassCap", tweakValue: 40 },
  { base: "/api/admin/context-config", defaults: CONTEXT_CONFIG_DEFAULTS, tweakField: "defaultClassOrder", tweakValue: [...CONTEXT_CONFIG_DEFAULTS.defaultClassOrder].reverse() },
  { base: "/api/admin/suggestion-config", defaults: SUGGESTION_CONFIG_DEFAULTS, tweakField: "coreCategories", tweakValue: SUGGESTION_CONFIG_DEFAULTS.coreCategories.slice(0, 5) },
  { base: "/api/admin/lookthrough-config", defaults: LOOKTHROUGH_CONFIG_DEFAULTS, tweakField: "sameSectorStrength", tweakValue: 0.2 },
])("admin config API — $base", ({ base, defaults, tweakField, tweakValue }) => {
  it("GET .../active falls back to the built-in defaults when nothing has been published", async () => {
    const staff = await loginAsStaff(nextMobile(), `active-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    const res = await request(app).get(`${base}/active`).set("Authorization", `Bearer ${staff.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual(defaults);
  });

  it("requires scoring_config.view — an employee with no permissions is forbidden", async () => {
    const role = await Role.create({ key: `no_perms_${base}`, label: "No Perms", permissions: [] });
    const staff = await loginAsStaff(nextMobile(), `noperm-${base.replace(/\W/g, "")}@example.com`, "employee", String(role._id));
    const res = await request(app).get(`${base}/active`).set("Authorization", `Bearer ${staff.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("PATCH .../draft requires scoring_config.edit, not just .view", async () => {
    const role = await Role.create({ key: `view_only_${base}`, label: "View Only", permissions: ["scoring_config.view"] });
    const staff = await loginAsStaff(nextMobile(), `viewonly-${base.replace(/\W/g, "")}@example.com`, "employee", String(role._id));
    const res = await request(app)
      .patch(`${base}/draft`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ payload: { [tweakField]: tweakValue } });
    expect(res.status).toBe(403);
  });

  it("publish without a step-up token is refused, even with scoring_config.publish", async () => {
    const staff = await loginAsStaff(nextMobile(), `nostepup-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    await request(app).patch(`${base}/draft`).set("Authorization", `Bearer ${staff.accessToken}`).send({ payload: { [tweakField]: tweakValue } });
    const res = await request(app)
      .post(`${base}/publish`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ changeNote: "no step-up attempt" });
    expect(res.status).toBe(401);
  });

  it("full lifecycle: draft -> validate -> publish (with step-up) -> active reflects it -> history -> rollback", async () => {
    const staff = await loginAsStaff(nextMobile(), `lifecycle-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const draftRes = await request(app).get(`${base}/draft`).set(auth);
    expect(draftRes.status).toBe(200);
    expect(draftRes.body.draft.status).toBe("draft");

    const patchRes = await request(app).patch(`${base}/draft`).set(auth).send({ payload: { [tweakField]: tweakValue } });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.draft.payload[tweakField]).toEqual(tweakValue);

    const validateRes = await request(app).post(`${base}/draft/validate`).set(auth).send({ payload: {} });
    expect(validateRes.status).toBe(200);
    expect(validateRes.body.valid).toBe(true);

    const publishRes = await request(app)
      .post(`${base}/publish`)
      .set(auth)
      .set("x-step-up-token", staff.stepUpToken)
      .send({ changeNote: "integration test publish" });
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.version.status).toBe("active");
    const publishedVersion = publishRes.body.version.version as number;

    const activeRes = await request(app).get(`${base}/active`).set(auth);
    expect(activeRes.body.payload[tweakField]).toEqual(tweakValue);

    const historyRes = await request(app).get(`${base}/history`).set(auth);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.history.some((h: { version: number }) => h.version === publishedVersion)).toBe(true);

    const versionRes = await request(app).get(`${base}/versions/${publishedVersion}`).set(auth);
    expect(versionRes.status).toBe(200);
    expect(versionRes.body.version.payload[tweakField]).toEqual(tweakValue);
  });

  it("rollback restores an earlier published version's payload as a brand-new version", async () => {
    const staff = await loginAsStaff(nextMobile(), `rollback-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const stepUp = { "x-step-up-token": staff.stepUpToken };

    await request(app).patch(`${base}/draft`).set(auth).send({ payload: { [tweakField]: tweakValue } });
    const v1 = await request(app).post(`${base}/publish`).set(auth).set(stepUp).send({ changeNote: "v1" });
    expect(v1.status).toBe(200);
    const v1Version = v1.body.version.version as number;

    await request(app).patch(`${base}/draft`).set(auth).send({ payload: { [tweakField]: defaults[tweakField as keyof typeof defaults] } });
    const v2 = await request(app).post(`${base}/publish`).set(auth).set(stepUp).send({ changeNote: "v2" });
    expect(v2.status).toBe(200);

    const rollbackRes = await request(app).post(`${base}/rollback`).set(auth).set(stepUp).send({ targetVersion: v1Version });
    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.version.payload[tweakField]).toEqual(tweakValue);
    expect(rollbackRes.body.version.changeNote).toMatch(/Rolled back/);

    const activeRes = await request(app).get(`${base}/active`).set(auth);
    expect(activeRes.body.payload[tweakField]).toEqual(tweakValue);
  });

  it("publish rejects an empty change note", async () => {
    const staff = await loginAsStaff(nextMobile(), `nochangenote-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    const res = await request(app)
      .post(`${base}/publish`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("x-step-up-token", staff.stepUpToken)
      .send({ changeNote: "" });
    expect(res.status).toBe(400);
  });

  it("rollback 404s for an unknown version", async () => {
    const staff = await loginAsStaff(nextMobile(), `badrollback-${base.replace(/\W/g, "")}@example.com`, "superadmin");
    const res = await request(app)
      .post(`${base}/rollback`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("x-step-up-token", staff.stepUpToken)
      .send({ targetVersion: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// The simulation sandbox exists for Scoring, Context, and Lookthrough (see
// simulationService.ts's own comment on why Suggestion has none) — a
// separate, non-parameterized block rather than folding into the
// describe.each above.
describe("admin config API — simulation sandbox", () => {
  it.each(["/api/admin/scoring-config", "/api/admin/context-config", "/api/admin/lookthrough-config"])(
    "%s/simulate requires scoring_config.edit, not just .view",
    async (base) => {
      const role = await Role.create({ key: `sim-view-only-${base}`, label: "View Only", permissions: ["scoring_config.view"] });
      const staff = await loginAsStaff(nextMobile(), `simviewonly-${base.replace(/\W/g, "")}@example.com`, "employee", String(role._id));
      const res = await request(app).post(`${base}/simulate`).set("Authorization", `Bearer ${staff.accessToken}`).send({});
      expect(res.status).toBe(403);
    }
  );

  it.each(["/api/admin/scoring-config", "/api/admin/context-config", "/api/admin/lookthrough-config"])(
    "%s/simulate does NOT require step-up — it's read-only, unlike publish/rollback",
    async (base) => {
      const staff = await loginAsStaff(nextMobile(), `simnostepup-${base.replace(/\W/g, "")}@example.com`, "superadmin");
      const res = await request(app).post(`${base}/simulate`).set("Authorization", `Bearer ${staff.accessToken}`).send({});
      expect(res.status).toBe(200);
    }
  );

  it("scoring-config/simulate returns the aggregate result shape, merging the given payload over the current draft", async () => {
    const staff = await loginAsStaff(nextMobile(), "sim-scoring-shape@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app)
      .post("/api/admin/scoring-config/simulate")
      .set(auth)
      .send({ payload: { cryptoWithinClassCap: 10 }, sampleSize: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      requestedSampleSize: 5,
      sampleSize: 0, // no real users with holdings exist in this test's fresh DB
      avgDelta: 0,
      sampleDeltas: [],
    });
  });

  it("context-config/simulate returns the aggregate result shape", async () => {
    const staff = await loginAsStaff(nextMobile(), "sim-context-shape@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app).post("/api/admin/context-config/simulate").set(auth).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requestedSampleSize: 20, sampleSize: 0, avgDelta: 0 });
  });

  it("lookthrough-config/simulate returns the aggregate result shape", async () => {
    const staff = await loginAsStaff(nextMobile(), "sim-lookthrough-shape@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app)
      .post("/api/admin/lookthrough-config/simulate")
      .set(auth)
      .send({ payload: { sameSectorStrength: 0.2 }, sampleSize: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requestedSampleSize: 5, sampleSize: 0, avgDelta: 0, sampleDeltas: [] });
  });

  it("there is no simulate route for suggestion-config", async () => {
    const staff = await loginAsStaff(nextMobile(), "sim-suggestion-404@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/suggestion-config/simulate")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
