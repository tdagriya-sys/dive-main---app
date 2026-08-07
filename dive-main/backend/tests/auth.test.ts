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
