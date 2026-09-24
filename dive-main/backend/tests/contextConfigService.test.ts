import { ContextConfig } from "../src/models/ContextConfig";
import { CONTEXT_CONFIG_DEFAULTS } from "../src/config/contextDefaults";
import {
  getActiveContextConfig,
  invalidateContextConfigCache,
  getOrCreateDraftContextConfig,
  updateDraftContextConfig,
  validateContextConfigPayload,
  publishContextConfig,
  rollbackContextConfig,
} from "../src/services/config/contextConfigService";

describe("contextConfigService — getActiveContextConfig", () => {
  afterEach(() => invalidateContextConfigCache());

  it("falls back to CONTEXT_CONFIG_DEFAULTS when nothing has ever been published", async () => {
    expect(await getActiveContextConfig()).toEqual(CONTEXT_CONFIG_DEFAULTS);
  });
});

describe("contextConfigService — validation", () => {
  it("accepts the real defaults as valid", () => {
    expect(validateContextConfigPayload(CONTEXT_CONFIG_DEFAULTS)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a gap between persona brackets", () => {
    const bad = {
      ...CONTEXT_CONFIG_DEFAULTS,
      personaBrackets: CONTEXT_CONFIG_DEFAULTS.personaBrackets.map((p, i) => (i === 0 ? { ...p, maxAge: 20 } : p)), // was 28 -> gap before buildingPhase's 29
    };
    expect(validateContextConfigPayload(bad).errors.some((e) => e.includes("contiguous"))).toBe(true);
  });

  it("rejects a defaultClassOrder missing an asset class", () => {
    const bad = { ...CONTEXT_CONFIG_DEFAULTS, defaultClassOrder: CONTEXT_CONFIG_DEFAULTS.defaultClassOrder.slice(1) };
    expect(validateContextConfigPayload(bad).errors.some((e) => e.includes("defaultClassOrder"))).toBe(true);
  });

  it("rejects the last persona bracket having a non-null maxAge", () => {
    const bad = {
      ...CONTEXT_CONFIG_DEFAULTS,
      personaBrackets: CONTEXT_CONFIG_DEFAULTS.personaBrackets.map((p, i, arr) => (i === arr.length - 1 ? { ...p, maxAge: 99 } : p)),
    };
    expect(validateContextConfigPayload(bad).errors.some((e) => e.includes("maxAge: null"))).toBe(true);
  });
});

describe("contextConfigService — publish / rollback", () => {
  it("publishes a valid draft and it becomes the active config", async () => {
    await getOrCreateDraftContextConfig();
    await updateDraftContextConfig({ defaultClassOrder: [...CONTEXT_CONFIG_DEFAULTS.defaultClassOrder].reverse() });
    const result = await publishContextConfig("reverse the default order", {});
    expect(result.errors).toBeUndefined();

    const active = await getActiveContextConfig();
    expect(active.defaultClassOrder[0]).toBe(CONTEXT_CONFIG_DEFAULTS.defaultClassOrder[CONTEXT_CONFIG_DEFAULTS.defaultClassOrder.length - 1]);
  });

  it("rejects publishing an invalid draft", async () => {
    await getOrCreateDraftContextConfig();
    await updateDraftContextConfig({ defaultClassOrder: CONTEXT_CONFIG_DEFAULTS.defaultClassOrder.slice(1) });
    const result = await publishContextConfig("broken order", {});
    expect(result.errors).toBeTruthy();
  });

  it("rollback restores an archived version as a new one", async () => {
    await getOrCreateDraftContextConfig();
    await updateDraftContextConfig({ defaultClassOrder: [...CONTEXT_CONFIG_DEFAULTS.defaultClassOrder].reverse() });
    const v1 = await publishContextConfig("v1", {});

    await getOrCreateDraftContextConfig();
    await updateDraftContextConfig({ defaultClassOrder: CONTEXT_CONFIG_DEFAULTS.defaultClassOrder });
    await publishContextConfig("v2", {});

    const rollback = await rollbackContextConfig(v1.version!.version, {});
    expect(rollback.errors).toBeUndefined();
    const active = await getActiveContextConfig();
    expect(active.defaultClassOrder[0]).toBe(CONTEXT_CONFIG_DEFAULTS.defaultClassOrder[CONTEXT_CONFIG_DEFAULTS.defaultClassOrder.length - 1]);
  });
});

// Sanity: the model itself must not silently drop fields via Mongoose Mixed
// casting weirdness (same class of bug found live in scoringConfigService's
// own tests before compositeWeights was switched off a real sub-schema).
describe("ContextConfig model round-trip", () => {
  it("persists and re-reads a full payload without losing fields", async () => {
    await ContextConfig.create({ version: 999, status: "draft", payload: CONTEXT_CONFIG_DEFAULTS });
    const doc = await ContextConfig.findOne({ version: 999 }).lean();
    expect(doc!.payload.personaBrackets).toHaveLength(CONTEXT_CONFIG_DEFAULTS.personaBrackets.length);
    expect(doc!.payload.corpusTiers).toHaveLength(CONTEXT_CONFIG_DEFAULTS.corpusTiers.length);
  });
});
