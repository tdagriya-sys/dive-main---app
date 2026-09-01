import { resolveCorpusTier, resolvePersona, resolveContext } from "../src/services/contextEngine";

describe("contextEngine — corpus tiers", () => {
  it("buckets amounts into the documented tiers", () => {
    expect(resolveCorpusTier(0).id).toBe("starter");
    expect(resolveCorpusTier(24999).id).toBe("starter");
    expect(resolveCorpusTier(25000).id).toBe("growing");
    expect(resolveCorpusTier(199999).id).toBe("growing");
    expect(resolveCorpusTier(200000).id).toBe("established");
    expect(resolveCorpusTier(999999).id).toBe("established");
    expect(resolveCorpusTier(1000000).id).toBe("substantial");
    expect(resolveCorpusTier(4999999).id).toBe("substantial");
    expect(resolveCorpusTier(5000000).id).toBe("large");
    expect(resolveCorpusTier(100000000).id).toBe("large");
  });

  it("expected class count increases monotonically with corpus size", () => {
    const counts = [0, 25000, 200000, 1000000, 5000000].map((amt) => resolveCorpusTier(amt).expectedClassCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    expect(resolveCorpusTier(5000000).expectedClassCount).toBe(12); // 11 -> 12 once PF joined the universe
  });
});

describe("contextEngine — persona brackets", () => {
  it("buckets ages into the documented brackets with no gaps or overlaps", () => {
    expect(resolvePersona(18).id).toBe("earlyCareer");
    expect(resolvePersona(28).id).toBe("earlyCareer");
    expect(resolvePersona(29).id).toBe("buildingPhase");
    expect(resolvePersona(40).id).toBe("buildingPhase");
    expect(resolvePersona(41).id).toBe("peakEarning");
    expect(resolvePersona(55).id).toBe("peakEarning");
    expect(resolvePersona(56).id).toBe("preRetirement");
    expect(resolvePersona(64).id).toBe("preRetirement");
    expect(resolvePersona(65).id).toBe("retired");
    expect(resolvePersona(90).id).toBe("retired");
  });
});

describe("contextEngine — resolveContext (expected asset class set)", () => {
  it("gives a young, small-corpus user a short, growth-oriented expected set", () => {
    const { expectedAssetClasses, corpusTier, persona } = resolveContext(10000, 25);
    expect(corpusTier.id).toBe("starter");
    expect(persona.id).toBe("earlyCareer");
    expect(expectedAssetClasses).toEqual(["EQUITY"]);
  });

  it("prioritizes preservation classes for a pre-retirement persona once corpus allows more than 1 class", () => {
    const { expectedAssetClasses } = resolveContext(100000, 60); // Growing tier -> 3 classes
    expect(expectedAssetClasses).toEqual(["BOND", "FD", "MUTUAL_FUND"]);
  });

  it("every class is reachable once a large corpus asks for all 12, regardless of persona's deprioritized list", () => {
    const young = resolveContext(10000000, 22).expectedAssetClasses; // Large tier -> 12 classes, Early Career persona
    expect(young).toHaveLength(12);
    expect(new Set(young).size).toBe(12); // no duplicates
    expect(young).toEqual(expect.arrayContaining(["FD", "BOND", "ULIP_INSURANCE", "REIT", "INVIT", "PF"])); // deprioritized-but-still-reachable classes
  });

  it("never returns more classes than the corpus tier's expected count", () => {
    const { expectedAssetClasses } = resolveContext(50000, 30); // Growing -> 3
    expect(expectedAssetClasses.length).toBe(3);
  });
});

// Locks in the specific PF (Provident Fund) placement decisions from the
// implementation plan — each traced by hand against fullPersonaOrder's
// actual algorithm (priorityClasses -> DEFAULT_CLASS_ORDER minus
// deprioritized -> deprioritizedClasses), not just asserted on faith, so a
// future reordering of DEFAULT_CLASS_ORDER or a persona's lists can't
// silently change these without a test failure.
describe("contextEngine — PF (Provident Fund) persona placement", () => {
  it("earlyCareer: PF is the LAST class reached (deprioritized, after every other deprioritized class) — absent even at 8 classes", () => {
    const substantial = resolveContext(2000000, 25).expectedAssetClasses; // Substantial tier -> 8 classes
    expect(substantial).not.toContain("PF");
    const large = resolveContext(10000000, 25).expectedAssetClasses; // Large tier -> 12 classes
    expect(large[large.length - 1]).toBe("PF");
  });

  it("buildingPhase: PF is in the explicit priority list, right after BOND — the 5th class at Established tier", () => {
    const { expectedAssetClasses } = resolveContext(300000, 35); // Established tier -> 5 classes
    expect(expectedAssetClasses).toEqual(["EQUITY", "MUTUAL_FUND", "GOLD", "BOND", "PF"]);
  });

  it("peakEarning: PF sits ahead of FD in the priority list — the 4th class at Substantial tier", () => {
    const { expectedAssetClasses } = resolveContext(2000000, 45); // Substantial tier -> 8 classes
    expect(expectedAssetClasses).toEqual(["EQUITY", "MUTUAL_FUND", "BOND", "PF", "FD", "GOLD", "REIT", "INVIT"]);
  });

  it("preRetirement: PF is deliberately placed AFTER Mutual Funds, not before — absent at Growing tier (3), present as the 4th class once Established tier (5) is reached", () => {
    const growing = resolveContext(100000, 60).expectedAssetClasses; // Growing tier -> 3 classes (matches the existing exact-array test above, unaffected by PF)
    expect(growing).not.toContain("PF");
    const established = resolveContext(300000, 60).expectedAssetClasses; // Established tier -> 5 classes
    expect(established).toEqual(["BOND", "FD", "MUTUAL_FUND", "PF", "GOLD"]);
  });

  it("retired: PF is absent from both lists, reachable only via DEFAULT_CLASS_ORDER once the corpus tier needs more than the persona's explicit 6 classes", () => {
    const established = resolveContext(300000, 70).expectedAssetClasses; // Established tier -> 5 classes, all from priorityClasses
    expect(established).not.toContain("PF");
    const substantial = resolveContext(2000000, 70).expectedAssetClasses; // Substantial tier -> 8 classes
    expect(substantial).toContain("PF");
    expect(substantial[6]).toBe("PF"); // 7th class (0-indexed 6): after the persona's own 6 explicit classes
  });
});
