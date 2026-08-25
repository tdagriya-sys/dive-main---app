import request from "supertest";
import { createApp } from "../src/app";
import { Instrument } from "../src/models/Instrument";

const app = createApp();

async function signupAndLogin(mobile: string, email: string, age = 30) {
  const signup = { name: "Score Tester", mobile, email, age, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

async function addHolding(token: string, body: Record<string, unknown>) {
  const res = await request(app).post("/api/holdings/manual").set("Authorization", `Bearer ${token}`).send(body);
  expect(res.status).toBe(201);
  return res.body.holding;
}

describe("Dive Score v2 breakdown", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/score/breakdown");
    expect(res.status).toBe(401);
  });

  it("returns an empty breakdown with no holdings", async () => {
    const token = await signupAndLogin("9700000001", "score-empty@example.com");
    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasHoldings).toBe(false);
    expect(res.body.compositeScore).toBe(0);
  });

  it("scores a single concentrated holding as fully concentrated (0)", async () => {
    const token = await signupAndLogin("9700000002", "score-concentrated@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 110000 });
    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasHoldings).toBe(true);
    expect(res.body.subScores.concentration.score).toBe(0);
    // Single asset class -> apparent diversification is 0, and real must be
    // 0 too (it can never exceed apparent, no matter how the money within
    // that one class is spread).
    expect(res.body.apparentDiversificationPct).toBe(0);
    expect(res.body.realDiversificationPct).toBe(0);
    // Every holding falls back to a synthetic series in the test environment
    // (real network calls are gated off), so this should always be flagged.
    expect(res.body.dataQuality.holdings[0].isSynthetic).toBe(true);
    expect(res.body.dataQuality.realPriceCoveragePct).toBe(0);
  });

  it("real diversification can never exceed apparent diversification, even with many well-spread names in one asset class", async () => {
    const token = await signupAndLogin("9700000006", "score-real-le-apparent@example.com");
    const perHolding = Math.round(410000 / 9);
    for (let i = 0; i < 9; i++) {
      await addHolding(token, { assetClass: "EQUITY", name: `Equity Holding ${i}`, investedValue: perHolding, currentValue: perHolding });
    }
    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Single asset class, 9 different well-spread names: apparent is 0
    // (only one segment), and real must follow it down to 0 regardless of
    // how diversified the individual stock picks are.
    expect(res.body.apparentDiversificationPct).toBe(0);
    expect(res.body.realDiversificationPct).toBe(0);
    expect(res.body.realDiversificationPct).toBeLessThanOrEqual(res.body.apparentDiversificationPct);
    // Concentration score should be low (dominated by the 0% apparent term
    // at 0.5 weight), not the ~86-89 a pure per-instrument-name HHI would
    // give -- but it's no longer near-zero either, since the within-class
    // HHI term (0.15 weight) correctly credits these 9 holdings for being
    // evenly spread WITHIN equity, a genuinely different signal from
    // apparent (cross-class) spread. ~31 reflects apparent's dominance while
    // still crediting real within-class diversification.
    expect(res.body.subScores.concentration.score).toBeLessThan(40);
    expect(res.body.subScores.concentration.score).toBeGreaterThan(20);
  });

  it("real diversification drops below apparent when the same issuer is detected across different asset classes", async () => {
    const token = await signupAndLogin("9700000007", "score-issuer-overlap@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "HDFC Flexi Cap Fund", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // 4 asset classes, evenly split -> healthy apparent diversification.
    expect(res.body.apparentDiversificationPct).toBeGreaterThan(50);
    // But "Reliance Industries" shows up as both an EQUITY holding and a BOND
    // holding -> real diversification must be strictly lower than apparent.
    expect(res.body.realDiversificationPct).toBeLessThan(res.body.apparentDiversificationPct);
  });

  // User bug report: added "Reliance Industries" (EQUITY) and its corporate
  // bond and saw no overlap detected anywhere. Root cause: normalizeIssuer()'s
  // suffix-stripping regex had "corp"/"corporation" but not "corporate" as a
  // whole word — `\bcorp\b` doesn't match inside "corporate" — so this
  // instrument's own seeded name (backend/src/seed/staticInstruments.ts's
  // REL_BOND: "Reliance Industries Corporate Bonds") normalized to
  // "reliancecorporate" instead of "reliance", silently missing the exact
  // real-world case the "same issuer, different class" tier exists for.
  it("detects the same issuer even when the bond's real name includes the word 'Corporate' (user bug report)", async () => {
    const token = await signupAndLogin("9700000020", "score-corporate-bond-overlap@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "Reliance Industries Corporate Bonds", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.realDiversificationPct).toBeLessThan(res.body.apparentDiversificationPct);
    expect(res.body.connections.some((c: { reason: string }) => /same issuer/i.test(c.reason))).toBe(true);
  });

  it("scores a diversified multi-asset-class portfolio with a valid composite and correlation matrix", async () => {
    const token = await signupAndLogin("9700000003", "score-diversified@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 50000, currentValue: 52000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "HDFC Flexi Cap Fund", investedValue: 40000, currentValue: 43000 });
    await addHolding(token, { assetClass: "BOND", name: "REC Bond", investedValue: 30000, currentValue: 30500 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 20000, currentValue: 21000 });
    await addHolding(token, {
      assetClass: "FD",
      bank: "HDFC Bank",
      principal: 25000,
      tenureMonths: 12,
      startMonth: new Date().getMonth() + 1,
      startYear: new Date().getFullYear(),
      interestRate: 7,
    });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasHoldings).toBe(true);
    expect(res.body.compositeScore).toBeGreaterThanOrEqual(0);
    expect(res.body.compositeScore).toBeLessThanOrEqual(100);

    // 5 distinct asset classes -> a 5x5 correlation matrix
    expect(res.body.correlationMatrix.labels).toHaveLength(5);
    expect(res.body.correlationMatrix.matrix).toHaveLength(5);
    expect(res.body.correlationMatrix.matrix[0]).toHaveLength(5);
    // A class perfectly correlates with itself
    expect(res.body.correlationMatrix.matrix[0][0]).toBeCloseTo(1, 1);

    for (const key of ["concentration", "volatility", "drawdown", "var", "liquidity", "beta", "correlation", "diversificationRatio"]) {
      expect(res.body.subScores[key].score).toBeGreaterThanOrEqual(0);
      expect(res.body.subScores[key].score).toBeLessThanOrEqual(100);
    }

    const weightSum = (Object.values(res.body.weights) as number[]).reduce((a, b) => a + b, 0);
    expect(weightSum).toBeCloseTo(1, 5);
  });

  it("penalizes concentration/correlation for many holdings that are all the same asset class", async () => {
    const token = await signupAndLogin("9700000005", "score-single-class@example.com");
    const perHolding = Math.round(345000 / 7);
    for (let i = 0; i < 7; i++) {
      await addHolding(token, { assetClass: "EQUITY", name: `Equity Holding ${i}`, investedValue: perHolding, currentValue: perHolding });
    }
    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Spread across 7 distinct names alone would score ~86 on a pure
    // per-instrument HHI — the asset-class blend must pull this well below
    // that, since all 7 share the exact same single-market-event risk.
    expect(res.body.subScores.concentration.score).toBeLessThan(60);
    // Only one asset class present -> no real cross-asset-class diversification achieved.
    expect(res.body.subScores.correlation.score).toBeLessThanOrEqual(20);
    expect(res.body.correlationMatrix.labels).toEqual(["EQUITY"]);
  });

  it("is deterministic across repeated calls for the same holdings (seeded synthetic data, no randomness leaking in)", async () => {
    const token = await signupAndLogin("9700000004", "score-deterministic@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Infosys", investedValue: 60000, currentValue: 65000 });
    await addHolding(token, { assetClass: "REIT", name: "Embassy REIT", investedValue: 20000, currentValue: 21000 });

    const first = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    const second = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(first.body.compositeScore).toBe(second.body.compositeScore);
    expect(first.body.subScores).toEqual(second.body.subScores);
  });
});

