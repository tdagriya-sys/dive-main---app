import request from "supertest";
import { createApp } from "../src/app";
import { PendingSignup } from "../src/models/PendingSignup";

const app = createApp();

const validSignup = {
  name: "Test User",
  mobile: "9876543210",
  email: "testuser@example.com",
  age: 25,
  password: "Passw0rd!",
  confirmPassword: "Passw0rd!",
};

async function completeSignup() {
  const startRes = await request(app).post("/api/auth/signup/start").send(validSignup);
  expect(startRes.status).toBe(200);
  const pending = await PendingSignup.findOne({ mobile: "9876543210" });
  expect(pending).toBeTruthy();
  const otp = startRes.body.devOtp;
  expect(otp).toBeTruthy();

  const verifyRes = await request(app).post("/api/auth/signup/verify").send({ mobile: "9876543210", otp });
  return verifyRes;
}

describe("auth", () => {
  it("signs up a new user via OTP flow", async () => {
    const verifyRes = await completeSignup();
    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.accessToken).toBeTruthy();
    expect(verifyRes.body.user.email).toBe("testuser@example.com");
  });

  it("rejects signup with mismatched passwords", async () => {
    const res = await request(app)
      .post("/api/auth/signup/start")
      .send({ ...validSignup, confirmPassword: "Different1!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects signup under the minimum age", async () => {
    const res = await request(app).post("/api/auth/signup/start").send({ ...validSignup, age: 15 });
    expect(res.status).toBe(400);
  });

  it("rejects OTP verify with a wrong code", async () => {
    await request(app).post("/api/auth/signup/start").send(validSignup);
    const res = await request(app).post("/api/auth/signup/verify").send({ mobile: "9876543210", otp: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_OTP");
  });

  it("logs in an existing user with email + password", async () => {
    await completeSignup();
    const res = await request(app).post("/api/auth/login").send({ identifier: "testuser@example.com", password: "Passw0rd!" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("returns USER_NOT_FOUND for an unregistered identifier", async () => {
    const res = await request(app).post("/api/auth/login").send({ identifier: "nobody@example.com", password: "whatever1A" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("USER_NOT_FOUND");
  });

  it("returns INVALID_CREDENTIALS for a wrong password", async () => {
    await completeSignup();
    const res = await request(app).post("/api/auth/login").send({ identifier: "testuser@example.com", password: "WrongPass1" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });
});

describe("forgot password", () => {
  it("verifies email via OTP, then sets a new password that actually works on the next login", async () => {
    await completeSignup();

    const startRes = await request(app).post("/api/auth/forgot-password/start").send({ identifier: "testuser@example.com" });
    expect(startRes.status).toBe(200);
    expect(startRes.body.mobile).toBe("9876543210");
    const otp = startRes.body.devOtp;
    expect(otp).toBeTruthy();

    const verifyRes = await request(app).post("/api/auth/forgot-password/verify").send({ mobile: "9876543210", otp });
    expect(verifyRes.status).toBe(200);
    const resetToken = verifyRes.body.resetToken;
    expect(resetToken).toBeTruthy();

    const resetRes = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({ resetToken, newPassword: "NewPassw0rd!", confirmNewPassword: "NewPassw0rd!" });
    expect(resetRes.status).toBe(200);

    // The old password must no longer work...
    const oldLogin = await request(app).post("/api/auth/login").send({ identifier: "testuser@example.com", password: "Passw0rd!" });
    expect(oldLogin.status).toBe(401);

    // ...and the new one must.
    const newLogin = await request(app).post("/api/auth/login").send({ identifier: "testuser@example.com", password: "NewPassw0rd!" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.accessToken).toBeTruthy();
  });

  it("returns USER_NOT_FOUND for an unregistered identifier", async () => {
    const res = await request(app).post("/api/auth/forgot-password/start").send({ identifier: "nobody@example.com" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("USER_NOT_FOUND");
  });

  it("rejects verify with a wrong OTP", async () => {
    await completeSignup();
    await request(app).post("/api/auth/forgot-password/start").send({ identifier: "testuser@example.com" });
    const res = await request(app).post("/api/auth/forgot-password/verify").send({ mobile: "9876543210", otp: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_OTP");
  });

  it("rejects reset with a garbage/expired reset token — the OTP alone is never accepted as proof", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({ resetToken: "not-a-real-token", newPassword: "NewPassw0rd!", confirmNewPassword: "NewPassw0rd!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects reset with mismatched new passwords", async () => {
    await completeSignup();
    const startRes = await request(app).post("/api/auth/forgot-password/start").send({ identifier: "testuser@example.com" });
    const verifyRes = await request(app)
      .post("/api/auth/forgot-password/verify")
      .send({ mobile: "9876543210", otp: startRes.body.devOtp });

    const res = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({ resetToken: verifyRes.body.resetToken, newPassword: "NewPassw0rd!", confirmNewPassword: "Different1!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("never accepts a real login refresh token as a password-reset token", async () => {
    await completeSignup();
    const login = await request(app).post("/api/auth/login").send({ identifier: "testuser@example.com", password: "Passw0rd!" });
    const cookie = login.headers["set-cookie"][0];
    const refreshTokenValue = cookie.split(";")[0].split("=")[1];

    const res = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({ resetToken: refreshTokenValue, newPassword: "NewPassw0rd!", confirmNewPassword: "NewPassw0rd!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_RESET_TOKEN");
  });
});
