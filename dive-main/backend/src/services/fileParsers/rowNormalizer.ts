import { categorizeInstrument } from "../categorizeInstrument";
import { CandidateHolding, missingFieldsFor } from "./types";
import { ASSET_CLASSES, AssetClass } from "../../models/Instrument";

const NAME_KEYS = ["name", "instrument", "instrumentname", "scheme", "schemename", "stock", "security", "fund"];
const INVESTED_KEYS = ["invested", "investedvalue", "investment", "amount", "principal", "cost", "buyvalue", "purchasevalue"];
const CURRENT_KEYS = ["current", "currentvalue", "marketvalue", "value", "presentvalue", "ltpvalue"];
const QUANTITY_KEYS = ["quantity", "qty", "units", "shares"];
const ASSET_CLASS_KEYS = ["assetclass", "type", "category", "segment"];

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstMatch(row: Record<string, unknown>, keys: string[]): unknown {
  const normalizedRow = new Map(Object.entries(row).map(([k, v]) => [normalizeKey(k), v]));
  for (const key of keys) {
    if (normalizedRow.has(key)) return normalizedRow.get(key);
  }
  return undefined;
}

function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function parseAssetClassHint(v: unknown): AssetClass | null {
  if (typeof v !== "string") return null;
  const upper = v.trim().toUpperCase().replace(/[\s-]/g, "_");
  return (ASSET_CLASSES as readonly string[]).includes(upper) ? (upper as AssetClass) : null;
}

/**
 * Turns one arbitrary CSV/XLSX/JSON row (unknown column names) into a
 * CandidateHolding using fuzzy header matching, then categorizes the
 * instrument name if the row didn't already say its asset class.
 */
export async function normalizeRow(row: Record<string, unknown>): Promise<CandidateHolding> {
  const name = String(firstMatch(row, NAME_KEYS) ?? "").trim();
  const investedValue = toNumber(firstMatch(row, INVESTED_KEYS));
  const currentValue = toNumber(firstMatch(row, CURRENT_KEYS));
  const quantity = toNumber(firstMatch(row, QUANTITY_KEYS));
  const assetClassHint = parseAssetClassHint(firstMatch(row, ASSET_CLASS_KEYS));

  let assetClass = assetClassHint;
  let instrumentId: string | null = null;
  let confidence: CandidateHolding["confidence"] = assetClassHint ? "high" : "low";
  let verifiedInInstrumentList = false;

  if (!assetClass && name) {
    const result = await categorizeInstrument(name);
    assetClass = result.assetClass;
    instrumentId = result.instrumentId;
    confidence = result.confidence;
    verifiedInInstrumentList = result.verifiedInInstrumentList;
  }

  const candidate: CandidateHolding = {
    name,
    assetClass,
    instrumentId,
    investedValue,
    currentValue: currentValue ?? investedValue,
    quantity,
    confidence,
    verifiedInInstrumentList,
    rawRow: row,
    missingFields: [],
  };
  candidate.missingFields = missingFieldsFor(candidate);
  return candidate;
}
