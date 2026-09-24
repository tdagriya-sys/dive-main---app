import { diffPayloads } from "./versionDiff";

describe("diffPayloads", () => {
  it("returns no diffs for identical payloads", () => {
    expect(diffPayloads({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it("reports a top-level primitive change", () => {
    expect(diffPayloads({ cryptoWithinClassCap: 70 }, { cryptoWithinClassCap: 40 })).toEqual([
      { path: "cryptoWithinClassCap", before: 70, after: 40 },
    ]);
  });

  it("reports a nested object change with a dot-separated path", () => {
    const before = { compositeWeights: { concentration: 0.17, volatility: 0.12 } };
    const after = { compositeWeights: { concentration: 0.2, volatility: 0.12 } };
    expect(diffPayloads(before, after)).toEqual([{ path: "compositeWeights.concentration", before: 0.17, after: 0.2 }]);
  });

  it("only reports the leaf(s) that actually changed within a nested object", () => {
    const before = { a: { x: 1, y: 2, z: 3 } };
    const after = { a: { x: 1, y: 99, z: 3 } };
    expect(diffPayloads(before, after)).toEqual([{ path: "a.y", before: 2, after: 99 }]);
  });

  it("treats an array field as a single whole diff, not element-by-element", () => {
    const before = { defaultClassOrder: ["EQUITY", "MUTUAL_FUND", "GOLD"] };
    const after = { defaultClassOrder: ["MUTUAL_FUND", "EQUITY", "GOLD"] };
    const diffs = diffPayloads(before, after);
    expect(diffs).toEqual([{ path: "defaultClassOrder", before: ["EQUITY", "MUTUAL_FUND", "GOLD"], after: ["MUTUAL_FUND", "EQUITY", "GOLD"] }]);
  });

  it("does not flag an unchanged array as different", () => {
    const arr = ["EQUITY", "GOLD"];
    expect(diffPayloads({ defaultClassOrder: arr }, { defaultClassOrder: [...arr] })).toEqual([]);
  });

  it("handles a key present in one payload but not the other", () => {
    expect(diffPayloads({ a: 1 }, { a: 1, b: 2 })).toEqual([{ path: "b", before: undefined, after: 2 }]);
  });

  it("diffs multiple independent top-level and nested fields at once", () => {
    const before = { cryptoWithinClassCap: 70, compositeWeights: { concentration: 0.17 } };
    const after = { cryptoWithinClassCap: 40, compositeWeights: { concentration: 0.2 } };
    const diffs = diffPayloads(before, after);
    expect(diffs).toHaveLength(2);
    expect(diffs).toEqual(
      expect.arrayContaining([
        { path: "cryptoWithinClassCap", before: 70, after: 40 },
        { path: "compositeWeights.concentration", before: 0.17, after: 0.2 },
      ])
    );
  });
});
