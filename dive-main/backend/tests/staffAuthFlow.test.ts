import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

function tokenLifetimeSeconds(token: string): number {
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return exp - iat;
}

const app = createApp();

async function signupNormalUser(mobile: string, email: string, password = "Passw0rd!") {
  const signup = { name: "Staff Tester", mobile, email, age: 30, password, confirmPassword: password };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.user.id as string;
}

async function promoteToStaff(userId: string, staffRole: "superadmin" | "admin" | "employee" = "admin") {
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  await user.save();
  return user;
}

// Phase 0.3 of docs/ADMIN_PANEL_PLAN.md — the full staff login -> mandatory
// TOTP enrolment/verification flow, end to end through the real HTTP routes.
describe("staff login + mandatory TOTP", () => {
  it("a normal (non-staff) user's login is completely unaffected", async () => {
    const mobile = "9700000001";
    await signupNormalUser(mobile, "normal1@example.com");
    const res = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.staffAuthRequired).toBeUndefined();
  });

  it("a staff account gets a pending token instead of real tokens, with totpEnrolled:false before setup", async () => {
    const mobile = "9700000002";
    const userId = await signupNormalUser(mobile, "staff2@example.com");
    await promoteToStaff(userId);

    const res = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.staffAuthRequired).toBe(true);
    expect(res.body.totpEnrolled).toBe(false);
    expect(typeof res.body.pendingToken).toBe("string");
  });

  it("a suspended staff account is rejected at the password-check stage, before any pending token is issued", async () => {
    const mobile = "9700000003";
    const userId = await signupNormalUser(mobile, "staff3@example.com");
    const user = await promoteToStaff(userId);
    user.status = "suspended";
    await user.save();

    const res = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ACCOUNT_SUSPENDED");
  });

  it("full enrolment: setup -> confirm with a valid code -> real session + one-time recovery codes", async () => {
    const mobile = "9700000004";
    const userId = await signupNormalUser(mobile, "staff4@example.com");
    await promoteToStaff(userId);

    const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const pending = { Authorization: `Bearer ${login.body.pendingToken}` };

    const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret = setup.body.secret as string;

    const wrongConfirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code: "000000" });
    expect(wrongConfirm.status).toBe(400);
    expect(wrongConfirm.body.error).toBe("INVALID_CODE");

    const code = _generateCurrentCodeForTests(secret);
    const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.accessToken).toBeTruthy();
    expect(confirm.body.user.staffRole).toBe("admin");
    expect(confirm.body.recoveryCodes).toHaveLength(8);

    // Enrolling twice is rejected, not silently re-run.
    const secondConfirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
    expect(secondConfirm.status).toBe(400);
    expect(secondConfirm.body.error).toBe("ALREADY_ENROLLED");
  });

  it("regular sign-in once enrolled: login -> totpEnrolled:true -> verify with a valid code", async () => {
    const mobile = "9700000005";
    const userId = await signupNormalUser(mobile, "staff5@example.com");
    await promoteToStaff(userId);

    // Enrol first.
    const firstLogin = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const setup = await request(app)
      .post("/api/auth/staff/totp/setup")
      .set({ Authorization: `Bearer ${firstLogin.body.pendingToken}` })
      .send();
    const secret = setup.body.secret as string;
    await request(app)
      .post("/api/auth/staff/totp/confirm")
      .set({ Authorization: `Bearer ${firstLogin.body.pendingToken}` })
      .send({ code: _generateCurrentCodeForTests(secret) });

    // Now a fresh login should report enrolled and require /verify, not /confirm.
    const secondLogin = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    expect(secondLogin.body.totpEnrolled).toBe(true);
    const pending2 = { Authorization: `Bearer ${secondLogin.body.pendingToken}` };

    const wrongVerify = await request(app).post("/api/auth/staff/totp/verify").set(pending2).send({ code: "000000" });
    expect(wrongVerify.status).toBe(401);
    expect(wrongVerify.body.error).toBe("INVALID_CODE");

    const verify = await request(app).post("/api/auth/staff/totp/verify").set(pending2).send({ code: _generateCurrentCodeForTests(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.accessToken).toBeTruthy();
    expect(verify.body.recoveryCodeUsed).toBeUndefined();
  });

  it("a recovery code works once as a fallback, then is rejected on reuse", async () => {
    const mobile = "9700000006";
    const userId = await signupNormalUser(mobile, "staff6@example.com");
    await promoteToStaff(userId);

    const firstLogin = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const setup = await request(app)
      .post("/api/auth/staff/totp/setup")
      .set({ Authorization: `Bearer ${firstLogin.body.pendingToken}` })
      .send();
    const secret = setup.body.secret as string;
    const confirm = await request(app)
      .post("/api/auth/staff/totp/confirm")
      .set({ Authorization: `Bearer ${firstLogin.body.pendingToken}` })
      .send({ code: _generateCurrentCodeForTests(secret) });
    const recoveryCode = confirm.body.recoveryCodes[0] as string;

    const secondLogin = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const pending2 = { Authorization: `Bearer ${secondLogin.body.pendingToken}` };

    const verifyWithRecovery = await request(app).post("/api/auth/staff/totp/verify").set(pending2).send({ code: recoveryCode });
    expect(verifyWithRecovery.status).toBe(200);
    expect(verifyWithRecovery.body.recoveryCodeUsed).toBe(true);
    expect(verifyWithRecovery.body.recoveryCodesRemaining).toBe(7);

    // Reuse of the SAME recovery code must fail — one-time use.
    const thirdLogin = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const reuse = await request(app)
      .post("/api/auth/staff/totp/verify")
      .set({ Authorization: `Bearer ${thirdLogin.body.pendingToken}` })
      .send({ code: recoveryCode });
    expect(reuse.status).toBe(401);
  });

  it("a pending token can't be reused for a DIFFERENT staff member's totp endpoints", async () => {
    const userIdA = await signupNormalUser("9700000007", "staffA@example.com");
    await promoteToStaff(userIdA);
    const userIdB = await signupNormalUser("9700000008", "staffB@example.com");
    await promoteToStaff(userIdB);

    const loginA = await request(app).post("/api/auth/login").send({ identifier: "9700000007", password: "Passw0rd!" });
    const setupA = await request(app)
      .post("/api/auth/staff/totp/setup")
      .set({ Authorization: `Bearer ${loginA.body.pendingToken}` })
      .send();

    // B's own login produces a token that can only ever act on B's account —
    // proven by A's setup secret not matching whatever B's own setup would be.
    const loginB = await request(app).post("/api/auth/login").send({ identifier: "9700000008", password: "Passw0rd!" });
    const setupB = await request(app)
      .post("/api/auth/staff/totp/setup")
      .set({ Authorization: `Bearer ${loginB.body.pendingToken}` })
      .send();
    expect(setupA.body.secret).not.toBe(setupB.body.secret);
  });

  it("step-up: issues a token only with the correct current password, on a real (non-pending) session", async () => {
    const mobile = "9700000009";
    const userId = await signupNormalUser(mobile, "staff9@example.com");
    await promoteToStaff(userId, "superadmin");

    const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const setup = await request(app)
      .post("/api/auth/staff/totp/setup")
      .set({ Authorization: `Bearer ${login.body.pendingToken}` })
      .send();
    const confirm = await request(app)
      .post("/api/auth/staff/totp/confirm")
      .set({ Authorization: `Bearer ${login.body.pendingToken}` })
      .send({ code: _generateCurrentCodeForTests(setup.body.secret) });

    const auth = { Authorization: `Bearer ${confirm.body.accessToken}` };
    const wrongPassword = await request(app).post("/api/auth/staff/step-up").set(auth).send({ password: "WrongPass1!" });
    expect(wrongPassword.status).toBe(401);

    const stepUp = await request(app).post("/api/auth/staff/step-up").set(auth).send({ password: "Passw0rd!" });
    expect(stepUp.status).toBe(200);
    expect(typeof stepUp.body.stepUpToken).toBe("string");
  });

  it("step-up is refused for a non-staff user even with a valid access token", async () => {
    const mobile = "9700000010";
    await signupNormalUser(mobile, "normal10@example.com");
    const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
    const res = await request(app)
      .post("/api/auth/staff/step-up")
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send({ password: "Passw0rd!" });
    expect(res.status).toBe(403);
  });

  // Regression: STAFF_ACCESS_TTL (utils/jwt.ts::signStaffAccessToken) was
  // defined since Phase 0.3 but never actually applied — every staff session
  // silently got the same longer TTL as a regular user via the shared
  // signAccessToken. A staff token now carries a shorter lifetime, both at
  // initial enrolment/login and across a refresh (the two are checked
  // separately since authController.ts::refresh has its own staffRole
  // branch, not just a shared code path with totp/confirm).
  it("a staff session's access token uses the shorter STAFF_ACCESS_TTL, not a regular user's TTL — at enrolment and across a refresh", async () => {
    const normalMobile = "9700000011";
    await signupNormalUser(normalMobile, "normal11@example.com");
    const normalLogin = await request(app).post("/api/auth/login").send({ identifier: normalMobile, password: "Passw0rd!" });
    const normalTtl = tokenLifetimeSeconds(normalLogin.body.accessToken);

    const staffMobile = "9700000012";
    const staffUserId = await signupNormalUser(staffMobile, "staff12@example.com");
    await promoteToStaff(staffUserId);
    const staffLogin = await request(app).post("/api/auth/login").send({ identifier: staffMobile, password: "Passw0rd!" });
    const pending = { Authorization: `Bearer ${staffLogin.body.pendingToken}` };
    const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
    const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code: _generateCurrentCodeForTests(setup.body.secret) });
    const staffTtlAtConfirm = tokenLifetimeSeconds(confirm.body.accessToken);

    expect(staffTtlAtConfirm).toBeLessThan(normalTtl);

    // A second login cycle, this time via totpVerify (already enrolled).
    const staffLogin2 = await request(app).post("/api/auth/login").send({ identifier: staffMobile, password: "Passw0rd!" });
    const verify = await request(app)
      .post("/api/auth/staff/totp/verify")
      .set({ Authorization: `Bearer ${staffLogin2.body.pendingToken}` })
      .send({ code: _generateCurrentCodeForTests(setup.body.secret) });
    expect(tokenLifetimeSeconds(verify.body.accessToken)).toBe(staffTtlAtConfirm);

    // Refreshing the staff session must NOT quietly widen back out to a
    // regular user's TTL — this is the part that's easy to miss, since
    // /auth/refresh is a single shared endpoint for both kinds of session.
    const refreshRes = await request(app).post("/api/auth/refresh").set("Cookie", verify.headers["set-cookie"][0]);
    expect(refreshRes.status).toBe(200);
    expect(tokenLifetimeSeconds(refreshRes.body.accessToken)).toBe(staffTtlAtConfirm);
  });
});
