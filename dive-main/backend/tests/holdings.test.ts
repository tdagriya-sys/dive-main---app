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

  // Mirrors the FD test above — PF (Provident Fund) is the other asset class
  // with its own principal/rate-shaped schema instead of instrument+value.
  it("creates a PF holding and computes its current value from opening balance + monthly contributions", async () => {
    const token = await signupAndLogin();
    const start = new Date();
    start.setMonth(start.getMonth() - 12); // a year ago, so growth is actually observable
    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetClass: "PF",
        subType: "EPF",
        institution: "EPFO (via Acme Corp)",
        openingBalance: 100000,
        monthlyContribution: 5000,
        startMonth: start.getMonth() + 1,
        startYear: start.getFullYear(),
        interestRatePercent: 8.25,
      });
    expect(res.status).toBe(201);
    expect(res.body.holding.assetClass).toBe("PF");
    expect(res.body.holding.extraFields.subType).toBe("EPF");
    // currentValue reflects a year of compounding + 12 months of
    // contributions; investedValue tracks only principal actually put in
    // (opening balance + contributions), so it must be LESS than
    // currentValue (the gap is real interest earned) but MORE than just the
    // opening balance alone (contributions aren't "returns").
    expect(res.body.holding.currentValue).toBeGreaterThan(res.body.holding.investedValue);
    expect(res.body.holding.investedValue).toBeGreaterThan(100000);
    expect(res.body.holding.investedValue).toBeCloseTo(100000 + 5000 * 12, -2);
    // No FD-style maturityValue/maturityDate — PF's "maturity" doesn't map
    // onto a single date (see computePfValues()'s own comment).
    expect(res.body.holding.extraFields.maturityValue).toBeUndefined();
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
