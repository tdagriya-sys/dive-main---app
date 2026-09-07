import request from "supertest";
import { createApp } from "../src/app";
import { Instrument } from "../src/models/Instrument";
import { Holding } from "../src/models/Holding";
import { resolveHoldingLatestPrice } from "../src/services/priceHistoryService";

// resolveHoldingLatestPrice always returns null in the test env (a
// deliberate, unconditional gate on real network calls — see its own
// comment in priceHistoryService.ts), so the only way to exercise
// holdingsController.ts's quantity-auto-derivation logic here is to mock
// the whole module and control the price it "resolves" directly, same as
// this codebase already mocks axios itself in instrumentSources.test.ts for
// an analogous reason.
jest.mock("../src/services/priceHistoryService", () => ({
  ...jest.requireActual("../src/services/priceHistoryService"),
  resolveHoldingLatestPrice: jest.fn(),
}));
const mockedResolvePrice = resolveHoldingLatestPrice as jest.Mock;

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
  beforeEach(() => {
    // Full reset (not just mockClear) — clears both call history AND any
    // queued mockResolvedValueOnce from a previous test that never actually
    // got consumed there (e.g. a test where the controller correctly never
    // calls this mock at all), which would otherwise silently leak into
    // whichever later test's call actually does consume it.
    mockedResolvePrice.mockReset();
    // Default: unresolvable, matching this module's real behavior in the
    // test env before any test here explicitly opts into a mocked price —
    // every existing test in this file keeps seeing exactly the same
    // "no live price available" outcome it always has.
    mockedResolvePrice.mockResolvedValue(null);
  });

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

  it("still works exactly as before when monthlyContribution is omitted from an FD (pure lump sum, no RD)", async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "FD", bank: "HDFC Bank", principal: 100000, tenureMonths: 12, startMonth: new Date().getMonth() + 1, startYear: new Date().getFullYear(), interestRate: 7 });
    expect(res.status).toBe(201);
    expect(res.body.holding.investedValue).toBe(100000); // unchanged — investedToDate === principal with no contributions
    expect(res.body.holding.extraFields.monthlyContribution).toBe(0);
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

