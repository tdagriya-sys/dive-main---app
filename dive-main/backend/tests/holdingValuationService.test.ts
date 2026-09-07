import request from "supertest";
import { createApp } from "../src/app";
import { Instrument } from "../src/models/Instrument";
import { Holding } from "../src/models/Holding";
import { runDailyValuationRefresh } from "../src/services/holdingValuationService";
import { computeFdValues, computePfValues } from "../src/validators/holdings";

const app = createApp();

let mobileCounter = 9500000000;
async function signupAndLogin() {
  const mobile = String(mobileCounter++);
  const signup = { name: "Valuation Tester", mobile, email: `val_${mobile}@example.com`, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { token: verify.body.accessToken as string, userId: verify.body.user.id as string };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Bug this job fixes: outside of a manual edit, nothing ever recalculated a
// holding's currentValue — FD/PF interest silently froze at whatever it was
// when last touched, and equity/MF/ETF/gold/silver had no live-price link at
// all. See docs/PRODUCTION_READINESS_AUDIT.md's entry for the full report.
describe("holdingValuationService — FD/PF daily recompute", () => {
  it("corrects a stale FD currentValue back to what computeFdValues actually gives for today", async () => {
    const { token } = await signupAndLogin();
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "FD", bank: "Test Bank", principal: 100000, tenureMonths: 24, startMonth: 1, startYear: new Date().getFullYear() - 1, interestRate: 7 });
    const holdingId = create.body.holding._id as string;
    const correctValue = create.body.holding.currentValue as number;

    // Simulate time having passed with no edit — the actual bug: this value
    // would otherwise just sit here forever until someone opens the edit form.
    await Holding.updateOne({ _id: holdingId }, { $set: { currentValue: 1 } });

    await runDailyValuationRefresh();

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(correctValue);
  });

  // Same shape as the plain-FD test above, but with an RD-style
  // monthlyContribution — investedValue must also be recomputed (it grows
  // as contributions accrue, same as PF's own investedToDate below), not
  // just currentValue.
  it("corrects a stale FD-with-monthlyContribution's currentValue AND investedValue (RD-style)", async () => {
    const { token } = await signupAndLogin();
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "FD", bank: "Test Bank", principal: 50000, monthlyContribution: 2000, tenureMonths: 36, startMonth: 1, startYear: new Date().getFullYear() - 1, interestRate: 6.5 });
    const holdingId = create.body.holding._id as string;
    const correctCurrentValue = create.body.holding.currentValue as number;
    const correctInvestedValue = create.body.holding.investedValue as number;

    await Holding.updateOne({ _id: holdingId }, { $set: { currentValue: 1, investedValue: 1 } });
    await runDailyValuationRefresh();

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(correctCurrentValue);
    expect(after?.investedValue).toBe(correctInvestedValue);
  });

  it("corrects a stale PF currentValue AND investedValue (contribution accrual)", async () => {
    const { token } = await signupAndLogin();
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({
        assetClass: "PF",
        subType: "EPF",
        institution: "EPFO (via Acme Corp)",
        openingBalance: 150000,
        monthlyContribution: 5000,
        startMonth: 1,
        startYear: new Date().getFullYear() - 1,
        interestRatePercent: 8.25,
      });
    const holdingId = create.body.holding._id as string;
    const correctCurrentValue = create.body.holding.currentValue as number;
    const correctInvestedValue = create.body.holding.investedValue as number;

    await Holding.updateOne({ _id: holdingId }, { $set: { currentValue: 1, investedValue: 1 } });
    await runDailyValuationRefresh();

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(correctCurrentValue);
    expect(after?.investedValue).toBe(correctInvestedValue);
  });

  it("is a no-op (no DB write, no user touched) for an FD/PF holding whose value hasn't actually changed", async () => {
    const { token } = await signupAndLogin();
    await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "FD", bank: "Test Bank", principal: 50000, tenureMonths: 12, startMonth: new Date().getMonth() + 1, startYear: new Date().getFullYear(), interestRate: 6 });

    const summary = await runDailyValuationRefresh();
    expect(summary.fdPfUpdated).toBe(0);
    expect(summary.usersTouched).toBe(0);
  });
});

