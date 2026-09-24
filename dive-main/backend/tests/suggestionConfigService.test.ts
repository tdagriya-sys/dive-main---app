import { SuggestionConfig } from "../src/models/SuggestionConfig";
import { SUGGESTION_CONFIG_DEFAULTS } from "../src/config/suggestionDefaults";
import {
  getActiveSuggestionConfig,
  invalidateSuggestionConfigCache,
  getOrCreateDraftSuggestionConfig,
  updateDraftSuggestionConfig,
  validateSuggestionConfigPayload,
  publishSuggestionConfig,
  rollbackSuggestionConfig,
} from "../src/services/config/suggestionConfigService";

describe("suggestionConfigService — getActiveSuggestionConfig", () => {
  afterEach(() => invalidateSuggestionConfigCache());

  it("falls back to SUGGESTION_CONFIG_DEFAULTS when nothing has ever been published", async () => {
    expect(await getActiveSuggestionConfig()).toEqual(SUGGESTION_CONFIG_DEFAULTS);
  });
});

describe("suggestionConfigService — validation", () => {
  it("accepts the real defaults as valid", () => {
    expect(validateSuggestionConfigPayload(SUGGESTION_CONFIG_DEFAULTS)).toEqual({ valid: true, errors: [] });
  });

  it("rejects an idealRanges entry missing a core category", () => {
    const bad = {
      ...SUGGESTION_CONFIG_DEFAULTS,
      idealRanges: {
        ...SUGGESTION_CONFIG_DEFAULTS.idealRanges,
        Balanced: { ...SUGGESTION_CONFIG_DEFAULTS.idealRanges.Balanced, Equity: undefined as any },
      },
    };
    expect(validateSuggestionConfigPayload(bad).errors.some((e) => e.includes('idealRanges.Balanced is missing "Equity"'))).toBe(true);
  });

  it("rejects a range whose low exceeds its high", () => {
    const bad = {
      ...SUGGESTION_CONFIG_DEFAULTS,
      idealRanges: {
        ...SUGGESTION_CONFIG_DEFAULTS.idealRanges,
        Conservative: { ...SUGGESTION_CONFIG_DEFAULTS.idealRanges.Conservative, Equity: [30, 20] as [number, number] },
      },
    };
    expect(validateSuggestionConfigPayload(bad).errors.some((e) => e.includes("low (30) cannot exceed high (20)"))).toBe(true);
  });

  it("rejects diversificationCap.Low exceeding diversificationCap.Medium", () => {
    const bad = { ...SUGGESTION_CONFIG_DEFAULTS, diversificationCap: { ...SUGGESTION_CONFIG_DEFAULTS.diversificationCap, Low: 5 } };
    expect(validateSuggestionConfigPayload(bad).errors.some((e) => e.includes("diversificationCap.Low cannot exceed"))).toBe(true);
  });

  it("accepts diversificationCap.High of null (uncapped) without complaint", () => {
    expect(SUGGESTION_CONFIG_DEFAULTS.diversificationCap.High).toBeNull();
    expect(validateSuggestionConfigPayload(SUGGESTION_CONFIG_DEFAULTS).valid).toBe(true);
  });

  it("rejects a fastPathBlend that doesn't sum to 1", () => {
    const bad = { ...SUGGESTION_CONFIG_DEFAULTS, fastPathBlend: { apparent: 0.5, real: 0.3, name: 0.3 } };
    expect(validateSuggestionConfigPayload(bad).errors.some((e) => e.includes("fastPathBlend must sum to 1.0"))).toBe(true);
  });
});

describe("suggestionConfigService — publish / rollback", () => {
  it("publishes a valid draft and it becomes the active config", async () => {
    await getOrCreateDraftSuggestionConfig();
    const updated = await updateDraftSuggestionConfig({ diversificationCap: { Low: 1, Medium: 3, High: null } });
    const result = await publishSuggestionConfig("tighten low-risk diversification cap", {});
    expect(result.errors).toBeUndefined();
    expect(result.version!.status).toBe("active");

    const active = await getActiveSuggestionConfig();
    expect(active.diversificationCap.Low).toBe(1);

    const historyEntry = await SuggestionConfig.findById(updated._id).lean();
    expect(historyEntry!.status).toBe("active");
  });

  it("rejects publishing an invalid draft, leaving the previous active config untouched", async () => {
    await getOrCreateDraftSuggestionConfig();
    await updateDraftSuggestionConfig({ fastPathBlend: { apparent: 0.9, real: 0.5, name: 0.5 } });
    const result = await publishSuggestionConfig("broken blend", {});
    expect(result.errors).toBeTruthy();
    expect(result.version).toBeUndefined();
  });

  it("a second publish archives the first version", async () => {
    await getOrCreateDraftSuggestionConfig();
    await updateDraftSuggestionConfig({ diversificationCap: { Low: 1, Medium: 3, High: null } });
    const first = await publishSuggestionConfig("first change", {});

    await getOrCreateDraftSuggestionConfig();
    await updateDraftSuggestionConfig({ diversificationCap: { Low: 2, Medium: 4, High: null } });
    const second = await publishSuggestionConfig("second change", {});

    const firstDoc = await SuggestionConfig.findById(first.version!._id).lean();
    expect(firstDoc!.status).toBe("archived");
    expect(second.version!.status).toBe("active");
  });

  it("rollback re-publishes an archived version's payload as a NEW version", async () => {
    await getOrCreateDraftSuggestionConfig();
    await updateDraftSuggestionConfig({ diversificationCap: { Low: 1, Medium: 3, High: null } });
    const v1 = await publishSuggestionConfig("v1", {});

    await getOrCreateDraftSuggestionConfig();
    await updateDraftSuggestionConfig({ diversificationCap: { Low: 2, Medium: 4, High: null } });
    await publishSuggestionConfig("v2", {});

    const rollback = await rollbackSuggestionConfig(v1.version!.version, {});
    expect(rollback.errors).toBeUndefined();
    expect(rollback.version!.version).toBeGreaterThan(v1.version!.version + 1);
    expect(rollback.version!.payload.diversificationCap.Low).toBe(1);

    const active = await getActiveSuggestionConfig();
    expect(active.diversificationCap.Low).toBe(1);
  });
});
