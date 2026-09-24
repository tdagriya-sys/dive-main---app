import request from "supertest";
import { createApp } from "../src/app";
import { SCORING_CONFIG_DEFAULTS } from "../src/config/scoringDefaults";
import { CONTEXT_CONFIG_DEFAULTS } from "../src/config/contextDefaults";
import { simulateScoringConfigChange, simulateContextConfigChange } from "../src/services/config/simulationService";

// Phase 2 of docs/ADMIN_PANEL_PLAN.md — the admin config simulation sandbox.
// Tests the SERVICE layer directly (mirrors scoringConfigService.test.ts's
// own layering) — route/permission wiring is covered separately.

const app = createApp();

async function signupAndLogin(mobile: string, email: string, age = 30) {
  const signup = { name: "Sim Tester", mobile, email, age, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

async function addHolding(token: string, body: Record<string, unknown>) {
  const res = await request(app).post("/api/holdings/manual").set("Authorization", `Bearer ${token}`).send(body);
  expect(res.status).toBe(201);
}

describe("simulateScoringConfigChange", () => {
  it("reports a zero-user sample when nobody has any holdings yet", async () => {
    const result = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS);
    expect(result.sampleSize).toBe(0);
    expect(result.avgDelta).toBe(0);
    expect(result.sampleDeltas).toEqual([]);
  });

  it("reports zero delta for every sampled user when the candidate config is identical to the active one", async () => {
    const { accessToken } = await signupAndLogin("9750000001", "sim-noop@example.com");
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });

    const result = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS);
    expect(result.sampleSize).toBe(1);
    expect(result.sampleDeltas).toEqual([0]);
    expect(result.improvedCount).toBe(0);
    expect(result.worsenedCount).toBe(0);
    expect(result.unchangedCount).toBe(1);
  });

  it("a lower liquidity tier for a fully-held asset class produces a negative delta", async () => {
    const { accessToken } = await signupAndLogin("9750000002", "sim-liquidity@example.com");
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });

    const candidate = { ...SCORING_CONFIG_DEFAULTS, liquidityTiers: { ...SCORING_CONFIG_DEFAULTS.liquidityTiers, EQUITY: 10 } };
    const result = await simulateScoringConfigChange(candidate);

    expect(result.sampleSize).toBe(1);
    expect(result.sampleDeltas[0]).toBeLessThan(0);
    expect(result.worsenedCount).toBe(1);
    expect(result.avgDelta).toBeLessThan(0);
  });

  it("clamps an out-of-range or missing sampleSize to a sane default/max", async () => {
    const { accessToken } = await signupAndLogin("9750000003", "sim-clamp@example.com");
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });

    const noSampleSize = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS);
    expect(noSampleSize.requestedSampleSize).toBe(20); // DEFAULT_SAMPLE_SIZE

    const hugeSampleSize = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS, 99999);
    expect(hugeSampleSize.requestedSampleSize).toBe(100); // MAX_SAMPLE_SIZE

    const invalidSampleSize = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS, -5);
    expect(invalidSampleSize.requestedSampleSize).toBe(20);
  });

  it("bounds the sample to at most the requested size, even with more eligible users", async () => {
    for (let i = 0; i < 3; i++) {
      const { accessToken } = await signupAndLogin(`975000010${i}`, `sim-bound-${i}@example.com`);
      await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });
    }
    const result = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS, 2);
    expect(result.sampleSize).toBe(2);
  });

  it("never includes a staff account in the sample", async () => {
    const { userId, accessToken } = await signupAndLogin("9750000004", "sim-staff@example.com");
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });

    const { User } = await import("../src/models/User");
    await User.findByIdAndUpdate(userId, { staffRole: "admin" });

    const result = await simulateScoringConfigChange(SCORING_CONFIG_DEFAULTS);
    expect(result.sampleSize).toBe(0);
  });
});

describe("simulateContextConfigChange", () => {
  it("a stricter expected-class-count for a matching corpus tier produces a negative delta", async () => {
    const { accessToken } = await signupAndLogin("9750000005", "sim-context@example.com", 25);
    // A small, single-EQUITY portfolio squarely in the "Starter" tier
    // (maxAmount 25000, expectedClassCount 1 by default) — fully satisfied
    // (contextFit 100) under the active default config.
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 10000 });

    const candidate = {
      ...CONTEXT_CONFIG_DEFAULTS,
      corpusTiers: CONTEXT_CONFIG_DEFAULTS.corpusTiers.map((t) => (t.id === "starter" ? { ...t, expectedClassCount: 3 } : t)),
    };
    const result = await simulateContextConfigChange(candidate);

    expect(result.sampleSize).toBe(1);
    expect(result.sampleDeltas[0]).toBeLessThan(0);
  });

  it("reports zero delta when the candidate context config is identical to the active one", async () => {
    const { accessToken } = await signupAndLogin("9750000006", "sim-context-noop@example.com");
    await addHolding(accessToken, { assetClass: "EQUITY", name: "Reliance Industries", investedValue: 100000, currentValue: 100000 });

    const result = await simulateContextConfigChange(CONTEXT_CONFIG_DEFAULTS);
    expect(result.sampleDeltas).toEqual([0]);
  });
});