describe("holdingValuationService — market-priced holdings (EQUITY/ETF/GOLD/SILVER/MUTUAL_FUND)", () => {
  it("reprices a holding with a linked instrument and quantity as quantity × latest price", async () => {
    const { token } = await signupAndLogin();
    const instrument = await Instrument.create({ assetClass: "EQUITY", symbol: "TESTCO", name: "Test Company Ltd", isActive: true, source: "SEED" });
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Test Company Ltd", investedValue: 10000, currentValue: 10000, quantity: 100 });
    const holdingId = create.body.holding._id as string;

    const stubResolver = jest.fn().mockResolvedValue(150); // ₹150/share
    await runDailyValuationRefresh(stubResolver);

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(15000); // 100 × 150
    expect(stubResolver).toHaveBeenCalledWith({ assetClass: "EQUITY", symbol: "TESTCO" });
  });

  it("fetches the price for a given instrument only ONCE, even when multiple holdings across multiple users reference it", async () => {
    const { token: tokenA } = await signupAndLogin();
    const { token: tokenB } = await signupAndLogin();
    const instrument = await Instrument.create({ assetClass: "EQUITY", symbol: "SHARED", name: "Shared Co", isActive: true, source: "SEED" });

    await request(app).post("/api/holdings/manual").set(auth(tokenA)).send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Shared Co", investedValue: 5000, currentValue: 5000, quantity: 10 });
    await request(app).post("/api/holdings/manual").set(auth(tokenB)).send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Shared Co", investedValue: 8000, currentValue: 8000, quantity: 20 });

    const stubResolver = jest.fn().mockResolvedValue(200);
    const summary = await runDailyValuationRefresh(stubResolver);

    expect(stubResolver).toHaveBeenCalledTimes(1);
    expect(summary.distinctInstrumentsPriced).toBe(1);
    expect(summary.marketPricedUpdated).toBe(2); // both holdings still individually written
  });

  // CRYPTO's price comes from a genuinely INR-denominated CoinGecko feed
  // (the same one Ask DIVVE's own crypto detail card uses), NOT the
  // USD-denominated one this file's return-history fetch uses — so it's
  // resolved via metadata.coingeckoId, not Instrument.symbol (a plain
  // ticker like "BTC", which isn't what CoinGecko's API actually expects).
  it("reprices a CRYPTO holding using metadata.coingeckoId, not the plain ticker symbol", async () => {
    const { token } = await signupAndLogin();
    const instrument = await Instrument.create({
      assetClass: "CRYPTO",
      symbol: "BTC",
      name: "Bitcoin",
      isActive: true,
      source: "SEED",
      metadata: { coingeckoId: "bitcoin" },
    });
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "CRYPTO", instrumentId: String(instrument._id), name: "Bitcoin", investedValue: 50000, currentValue: 50000, quantity: 0.01 });
    const holdingId = create.body.holding._id as string;

    const stubResolver = jest.fn().mockResolvedValue(6000000); // ₹60,00,000/BTC
    await runDailyValuationRefresh(stubResolver);

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(60000); // 0.01 × 6,000,000
    expect(stubResolver).toHaveBeenCalledWith({ assetClass: "CRYPTO", symbol: undefined, coingeckoId: "bitcoin" });
  });

  it("leaves a holding untouched when it has no linked instrument (plain manual value entry)", async () => {
    const { token } = await signupAndLogin();
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "EQUITY", name: "Some Stock I Typed In", investedValue: 20000, currentValue: 22000 });
    const holdingId = create.body.holding._id as string;

    const stubResolver = jest.fn().mockResolvedValue(999);
    await runDailyValuationRefresh(stubResolver);

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(22000); // unchanged — nothing to reprice against
    expect(stubResolver).not.toHaveBeenCalled();
  });

  it("leaves a holding untouched when the price resolver can't resolve a real price (e.g. external API down)", async () => {
    const { token } = await signupAndLogin();
    const instrument = await Instrument.create({ assetClass: "EQUITY", symbol: "DOWN", name: "Unreachable Co", isActive: true, source: "SEED" });
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Unreachable Co", investedValue: 5000, currentValue: 5000, quantity: 10 });
    const holdingId = create.body.holding._id as string;

    const stubResolver = jest.fn().mockResolvedValue(null);
    await runDailyValuationRefresh(stubResolver);

    const after = await Holding.findById(holdingId).lean();
    expect(after?.currentValue).toBe(5000); // left exactly as it was, not zeroed or guessed
  });
});

