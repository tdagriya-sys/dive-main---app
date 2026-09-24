import { ScoringConfig } from "../src/models/ScoringConfig";
import { SCORING_CONFIG_DEFAULTS } from "../src/config/scoringDefaults";
import {
  getActiveScoringConfig,
  invalidateScoringConfigCache,
  getOrCreateDraftScoringConfig,
  updateDraftScoringConfig,
  validateScoringConfigPayload,
  publishScoringConfig,
  rollbackScoringConfig,
  getScoringConfigHistory,
} from "../src/services/config/scoringConfigService";

// Phase 2 of docs/ADMIN_PANEL_PLAN.md — the config-driven Dive Score model's
// lifecycle, in isolation from the actual scoring math (already covered
// end-to-end by diveScore.test.ts, which now runs through this exact same
// getActiveScoringConfig() path via diveScoreService.ts).

describe("scoringConfigService — getActiveScoringConfig", () => {
  afterEach(() => invalidateScoringConfigCache());

  it("falls back to SCORING_CONFIG_DEFAULTS when nothing has ever been published", async () => {
    const cfg = await getActiveScoringConfig();
    expect(cfg).toEqual(SCORING_CONFIG_DEFAULTS);
  });

  it("caches the active config across repeated calls (proven by a DB spy)", async () => {
    const spy = jest.spyOn(ScoringConfig, "findOne");
    await getActiveScoringConfig();
    await getActiveScoringConfig();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("scoringConfigService — draft lifecycle", () => {
  it("creates a draft seeded from the defaults when nothing is active yet", async () => {
    const draft = await getOrCreateDraftScoringConfig();
    expect(draft.status).toBe("draft");
    expect(draft.payload.compositeWeights).toEqual(SCORING_CONFIG_DEFAULTS.compositeWeights);
  });

  it("returns the SAME draft on a second call rather than creating a new one", async () => {
    const first = await getOrCreateDraftScoringConfig();
    const second = await getOrCreateDraftScoringConfig();
    expect(String(second._id)).toBe(String(first._id));
  });

  it("updateDraftScoringConfig merges a partial payload into the existing draft", async () => {
    await getOrCreateDraftScoringConfig();
    const updated = await updateDraftScoringConfig({ cryptoWithinClassCap: 55 });
    expect(updated.payload.cryptoWithinClassCap).toBe(55);
    // Everything else untouched.
    expect(updated.payload.compositeWeights).toEqual(SCORING_CONFIG_DEFAULTS.compositeWeights);
  });
});

describe("scoringConfigService — validation", () => {
  it("accepts the real defaults as valid", () => {
    expect(validateScoringConfigPayload(SCORING_CONFIG_DEFAULTS)).toEqual({ valid: true, errors: [] });
  });

  it("rejects composite weights that don't sum to 1", () => {
    const bad = { ...SCORING_CONFIG_DEFAULTS, compositeWeights: { ...SCORING_CONFIG_DEFAULTS.compositeWeights, concentration: 0.5 } };
    const result = validateScoringConfigPayload(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("compositeWeights must sum to 1.0"))).toBe(true);
  });

  it("rejects a liquidity tier outside 0-100", () => {
    const bad = { ...SCORING_CONFIG_DEFAULTS, liquidityTiers: { ...SCORING_CONFIG_DEFAULTS.liquidityTiers, FD: 150 } };
    expect(validateScoringConfigPayload(bad).errors.some((e) => e.includes("liquidityTiers.FD"))).toBe(true);
  });

  it("rejects non-monotonic stockCountBreakpoints", () => {
    const bad = { ...SCORING_CONFIG_DEFAULTS, stockCountBreakpoints: [[1, 10], [1, 20]] as Array<[number, number]> };
    expect(validateScoringConfigPayload(bad).errors.some((e) => e.includes("strictly increasing"))).toBe(true);
  });

  it("rejects a worstAt/bestAt pair that's equal", () => {
    const bad = { ...SCORING_CONFIG_DEFAULTS, subScoreBestAt: { ...SCORING_CONFIG_DEFAULTS.subScoreBestAt, betaWorstAt: 0.2, betaBestAt: 0.2 } };
    expect(validateScoringConfigPayload(bad).errors.some((e) => e.includes("beta: worstAt and bestAt cannot be equal"))).toBe(true);
  });
});

describe("scoringConfigService — publish / rollback", () => {
  it("rejects publishing when there's no draft", async () => {
    const result = await publishScoringConfig("no draft exists", {});
    expect(result.errors).toEqual(["No draft to publish."]);
  });

  it("rejects publishing an invalid draft, leaving the previous active config untouched", async () => {
    await getOrCreateDraftScoringConfig();
    await updateDraftScoringConfig({ compositeWeights: { ...SCORING_CONFIG_DEFAULTS.compositeWeights, concentration: 0.9 } });
    const result = await publishScoringConfig("bad weights", {});
    expect(result.errors).toBeTruthy();
    expect(result.version).toBeUndefined();
  });

  it("publishes a valid draft: it becomes active, the previous active is archived, and getActiveScoringConfig reflects it immediately", async () => {
    await getOrCreateDraftScoringConfig();
    const updated = await updateDraftScoringConfig({ cryptoWithinClassCap: 42 });
    const result = await publishScoringConfig("lower the crypto cap", { actorRole: "superadmin", actorLabel: "boss@divve.in" });
    expect(result.errors).toBeUndefined();
    expect(result.version!.status).toBe("active");

    const active = await getActiveScoringConfig();
    expect(active.cryptoWithinClassCap).toBe(42);

    const historyEntry = await ScoringConfig.findById(updated._id).lean();
    expect(historyEntry!.status).toBe("active");
    expect(historyEntry!.changeNote).toBe("lower the crypto cap");
  });

  it("a second publish archives the first version", async () => {
    await getOrCreateDraftScoringConfig();
    await updateDraftScoringConfig({ cryptoWithinClassCap: 10 });
    const first = await publishScoringConfig("first change", {});

    await getOrCreateDraftScoringConfig();
    await updateDraftScoringConfig({ cryptoWithinClassCap: 20 });
    const second = await publishScoringConfig("second change", {});

    const firstDoc = await ScoringConfig.findById(first.version!._id).lean();
    expect(firstDoc!.status).toBe("archived");
    expect(second.version!.status).toBe("active");

    const active = await getActiveScoringConfig();
    expect(active.cryptoWithinClassCap).toBe(20);
  });

  it("rollback re-publishes an archived version's payload as a NEW version (never reactivates the old doc)", async () => {
    await getOrCreateDraftScoringConfig();
    await updateDraftScoringConfig({ cryptoWithinClassCap: 33 });
    const v1 = await publishScoringConfig("v1", {});

    await getOrCreateDraftScoringConfig();
    await updateDraftScoringConfig({ cryptoWithinClassCap: 66 });
    await publishScoringConfig("v2", {});

    const rollback = await rollbackScoringConfig(v1.version!.version, { actorRole: "superadmin" });
    expect(rollback.errors).toBeUndefined();
    expect(rollback.version!.version).toBeGreaterThan(v1.version!.version + 1); // a brand-new version number, not v1's own
    expect(rollback.version!.payload.cryptoWithinClassCap).toBe(33);
    expect(rollback.version!.changeNote).toMatch(/Rolled back/);

    const active = await getActiveScoringConfig();
    expect(active.cryptoWithinClassCap).toBe(33);
  });

  it("history lists every version newest-first", async () => {
    await getOrCreateDraftScoringConfig();
    await publishScoringConfig("only change", {});
    const history = await getScoringConfigHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].version).toBeGreaterThanOrEqual(history[history.length - 1].version);
  });
});
