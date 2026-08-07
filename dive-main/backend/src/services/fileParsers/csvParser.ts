import Papa from "papaparse";
import { normalizeRow } from "./rowNormalizer";
import { CandidateHolding } from "./types";

export async function parseCsv(buffer: Buffer): Promise<CandidateHolding[]> {
  const text = buffer.toString("utf-8");
  const { data } = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  const rows = await Promise.all(data.map((row) => normalizeRow(row)));
  return rows.filter((r) => r.name);
}