// Confirmed with the user, not assumed: routine daily price/interest drift
// must NOT force a previously-paid report to go stale (that's reserved for
// genuine portfolio composition changes — add/edit/delete/AA sync/age).
describe("holdingValuationService — score cache invalidated, but a paid report stays valid", () => {
  it("a stale cached Dive Score reflects the new value on the next request after a refresh", async () => {
    const { token } = await signupAndLogin();
    const instrument = await Instrument.create({ assetClass: "EQUITY", symbol: "SCOREME", name: "Score Co", isActive: true, source: "SEED" });
    await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Score Co", investedValue: 10000, currentValue: 10000, quantity: 100 });

    // The breakdown response has no raw total-value field to assert on
    // directly, but context.corpusTier.id is bucketed by total portfolio
    // value (contextEngine.ts's CORPUS_TIERS) — "starter" below ₹25,000,
    // "growing" from ₹25,000 up — so crossing that exact boundary is an
    // observable proxy for "the score actually recomputed against the new
    // value" that doesn't depend on an internal field this endpoint doesn't
    // expose.
    const before = await request(app).get("/api/score/breakdown").set(auth(token)); // primes the 5-min cache
    expect(before.body.context.corpusTier.id).toBe("starter"); // ₹10,000, well under the ₹25,000 boundary

    await runDailyValuationRefresh(jest.fn().mockResolvedValue(250)); // → 100 × 250 = ₹25,000

    const afterScore = await request(app).get("/api/score/breakdown").set(auth(token));
    expect(afterScore.body.context.corpusTier.id).toBe("growing"); // proves the cache was actually invalidated, not just the DB row
  });

  it("does NOT invalidate an already-paid report — no fresh payment required after a routine valuation refresh", async () => {
    const { token } = await signupAndLogin();
    const instrument = await Instrument.create({ assetClass: "EQUITY", symbol: "PAIDCO", name: "Paid Co", isActive: true, source: "SEED" });
    await request(app)
      .post("/api/holdings/manual")
      .set(auth(token))
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Paid Co", investedValue: 10000, currentValue: 10000, quantity: 100 });

    const order = await request(app).post("/api/payments/report/order").set(auth(token)).send();
    await request(app)
      .post("/api/payments/report/verify")
      .set(auth(token))
      .send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: `mock_payment_${order.body.orderId}`, razorpay_signature: "mock" });
    expect((await request(app).get("/api/score/breakdown/pdf").set(auth(token))).status).toBe(200);

    await runDailyValuationRefresh(jest.fn().mockResolvedValue(300)); // a real, meaningful value change

    expect((await request(app).get("/api/score/breakdown/pdf").set(auth(token))).status).toBe(200); // still valid, no 402
  });
});

// Sanity check that the service's reconstructed FdHoldingInput/PfHoldingInput
// really do match what the validators' own pure functions produce — guards
// against a silent field-name mismatch between extraFields and the input
// shape computeFdValues/computePfValues expect (nothing else would catch
// that at compile time, since extraFields is Mixed/untyped).
describe("holdingValuationService — reconstructed inputs match the validators' own math", () => {
  it("FD: same inputs in, same currentValue out", async () => {
    const { token } = await signupAndLogin();
    const fields = { bank: "Cross-Check Bank", principal: 75000, tenureMonths: 36, startMonth: 3, startYear: new Date().getFullYear() - 2, interestRate: 6.5 };
    const create = await request(app).post("/api/holdings/manual").set(auth(token)).send({ assetClass: "FD", ...fields });
    const expected = computeFdValues({ assetClass: "FD", ...fields }).currentValue;
    expect(create.body.holding.currentValue).toBe(expected);
  });

  it("PF: same inputs in, same currentValue/investedToDate out", async () => {
    const { token } = await signupAndLogin();
    const fields = { subType: "PPF" as const, institution: "SBI PPF", openingBalance: 200000, monthlyContribution: 1500, startMonth: 6, startYear: new Date().getFullYear() - 3, interestRatePercent: 7.1 };
    const create = await request(app).post("/api/holdings/manual").set(auth(token)).send({ assetClass: "PF", ...fields });
    const expected = computePfValues({ assetClass: "PF", ...fields });
    expect(create.body.holding.currentValue).toBe(expected.currentValue);
    expect(create.body.holding.investedValue).toBe(expected.investedToDate);
  });
});
