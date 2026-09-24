import { LookthroughConfig } from "../src/models/LookthroughConfig";
import { LOOKTHROUGH_CONFIG_DEFAULTS } from "../src/config/lookthroughDefaults";
import {
  getActiveLookthroughConfig,
  invalidateLookthroughConfigCache,
  getOrCreateDraftLookthroughConfig,
  updateDraftLookthroughConfig,
  validateLookthroughConfigPayload,
  publishLookthroughConfig,
  rollbackLookthroughConfig,
} from "../src/services/config/lookthroughConfigService";

// The Look-Through / Connectedness model — explicitly scoped OUT of Phase 2
// of docs/ADMIN_PANEL_PLAN.md ("a plausible future extension, not yet
// built"), built here as a fourth sibling to ScoringConfig/ContextConfig/
// SuggestionConfig. Mirrors contextConfigService.test.ts's structure.

describe("lookthroughConfigService — getActiveLookthroughConfig", () => {
  afterEach(() => invalidateLookthroughConfigCache());

  it("falls back to LOOKTHROUGH_CONFIG_DEFAULTS when nothing has ever been published", async () => {
    expect(await getActiveLookthroughConfig()).toEqual(LOOKTHROUGH_CONFIG_DEFAULTS);
  });
});

describe("lookthroughConfigService — validation", () => {
  it("accepts the real defaults as valid", () => {
    expect(validateLookthroughConfigPayload(LOOKTHROUGH_CONFIG_DEFAULTS)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a strength above 1", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, sameSectorStrength: 1.5 };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("sameSectorStrength"))).toBe(true);
  });

  it("rejects a negative strength", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, exactIssuerStrength: -0.1 };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("exactIssuerStrength"))).toBe(true);
  });

  it("rejects sectoralMfAffinityStrength >= sameSectorStrength (the deliberate ordering)", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, sectoralMfAffinityStrength: 0.3, sameSectorStrength: 0.3 };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("sectoralMfAffinityStrength must be smaller"))).toBe(true);
  });

  it("rejects sameSectorStrength >= exactIssuerStrength", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, sameSectorStrength: 1, exactIssuerStrength: 1 };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("sameSectorStrength must be smaller"))).toBe(true);
  });

  it("rejects a keywordSectorAffinity entry with no keywords", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, keywordSectorAffinity: [{ keywords: [], affinity: { GOLD: 0.1 } }] };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("at least one keyword"))).toBe(true);
  });

  it("rejects a mutualFundTopHoldings weightPct outside 0-100", () => {
    const bad = { ...LOOKTHROUGH_CONFIG_DEFAULTS, mutualFundTopHoldings: { somefund: [{ company: "Test Co", weightPct: 150 }] } };
    expect(validateLookthroughConfigPayload(bad).errors.some((e) => e.includes("weightPct"))).toBe(true);
  });
});

describe("lookthroughConfigService — publish / rollback", () => {
  it("publishes a valid draft and it becomes the active config", async () => {
    await getOrCreateDraftLookthroughConfig();
    await updateDraftLookthroughConfig({ sameSectorStrength: 0.25 });
    const result = await publishLookthroughConfig("lower same-sector strength", {});
    expect(result.errors).toBeUndefined();

    const active = await getActiveLookthroughConfig();
    expect(active.sameSectorStrength).toBe(0.25);
  });

  it("rejects publishing an invalid draft", async () => {
    await getOrCreateDraftLookthroughConfig();
    await updateDraftLookthroughConfig({ sameSectorStrength: 5 });
    const result = await publishLookthroughConfig("broken strength", {});
    expect(result.errors).toBeTruthy();
  });

  it("rollback restores an archived version as a new one", async () => {
    await getOrCreateDraftLookthroughConfig();
    await updateDraftLookthroughConfig({ sameSectorStrength: 0.2 });
    const v1 = await publishLookthroughConfig("v1", {});

    await getOrCreateDraftLookthroughConfig();
    await updateDraftLookthroughConfig({ sameSectorStrength: LOOKTHROUGH_CONFIG_DEFAULTS.sameSectorStrength });
    await publishLookthroughConfig("v2", {});

    const rollback = await rollbackLookthroughConfig(v1.version!.version, {});
    expect(rollback.errors).toBeUndefined();
    const active = await getActiveLookthroughConfig();
    expect(active.sameSectorStrength).toBe(0.2);
  });
});

// Sanity: the model itself must not silently drop fields via Mongoose Mixed
// casting weirdness (same class of bug found live in scoringConfigService's
// own tests before compositeWeights was switched off a real sub-schema).
describe("LookthroughConfig model round-trip", () => {
  it("persists and re-reads a full payload without losing fields", async () => {
    await LookthroughConfig.create({ version: 999, status: "draft", payload: LOOKTHROUGH_CONFIG_DEFAULTS });
    const doc = await LookthroughConfig.findOne({ version: 999 }).lean();
    expect(doc!.payload.keywordSectorAffinity).toHaveLength(LOOKTHROUGH_CONFIG_DEFAULTS.keywordSectorAffinity.length);
    expect(Object.keys(doc!.payload.mutualFundTopHoldings)).toHaveLength(Object.keys(LOOKTHROUGH_CONFIG_DEFAULTS.mutualFundTopHoldings).length);
    expect(doc!.payload.industryAssetClassAffinity).toEqual(LOOKTHROUGH_CONFIG_DEFAULTS.industryAssetClassAffinity);
  });
});