// A holding linked to a real instrument but with no quantity would
// otherwise never be eligible for holdingValuationService.ts's daily
// currentValue refresh (that job can only reprice quantity × price) — it
// would stay frozen at whatever was typed on day one, exactly the bug that
// job was built to fix, just for a different reason (no quantity to work
// with rather than no live-price mechanism at all). Back-solving
// quantity = value ÷ today's price at creation time closes that gap.
describe("holdings — quantity auto-derived from value ÷ instrument price when left blank", () => {
  beforeEach(() => {
    // This is a separate top-level describe from "holdings" above — its own
    // beforeEach reset doesn't reach here, so this block needs its own,
    // same full-reset reasoning (see that one's comment).
    mockedResolvePrice.mockReset();
    mockedResolvePrice.mockResolvedValue(null);
  });

  async function createInstrument(overrides: Partial<{ assetClass: string; symbol: string; name: string; metadata: Record<string, unknown> }> = {}) {
    return Instrument.create({ assetClass: "EQUITY", symbol: "TESTCO", name: "Test Company Ltd", isActive: true, source: "SEED", ...overrides });
  }

  // Case 1 from the user's own question: only investedValue filled,
  // currentValue and quantity both left blank — currentValue already
  // defaults to investedValue (existing behavior), so quantity is derived
  // from that same defaulted value.
  it("case 1 — investedValue only: quantity = investedValue ÷ price", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument();
    mockedResolvePrice.mockResolvedValueOnce(500); // ₹500/share

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Test Company Ltd", investedValue: 10000 });

    expect(res.status).toBe(201);
    expect(res.body.holding.currentValue).toBe(10000); // unchanged existing default behavior
    expect(res.body.holding.quantity).toBe(20); // 10000 ÷ 500
    expect(mockedResolvePrice).toHaveBeenCalledWith({ assetClass: "EQUITY", symbol: "TESTCO", coingeckoId: undefined });
  });

  // Case 2: both investedValue and currentValue filled, quantity blank —
  // quantity is derived from currentValue (the actual present-day value the
  // user is asserting), not investedValue.
  it("case 2 — investedValue AND currentValue filled: quantity = currentValue ÷ price", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument();
    mockedResolvePrice.mockResolvedValueOnce(600); // ₹600/share

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Test Company Ltd", investedValue: 10000, currentValue: 12000 });

    expect(res.status).toBe(201);
    expect(res.body.holding.currentValue).toBe(12000);
    expect(res.body.holding.quantity).toBe(20); // 12000 ÷ 600, not 10000 ÷ 600
  });

  it("does not override an explicitly-provided quantity", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument();
    mockedResolvePrice.mockResolvedValueOnce(999); // must never be used to compute anything here

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Test Company Ltd", investedValue: 10000, quantity: 7 });

    expect(res.status).toBe(201);
    expect(res.body.holding.quantity).toBe(7);
    expect(mockedResolvePrice).not.toHaveBeenCalled();
  });

  it("leaves quantity unset when there's no linked instrument at all (plain manual value entry)", async () => {
    const token = await signupAndLogin();
    mockedResolvePrice.mockResolvedValueOnce(500); // must never be reachable — nothing to look up a price for

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", name: "Some Stock I Typed In", investedValue: 10000 });

    expect(res.status).toBe(201);
    expect(res.body.holding.quantity).toBeUndefined();
    expect(mockedResolvePrice).not.toHaveBeenCalled();
  });

  it("leaves quantity unset (not zero, not an error) when the price can't be resolved right now", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument();
    mockedResolvePrice.mockResolvedValueOnce(null); // e.g. external API down

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", instrumentId: String(instrument._id), name: "Test Company Ltd", investedValue: 10000 });

    expect(res.status).toBe(201); // creating the holding itself must never fail just because a live price lookup did
    expect(res.body.holding.quantity).toBeUndefined();
  });

  it("does not attempt a price lookup for an asset class with no live-price source (e.g. BOND)", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument({ assetClass: "BOND", symbol: "BONDCO", name: "Bond Co" });
    mockedResolvePrice.mockResolvedValueOnce(1000); // must never be reachable for BOND

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "BOND", instrumentId: String(instrument._id), name: "Bond Co", investedValue: 10000 });

    expect(res.status).toBe(201);
    expect(res.body.holding.quantity).toBeUndefined();
    expect(mockedResolvePrice).not.toHaveBeenCalled();
  });

  // CRYPTO resolves via metadata.coingeckoId, not Instrument.symbol (a plain
  // ticker like "BTC" isn't what CoinGecko's API expects) — same split
  // holdingValuationService.ts's own market-priced pass uses.
  it("resolves CRYPTO via metadata.coingeckoId, not the plain ticker symbol", async () => {
    const token = await signupAndLogin();
    const instrument = await createInstrument({ assetClass: "CRYPTO", symbol: "BTC", name: "Bitcoin", metadata: { coingeckoId: "bitcoin" } });
    mockedResolvePrice.mockResolvedValueOnce(6000000); // ₹60,00,000/BTC

    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "CRYPTO", instrumentId: String(instrument._id), name: "Bitcoin", investedValue: 60000 });

    expect(res.status).toBe(201);
    expect(res.body.holding.quantity).toBeCloseTo(0.01);
    expect(mockedResolvePrice).toHaveBeenCalledWith({ assetClass: "CRYPTO", symbol: "BTC", coingeckoId: "bitcoin" });
  });
});