describe("Dive Score v2 — layered look-through model", () => {
  it("drops real diversification meaningfully when a mutual fund's disclosed top holding matches a direct equity position", async () => {
    const token = await signupAndLogin("9700000008", "score-mf-lookthrough@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "HDFC Bank", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "HDFC Flexi Cap Fund", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.realDiversificationPct).toBeLessThan(res.body.apparentDiversificationPct);
    const conn = res.body.connections.find((c: { reason: string }) => c.reason.includes("HDFC Flexi Cap Fund"));
    expect(conn).toBeDefined();
    // HDFC Flexi Cap Fund's curated top-holding weight in HDFC Bank is ~8.9%,
    // not a full 100% overlap — this is a partial, weighted connection.
    expect(conn.strength).toBeGreaterThan(0);
    expect(conn.strength).toBeLessThan(0.2);
  });

  it("applies only a small effect for a curated cross-asset-class affinity (jewelry equity vs. gold), never a full overlap", async () => {
    const token = await signupAndLogin("9700000009", "score-jewelry-gold@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Titan Company", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "SBI Bluechip Fund", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.realDiversificationPct).toBeLessThan(res.body.apparentDiversificationPct);
    const conn = res.body.connections.find((c: { reason: string }) => c.reason.includes("Titan"));
    expect(conn).toBeDefined();
    // A jewelry retailer isn't the SAME bet as gold (it has retail/business
    // risk gold doesn't) — the effect must be small, well short of a full
    // issuer-match overlap.
    expect(conn.strength).toBeGreaterThan(0);
    expect(conn.strength).toBeLessThanOrEqual(0.25);
  });

  it("detects a broad NSE industry affinity (Realty-sector equity vs. a REIT holding) when sector data is available", async () => {
    const token = await signupAndLogin("9700000010", "score-realty-reit@example.com");
    const realtyInstrument = await Instrument.create({
      assetClass: "EQUITY",
      symbol: "TESTREALTY",
      name: "Test Realty Developers",
      isActive: true,
      source: "SEED",
      metadata: { sector: "Realty" },
    });
    await addHolding(token, {
      assetClass: "EQUITY",
      name: "Test Realty Developers",
      instrumentId: String(realtyInstrument._id),
      investedValue: 100000,
      currentValue: 100000,
    });
    await addHolding(token, { assetClass: "REIT", name: "Embassy REIT", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.realDiversificationPct).toBeLessThan(res.body.apparentDiversificationPct);
    const conn = res.body.connections.find((c: { reason: string }) => c.reason.includes("Realty sector"));
    expect(conn).toBeDefined();
  });

  it("finds no connection between genuinely unrelated holdings across classes", async () => {
    const token = await signupAndLogin("9700000011", "score-unrelated@example.com");
    await addHolding(token, { assetClass: "EQUITY", name: "Infosys", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "Some Unlisted Fund Nobody Curated", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });
    await addHolding(token, {
      assetClass: "FD",
      bank: "Axis Bank",
      principal: 100000,
      tenureMonths: 12,
      startMonth: new Date().getMonth() + 1,
      startYear: new Date().getFullYear(),
      interestRate: 7,
    });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(0);
    expect(res.body.realDiversificationPct).toBe(res.body.apparentDiversificationPct);
  });

  it("discounts the concentration sub-score (not apparent/real, which are cross-class only) for two same-sector companies in one asset class, proportional to that class's weight", async () => {
    const sameSectorToken = await signupAndLogin("9700000012", "score-same-sector@example.com");
    const bank1 = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTBANK1", name: "Test Bank One", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    const bank2 = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTBANK2", name: "Test Bank Two", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    await addHolding(sameSectorToken, { assetClass: "EQUITY", name: "Test Bank One", instrumentId: String(bank1._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(sameSectorToken, { assetClass: "EQUITY", name: "Test Bank Two", instrumentId: String(bank2._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(sameSectorToken, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 200000, currentValue: 200000 });
    const sameSectorRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${sameSectorToken}`);
    expect(sameSectorRes.status).toBe(200);

    // Control: identical structure and values, but the two equities are in
    // different sectors, so no same-class connection should fire.
    const diffSectorToken = await signupAndLogin("9700000014", "score-same-sector-control@example.com");
    const bank3 = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTBANK4", name: "Test Bank Four", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    const itCo = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTIT2", name: "Test IT Two", isActive: true, source: "SEED",
      metadata: { sector: "Information Technology" },
    });
    await addHolding(diffSectorToken, { assetClass: "EQUITY", name: "Test Bank Four", instrumentId: String(bank3._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(diffSectorToken, { assetClass: "EQUITY", name: "Test IT Two", instrumentId: String(itCo._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(diffSectorToken, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 200000, currentValue: 200000 });
    const diffSectorRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${diffSectorToken}`);
    expect(diffSectorRes.status).toBe(200);

    const conn = sameSectorRes.body.connections.find((c: { reason: string }) => c.reason.includes("Financial Services sector"));
    expect(conn).toBeDefined();
    // Same sector, different companies: meaningfully more than a tangential
    // cross-class affinity, but well short of an exact issuer match (1.0).
    expect(conn.strength).toBeGreaterThan(0.25);
    expect(conn.strength).toBeLessThan(1);
    // Same-class connections are a DIFFERENT signal from apparent/real, which
    // only reflect cross-class spread — both portfolios have the identical
    // 2-class value split, so apparent (and, since there's no cross-class
    // connection in either, real) must be identical.
    expect(sameSectorRes.body.apparentDiversificationPct).toBe(diffSectorRes.body.apparentDiversificationPct);
    expect(sameSectorRes.body.realDiversificationPct).toBe(sameSectorRes.body.apparentDiversificationPct);
    // But the same-sector portfolio's concentration score must be lower —
    // the per-name spread component is the only lever left to reflect
    // within-class sector concentration.
    expect(sameSectorRes.body.subScores.concentration.score).toBeLessThan(diffSectorRes.body.subScores.concentration.score);
  });

  it("does not flag two equities in different sectors as connected", async () => {
    const token = await signupAndLogin("9700000013", "score-diff-sector@example.com");
    const bank = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTBANK3", name: "Test Bank Three", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    const it = await Instrument.create({
      assetClass: "EQUITY", symbol: "TESTIT1", name: "Test IT One", isActive: true, source: "SEED",
      metadata: { sector: "Information Technology" },
    });
    await addHolding(token, { assetClass: "EQUITY", name: "Test Bank Three", instrumentId: String(bank._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "EQUITY", name: "Test IT One", instrumentId: String(it._id), investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(0);
    expect(res.body.realDiversificationPct).toBe(res.body.apparentDiversificationPct);
  });

  it("applies the same same-sector connection logic to mutual funds (not just equity)", async () => {
    const token = await signupAndLogin("9700000015", "score-mf-sector@example.com");
    const fund1 = await Instrument.create({
      assetClass: "MUTUAL_FUND", symbol: "TESTMFBANK1", name: "Test Banking Sector Fund", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    const fund2 = await Instrument.create({
      assetClass: "MUTUAL_FUND", symbol: "TESTMFBANK2", name: "Test Financial Services Fund", isActive: true, source: "SEED",
      metadata: { sector: "Financial Services" },
    });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "Test Banking Sector Fund", instrumentId: String(fund1._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "MUTUAL_FUND", name: "Test Financial Services Fund", instrumentId: String(fund2._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 200000, currentValue: 200000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const conn = res.body.connections.find((c: { reason: string }) => c.reason.includes("Financial Services sector"));
    expect(conn).toBeDefined();
    expect(conn.strength).toBeGreaterThan(0.25);
    expect(conn.strength).toBeLessThan(1);
  });

  it("applies the same same-sector connection logic to crypto (not just equity)", async () => {
    const token = await signupAndLogin("9700000016", "score-crypto-sector@example.com");
    const coin1 = await Instrument.create({
      assetClass: "CRYPTO", symbol: "TESTMEME1", name: "Test Meme Coin One", isActive: true, source: "SEED",
      metadata: { sector: "Meme" },
    });
    const coin2 = await Instrument.create({
      assetClass: "CRYPTO", symbol: "TESTMEME2", name: "Test Meme Coin Two", isActive: true, source: "SEED",
      metadata: { sector: "Meme" },
    });
    await addHolding(token, { assetClass: "CRYPTO", name: "Test Meme Coin One", instrumentId: String(coin1._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "CRYPTO", name: "Test Meme Coin Two", instrumentId: String(coin2._id), investedValue: 100000, currentValue: 100000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 200000, currentValue: 200000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const conn = res.body.connections.find((c: { reason: string }) => c.reason.includes("Meme sector"));
    expect(conn).toBeDefined();
    expect(conn.strength).toBeGreaterThan(0.25);
    expect(conn.strength).toBeLessThan(1);
  });
});

describe("Dive Score v2 — Layer D (Context Engine)", () => {
  it("does not penalize a young, small-corpus, single-equity-class portfolio — the classic '₹10,000 in 3 stocks' case", async () => {
    const token = await signupAndLogin("9700000017", "score-context-starter@example.com", 25);
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 5000, currentValue: 5000 });
    await addHolding(token, { assetClass: "EQUITY", name: "HDFC Bank", investedValue: 3000, currentValue: 3000 });
    await addHolding(token, { assetClass: "EQUITY", name: "Infosys", investedValue: 2000, currentValue: 2000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.context.corpusTier.id).toBe("starter");
    expect(res.body.context.persona.id).toBe("earlyCareer");
    // A Starter corpus only expects 1 asset class — already satisfied by
    // holding EQUITY alone, so this should read as fully "as expected", not
    // as a diversification shortfall.
    expect(res.body.context.expectedAssetClasses).toEqual(["EQUITY"]);
    expect(res.body.context.missingExpectedAssetClasses).toEqual([]);
    expect(res.body.subScores.contextFit.score).toBe(100);
    // The single-class correlation floor should be the softened neutral
    // value (50), not the harsh under-diversified value (20), since 1 class
    // is exactly what's expected here.
    expect(res.body.subScores.correlation.score).toBe(50);
  });

  it("still flags genuine under-diversification when the user's OWN expected set calls for more than they hold", async () => {
    const token = await signupAndLogin("9700000018", "score-context-established@example.com", 45);
    // Peak Earning + Established corpus (₹5,00,000) expects 5 classes; this
    // user holds only 1 (EQUITY) — a real gap relative to their own context,
    // not an artifact of demanding too much from a small/young situation.
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 500000, currentValue: 500000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.context.corpusTier.id).toBe("established");
    expect(res.body.context.persona.id).toBe("peakEarning");
    expect(res.body.context.expectedAssetClasses.length).toBe(5);
    expect(res.body.context.missingExpectedAssetClasses.length).toBe(4);
    expect(res.body.subScores.contextFit.score).toBe(20); // 1 of 5 expected classes held
    expect(res.body.subScores.correlation.score).toBe(20); // genuine gap -> harsh floor still applies
  });

  it("expands the expected set toward all 11 classes for a large corpus regardless of age", async () => {
    const token = await signupAndLogin("9700000019", "score-context-large@example.com", 24);
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 6000000, currentValue: 6000000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.context.corpusTier.id).toBe("large");
    expect(res.body.context.expectedAssetClasses.length).toBe(11);
  });

  it("gives full contextFit credit when expected classes are covered, even if the user also holds extra classes beyond what's expected", async () => {
    const token = await signupAndLogin("9700000020", "score-context-exceeds@example.com", 25);
    // Starter (expects 1: EQUITY) but this user already holds 2 classes —
    // exceeding expectations should never be penalized, just capped at 100.
    await addHolding(token, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 10000 });
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 8000, currentValue: 8000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subScores.contextFit.score).toBe(100);
  });
});

describe("Dive Score v2 — stock-count band and within-class HHI", () => {
  it("scores too few equity stocks low, the 15-30 band at 100, and tapers down (not to zero) well beyond it", async () => {
    const fewToken = await signupAndLogin("9700000021", "score-stockcount-few@example.com");
    await addHolding(fewToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    await addHolding(fewToken, { assetClass: "EQUITY", name: "HDFC Bank", investedValue: 100000, currentValue: 100000 });
    const fewRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${fewToken}`);
    expect(fewRes.status).toBe(200);
    expect(fewRes.body.subScores.stockCountFit.score).toBeLessThan(30);

    const idealToken = await signupAndLogin("9700000022", "score-stockcount-ideal@example.com");
    for (let i = 0; i < 20; i++) {
      await addHolding(idealToken, { assetClass: "EQUITY", name: `Equity Holding ${i}`, investedValue: 10000, currentValue: 10000 });
    }
    const idealRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${idealToken}`);
    expect(idealRes.status).toBe(200);
    expect(idealRes.body.subScores.stockCountFit.score).toBe(100);

    const manyToken = await signupAndLogin("9700000023", "score-stockcount-many@example.com");
    for (let i = 0; i < 60; i++) {
      await addHolding(manyToken, { assetClass: "EQUITY", name: `Equity Holding ${i}`, investedValue: 5000, currentValue: 5000 });
    }
    const manyRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${manyToken}`);
    expect(manyRes.status).toBe(200);
    // Tapers down for over-diversification (diminishing/negative marginal
    // benefit past ~30-40 per the literature), but never crashes to 0 -- too
    // many names is a different, milder failure mode than too few.
    expect(manyRes.body.subScores.stockCountFit.score).toBeLessThan(idealRes.body.subScores.stockCountFit.score);
    expect(manyRes.body.subScores.stockCountFit.score).toBeGreaterThan(30);
  }, 30000);

  it("treats stock-count fit as not-applicable (100) when the user holds no equity at all", async () => {
    const token = await signupAndLogin("9700000024", "score-stockcount-noequity@example.com");
    await addHolding(token, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });

    const res = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subScores.stockCountFit.score).toBe(100);
  });

  it("within-class HHI: a portfolio with one holding per class scores lower on concentration than the same classes with the equity sleeve internally spread", async () => {
    const concentratedToken = await signupAndLogin("9700000025", "score-withinclass-concentrated@example.com");
    await addHolding(concentratedToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    await addHolding(concentratedToken, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });
    await addHolding(concentratedToken, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });
    const concentratedRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${concentratedToken}`);
    expect(concentratedRes.status).toBe(200);

    const spreadToken = await signupAndLogin("9700000026", "score-withinclass-spread@example.com");
    await addHolding(spreadToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 50000, currentValue: 50000 });
    await addHolding(spreadToken, { assetClass: "EQUITY", name: "HDFC Bank", investedValue: 50000, currentValue: 50000 });
    await addHolding(spreadToken, { assetClass: "GOLD", name: "Sovereign Gold Bond", investedValue: 100000, currentValue: 100000 });
    await addHolding(spreadToken, { assetClass: "BOND", name: "REC Bond", investedValue: 100000, currentValue: 100000 });
    const spreadRes = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${spreadToken}`);
    expect(spreadRes.status).toBe(200);

    // Same 3 asset classes at the same overall class-level split (apparent
    // diversification is identical either way) -- but the spread portfolio's
    // equity sleeve is internally split across 2 names instead of 1, which
    // only the within-class HHI term can distinguish.
    expect(concentratedRes.body.apparentDiversificationPct).toBe(spreadRes.body.apparentDiversificationPct);
    expect(spreadRes.body.subScores.concentration.score).toBeGreaterThan(concentratedRes.body.subScores.concentration.score);
  });
});
