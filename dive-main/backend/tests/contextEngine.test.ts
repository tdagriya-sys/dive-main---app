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
    expect(resolveCorpusTier(5000000).expectedClassCount).toBe(11);
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

  it("every class is reachable once a large corpus asks for all 11, regardless of persona's deprioritized list", () => {
    const young = resolveContext(10000000, 22).expectedAssetClasses; // Large tier -> 11 classes, Early Career persona
    expect(young).toHaveLength(11);
    expect(new Set(young).size).toBe(11); // no duplicates
    expect(young).toEqual(expect.arrayContaining(["FD", "BOND", "ULIP_INSURANCE", "REIT", "INVIT"])); // deprioritized-but-still-reachable classes
  });

  it("never returns more classes than the corpus tier's expected count", () => {
    const { expectedAssetClasses } = resolveContext(50000, 30); // Growing -> 3
    expect(expectedAssetClasses.length).toBe(3);
  });
});
