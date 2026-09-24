function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Recursively compares two JSON-shaped config payloads and returns a flat
// list of leaf-level differences as { path, before, after }, dot-separated
// for nested fields (e.g. "compositeWeights.concentration"). Nested plain
// objects are walked key-by-key; arrays and primitives are compared as a
// single whole rather than diffed element-by-element — good enough for
// config payloads, where an array field (stockCountBreakpoints,
// defaultClassOrder, corpusTiers, personaBrackets) changing at all is worth
// flagging as one unit, not exploding into a wall of index-based sub-diffs.
export function diffPayloads(before, after, path = "") {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diffs = [];
    for (const key of keys) {
      diffs.push(...diffPayloads(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return diffs;
  }

  return [{ path, before, after }];
}
