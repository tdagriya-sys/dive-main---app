import request from "supertest";
import { createApp } from "../src/app";
import { Instrument } from "../src/models/Instrument";

const app = createApp();

async function signupAndLogin() {
  const signup = {
    name: "Holdings Tester",
    mobile: "9123456780",
    email: "holdings@example.com",
    age: 30,
    password: "Passw0rd!",
    confirmPassword: "Passw0rd!",
  };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app)
    .post("/api/auth/signup/verify")
    .send({ mobile: "9123456780", otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

describe("holdings", () => {
  it("creates a manual equity holding and lists it", async () => {
    const token = await signupAndLogin();
    const create = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 11000 });
    expect(create.status).toBe(201);
    expect(create.body.holding.assetClass).toBe("EQUITY");

    const list = await request(app).get("/api/holdings").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.holdings).toHaveLength(1);
  });

  it("computes FD current/maturity value from principal + rate + tenure", async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetClass: "FD",
        bank: "HDFC Bank",
        principal: 100000,
        tenureMonths: 12,
        startMonth: new Date().getMonth() + 1,
        startYear: new Date().getFullYear(),
        interestRate: 7,
      });
    expect(res.status).toBe(201);
    expect(res.body.holding.extraFields.maturityValue).toBeGreaterThan(100000);
  });

  it("rejects a holding for an unauthenticated request", async () => {
    const res = await request(app).get("/api/holdings");
    expect(res.status).toBe(401);
  });

  it("searches instruments by asset class and name", async () => {
    const token = await signupAndLogin();
    await Instrument.create({
      assetClass: "EQUITY",
      symbol: "TESTCO",
      name: "Test Company Ltd",
      isActive: true,
      source: "SEED",
    });
    const res = await request(app)
      .get("/api/instruments/search?assetClass=EQUITY&q=Test")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.instruments.some((i: { name: string }) => i.name === "Test Company Ltd")).toBe(true);
  });
});
