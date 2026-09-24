import { FeatureFlag } from "../src/models/FeatureFlag";
import * as featureFlagService from "../src/services/featureFlagService";

// Phase 7 of docs/ADMIN_PANEL_PLAN.md §11 — gradual-rollout resolution.

describe("isFeatureEnabled", () => {
  it("is false for an unknown key", async () => {
    expect(await featureFlagService.isFeatureEnabled("nope", { userId: "u1" })).toBe(false);
  });

  it("is false when the flag exists but is disabled, regardless of rolloutPct", async () => {
    await FeatureFlag.create({ key: "off_flag", enabled: false, rolloutPct: 100 });
    expect(await featureFlagService.isFeatureEnabled("off_flag", { userId: "u1" })).toBe(false);
  });

  it("is true for everyone once rolloutPct is 100", async () => {
    await FeatureFlag.create({ key: "full_flag", enabled: true, rolloutPct: 100 });
    expect(await featureFlagService.isFeatureEnabled("full_flag", { userId: "any-user" })).toBe(true);
  });

  it("is false for everyone when rolloutPct is 0 and no allowlist matches", async () => {
    await FeatureFlag.create({ key: "zero_flag", enabled: true, rolloutPct: 0 });
    expect(await featureFlagService.isFeatureEnabled("zero_flag", { userId: "any-user" })).toBe(false);
  });

  it("a specific userId in enabledForUserIds always wins, even at 0% rollout", async () => {
    const flag = await FeatureFlag.create({ key: "allowlist_flag", enabled: true, rolloutPct: 0, enabledForUserIds: ["64b000000000000000000001"] });
    expect(await featureFlagService.isFeatureEnabled(flag.key, { userId: "64b000000000000000000001" })).toBe(true);
    expect(await featureFlagService.isFeatureEnabled(flag.key, { userId: "64b000000000000000000002" })).toBe(false);
  });

  it("a matching planKey in enabledForPlanKeys always wins, even at 0% rollout", async () => {
    await FeatureFlag.create({ key: "plan_flag", enabled: true, rolloutPct: 0, enabledForPlanKeys: ["premium_monthly"] });
    expect(await featureFlagService.isFeatureEnabled("plan_flag", { userId: "u1", planKey: "premium_monthly" })).toBe(true);
    expect(await featureFlagService.isFeatureEnabled("plan_flag", { userId: "u1", planKey: "freemium" })).toBe(false);
  });

  it("a partial rollout is deterministic for the same user across calls", async () => {
    await FeatureFlag.create({ key: "partial_flag", enabled: true, rolloutPct: 50 });
    const first = await featureFlagService.isFeatureEnabled("partial_flag", { userId: "stable-user-id" });
    const second = await featureFlagService.isFeatureEnabled("partial_flag", { userId: "stable-user-id" });
    expect(first).toBe(second);
  });

  it("a partial rollout is false with no userId to bucket on", async () => {
    await FeatureFlag.create({ key: "partial_flag_2", enabled: true, rolloutPct: 50 });
    expect(await featureFlagService.isFeatureEnabled("partial_flag_2", {})).toBe(false);
  });

  it("roughly splits a population across a 50% rollout (statistical sanity check)", async () => {
    await FeatureFlag.create({ key: "half_flag", enabled: true, rolloutPct: 50 });
    let enabledCount = 0;
    const total = 200;
    for (let i = 0; i < total; i += 1) {
      if (await featureFlagService.isFeatureEnabled("half_flag", { userId: `user-${i}` })) enabledCount += 1;
    }
    expect(enabledCount).toBeGreaterThan(total * 0.3);
    expect(enabledCount).toBeLessThan(total * 0.7);
  });
});

describe("resolveAllFlagsFor", () => {
  it("returns every flag's resolved state in one pass", async () => {
    await FeatureFlag.create({ key: "flag_a", enabled: true, rolloutPct: 100 });
    await FeatureFlag.create({ key: "flag_b", enabled: false, rolloutPct: 100 });
    const result = await featureFlagService.resolveAllFlagsFor({ userId: "u1" });
    expect(result).toEqual(expect.objectContaining({ flag_a: true, flag_b: false }));
  });
});

describe("createFeatureFlag / updateFeatureFlag", () => {
  it("creates a flag, lowercasing the key", async () => {
    const flag = await featureFlagService.createFeatureFlag({ key: "MyFlag", enabled: true }, "admin@example.com");
    expect(flag.key).toBe("myflag");
    expect(flag.updatedBy).toBe("admin@example.com");
  });

  it("refuses a duplicate key", async () => {
    await featureFlagService.createFeatureFlag({ key: "dupe_flag" }, "admin@example.com");
    await expect(featureFlagService.createFeatureFlag({ key: "dupe_flag" }, "admin@example.com")).rejects.toMatchObject({ status: 409 });
  });

  it("updates mutable fields and stamps updatedBy", async () => {
    const flag = await featureFlagService.createFeatureFlag({ key: "editable_flag" }, "first@example.com");
    const updated = await featureFlagService.updateFeatureFlag(String(flag._id), { enabled: true, rolloutPct: 25 }, "second@example.com");
    expect(updated.enabled).toBe(true);
    expect(updated.rolloutPct).toBe(25);
    expect(updated.updatedBy).toBe("second@example.com");
  });

  it("throws for an unknown id", async () => {
    await expect(featureFlagService.updateFeatureFlag("64b000000000000000000000", { enabled: true }, "x@example.com")).rejects.toMatchObject({ status: 404 });
  });
});
