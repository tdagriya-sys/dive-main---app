import { normalizeRow } from "./rowNormalizer";
import { CandidateHolding } from "./types";

function extractArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    for (const key of ["holdings", "data", "items", "rows"]) {
      const val = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val as Record<string, unknown>[];
    }
  }
  return [];
}

export async function parseJson(buffer: Buffer): Promise<CandidateHolding[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf-8"));
  } catch {
    return [];
  }
  const arr = extractArray(parsed);
  const rows = await Promise.all(arr.map((row) => normalizeRow(row)));
  return rows.filter((r) => r.name);
}
