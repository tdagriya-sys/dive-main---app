import { isCategoryExpected, contextSummaryMessage, expectedCoreCategories, deferredIncreaseNote, deferredReduceNote } from "./contextMessaging";

describe("isCategoryExpected", () => {
  it("fails open (returns true) when there's no context yet, so a legitimate suggestion is never silently suppressed", () => {
    expect(isCategoryExpected("Equity", null)).toBe(true);
    expect(isCategoryExpected("Equity", undefined)).toBe(true);
  });

  it("returns true only for categories present in the context's expectedAssetClasses", () => {
    const context = { expectedAssetClasses: ["EQUITY", "BOND"] };
    expect(isCategoryExpected("Equity", context)).toBe(true);
    expect(isCategoryExpected("Crypto", context)).toBe(false);
  });
});

describe("expectedCoreCategories", () => {
  it("returns an empty set when context is missing", () => {
    expect(expectedCoreCategories(null).size).toBe(0);
  });

  it("maps backend asset classes down to CORE_CATEGORIES labels, deduping REIT/INVIT", () => {
    const set = expectedCoreCategories({ expectedAssetClasses: ["REIT", "INVIT", "EQUITY"] });
    expect(set.has("REIT/InvIT")).toBe(true);
    expect(set.has("Equity")).toBe(true);
    expect(set.size).toBe(2); // REIT + INVIT collapse into one label
  });
});

describe("contextSummaryMessage", () => {
  it("returns null when context is missing or incomplete", () => {
    expect(contextSummaryMessage(null)).toBeNull();
    expect(contextSummaryMessage({})).toBeNull();
  });

  it("gives a reassuring 'complete starting point' message when nothing expected is missing", () => {
    const context = {
      corpusTier: { label: "Starter" },
      persona: { label: "Early Career" },
      missingExpectedAssetClasses: [],
    };
    const msg = contextSummaryMessage(context);
    expect(msg).toMatch(/solid, complete starting point/i);
    expect(msg).toMatch(/early career/i);
  });

  it("names the specific missing categories when some are expected but absent", () => {
    const context = {
      corpusTier: { label: "Growing" },
      persona: { label: "Peak Earning" },
      missingExpectedAssetClasses: ["BOND", "GOLD"],
    };
    const msg = contextSummaryMessage(context);
    expect(msg).toMatch(/bonds/i);
    expect(msg).toMatch(/gold\/silver/i);
    expect(msg).toMatch(/peak earning/i);
  });
});

describe("deferred notes", () => {
  it("deferredIncreaseNote explains a category isn't a priority yet, not that it's a problem", () => {
    const note = deferredIncreaseNote("Crypto", { persona: { label: "Early Career" } });
    expect(note).toMatch(/isn't a priority/i);
    expect(note).toMatch(/isn't a problem/i);
  });

  it("deferredReduceNote explains there's nowhere sensible to trim into yet", () => {
    const note = deferredReduceNote("Equity", { persona: { label: "Early Career" } });
    expect(note).toMatch(/nothing to trim/i);
  });
});
