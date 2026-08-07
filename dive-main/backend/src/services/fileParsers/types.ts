import { AssetClass } from "../../models/Instrument";

export interface CandidateHolding {
  name: string;
  assetClass: AssetClass | null;
  instrumentId: string | null;
  investedValue: number | null;
  currentValue: number | null;
  quantity: number | null;
  confidence: "high" | "medium" | "low";
  // Whether `name` actually matched something in our Instrument master.
  // false does NOT mean fake/wrong — our seed is a small fraction of NSE's
  // ~2700+ listed equities — it means "couldn't verify", so callers should
  // default these rows to unchecked/needs-review rather than auto-including them.
  verifiedInInstrumentList: boolean;
  missingFields: string[];
  rawRow?: Record<string, unknown>;
}

export function missingFieldsFor(c: Pick<CandidateHolding, "name" | "assetClass" | "investedValue">): string[] {
  const missing: string[] = [];
  if (!c.name) missing.push("name");
  if (!c.assetClass) missing.push("assetClass");
  if (c.investedValue === null || c.investedValue === undefined) missing.push("investedValue");
  return missing;
}