// User request: an optional monthlyContribution on FD, same shape as PF's,
// so an RD (a lump sum isn't required — a pure recurring deposit with no
// upfront amount is a real case too) or an FD topped up with periodic
// deposits both get properly modeled instead of FD's original
// single-lump-sum-only formula.
describe("holdings — FD/RD optional monthly contribution", () => {
  it("creates an RD-style FD with monthlyContribution, growing both currentValue and investedValue as contributions accrue", async () => {
    const token = await signupAndLogin();
    const start = new Date();
    start.setMonth(start.getMonth() - 12); // a year ago, so growth is actually observable
    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetClass: "FD",
        bank: "SBI",
        principal: 50000,
        monthlyContribution: 2000,
        tenureMonths: 60,
        startMonth: start.getMonth() + 1,
        startYear: start.getFullYear(),
        interestRate: 6.5,
      });
    expect(res.status).toBe(201);
    // investedValue tracks principal + contributions actually put in, no
    // interest — must be MORE than the bare principal (a year of ₹2,000/mo
    // deposits is real money in) but LESS than currentValue (the gap is
    // real interest earned) — same shape as the PF contribution test above.
    expect(res.body.holding.investedValue).toBeGreaterThan(50000);
    expect(res.body.holding.investedValue).toBeCloseTo(50000 + 2000 * 12, -2);
    expect(res.body.holding.currentValue).toBeGreaterThan(res.body.holding.investedValue);
    expect(res.body.holding.extraFields.monthlyContribution).toBe(2000);
    expect(res.body.holding.extraFields.principal).toBe(50000); // the pure lump sum, kept separate from investedValue
  });

  it("supports a pure RD with no lump sum at all (principal: 0)", async () => {
    const token = await signupAndLogin();
    const res = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "FD", bank: "ICICI Bank", principal: 0, monthlyContribution: 3000, tenureMonths: 24, startMonth: new Date().getMonth() + 1, startYear: new Date().getFullYear(), interestRate: 6 });
    expect(res.status).toBe(201);
    expect(res.body.holding.investedValue).toBeGreaterThanOrEqual(0);
    expect(res.body.holding.extraFields.principal).toBe(0);
  });

  it("editing an old-style FD (created before this field existed, no extraFields.principal) to add a monthlyContribution doesn't double-count the principal", async () => {
    const token = await signupAndLogin();
    const auth = { Authorization: `Bearer ${token}` };
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth)
      .send({ assetClass: "FD", bank: "Axis Bank", principal: 80000, tenureMonths: 24, startMonth: new Date().getMonth() + 1, startYear: new Date().getFullYear(), interestRate: 7 });
    const holdingId = create.body.holding._id as string;

    // Simulate a pre-existing holding from before extraFields.principal was
    // introduced — investedValue still equals the true principal (as it
    // always did before this feature), but extraFields has no `principal`
    // key at all, only what createManualHolding's OLD shape would have set.
    await Holding.updateOne({ _id: holdingId }, { $unset: { "extraFields.principal": "" } });

    const edit = await request(app).patch(`/api/holdings/${holdingId}`).set(auth).send({ monthlyContribution: 1500 });
    expect(edit.status).toBe(200);
    // Must fall back to holding.investedValue (80000) as the real principal,
    // NOT silently treat some other stale value as it — investedValue right
    // after this edit should be very close to 80000 (zero elapsed months
    // since creation moments ago), not inflated by any double-counting.
    expect(edit.body.holding.investedValue).toBeCloseTo(80000, -1);
    expect(edit.body.holding.extraFields.principal).toBe(80000);
    expect(edit.body.holding.extraFields.monthlyContribution).toBe(1500);
  });

  it("clearing monthlyContribution back out on an edit stops further contribution growth (reverts to a plain FD)", async () => {
    const token = await signupAndLogin();
    const auth = { Authorization: `Bearer ${token}` };
    const create = await request(app)
      .post("/api/holdings/manual")
      .set(auth)
      .send({ assetClass: "FD", bank: "Kotak Bank", principal: 60000, monthlyContribution: 1000, tenureMonths: 24, startMonth: new Date().getMonth() + 1, startYear: new Date().getFullYear(), interestRate: 7 });
    const holdingId = create.body.holding._id as string;

    const edit = await request(app).patch(`/api/holdings/${holdingId}`).set(auth).send({ monthlyContribution: 0 });
    expect(edit.status).toBe(200);
    expect(edit.body.holding.extraFields.monthlyContribution).toBe(0);
    expect(edit.body.holding.investedValue).toBe(60000); // back to exactly the principal, no more contribution growth
  });
});
