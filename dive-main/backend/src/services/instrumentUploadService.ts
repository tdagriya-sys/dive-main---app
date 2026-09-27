import Papa from "papaparse";
import { Instrument, IInstrument, AssetClass, ASSET_CLASSES } from "../models/Instrument";
import { Holding } from "../models/Holding";
import { ApiError } from "../middleware/errorHandler";
import { normalizeFundKey } from "./lookthroughService";
import { getOrCreateDraftLookthroughConfig, updateDraftLookthroughConfig } from "./config/lookthroughConfigService";
import { FundHoldingPayload } from "../models/LookthroughConfig";

/**
 * Manual instrument-data upload (Phase 2 gap-fill — docs/PROTOTYPE_LIMITATIONS.md's
 * "AMFI unreachable from cloud IPs" entry, and the same is already true of
 * REIT/InvIT/BOND/ULIP_INSURANCE, which never had a live public source at all —
 * see instrumentService.ts's own top comment). Lets an admin upload a CSV of
 * real instrument data for ONE asset class at a time (Admin → Instruments →
 * Upload data), read straight from the file, no waiting on a blocked network
 * call. Full column spec: docs/INSTRUMENT_UPLOAD_FORMAT.md.
 *
 * Design rules, all deliberate:
 *  - Only `name` is required. Every other column is optional and a blank/bad
 *    value in one column never drops the whole row — see parseRow's own
 *    comment. A row is skipped only when it has no usable name at all.
 *  - Uploaded rows are tagged `source: "ADMIN_UPLOAD"` and given a symbol that
 *    can never collide with a live source's own code (an explicit symbol/ISIN
 *    is namespaced; an omitted one is derived from the name) — so a later
 *    live refresh (instrumentService.ts::upsertBatch, keyed on assetClass+
 *    symbol) can never silently overwrite or wipe an uploaded row's metadata,
 *    and an uploaded row can never silently overwrite a live-sourced one either.
 *  - UPSERT, never a blanket delete-then-replace (this is the point of using a
 *    real exchange/regulator-issued code — Symbol/ISIN/Scheme Code — as the
 *    join key: the SAME instrument gets the SAME derived symbol on every
 *    re-upload, so re-uploading with today's NAV/price is how a valuation
 *    actually gets refreshed for instruments with no live source, not how
 *    they get wiped). Per instrument, only the fields the new row actually
 *    provides are touched (a Mongo dot-path `$set`, one field at a time —
 *    see applyInstrumentUpload) — a field the new file leaves out keeps
 *    whatever was last recorded for it, exactly like a live-source refresh
 *    already behaves for the fields IT doesn't touch. An instrument from a
 *    PREVIOUS upload that simply isn't in this newer file is left exactly as
 *    it is — normal, expected (a lean "just the price" file shouldn't need
 *    to repeat every instrument every time), not an error. Removing an
 *    instrument that's genuinely gone (delisted, wound up) is a SEPARATE,
 *    explicit, opt-in action (`removeMissing`) — never automatic — and even
 *    then a row some user already holds is retired (isActive:false), never
 *    hard-deleted, since that would leave Holding.instrumentId pointing at
 *    nothing.
 *  - A Mutual Fund upload whose rows include Underlying Holdings also fills
 *    the Look-Through Model's curated fund-holdings map — see
 *    applyUploadedFundHoldingsToLookthrough's own comment.
 */

export const ADMIN_UPLOAD_SOURCE = "ADMIN_UPLOAD";
export const MAX_UPLOAD_ROWS = 20_000;

// header text -> a canonical field. Matched after lowercasing and stripping
// every non-alphanumeric character, so "Scheme Name", "scheme_name" and
// "SchemeName" are all the same key — this is deliberately forgiving of
// whatever a real spreadsheet export happens to use.
function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Every alias a real file might use for the same idea, all normalized ahead of
// time. Order inside a group doesn't matter; first match on a row wins.
const CANONICAL_FIELDS: Record<string, string[]> = {
  name: ["name", "instrumentname", "schemename", "companyname", "fundname", "securityname", "title"],
  symbol: ["symbol", "ticker", "code", "schemecode", "instrumentcode"],
  isin: ["isin", "isincode"],
  issuer: ["issuer", "amc", "fundhouse", "sponsor", "company", "bank", "insurer"],
  exchange: ["exchange", "listedon", "listingexchange"],
  sector: ["sector", "segment", "industry"],
  category: ["category", "class", "type", "plantype", "bondclass", "classofbond", "subtype"],
  price: ["nav", "price", "unitprice", "currentprice", "navrs", "navvalue", "marketprice"],
  priceAsOf: ["navdate", "pricedate", "asof", "asofdate", "navasof", "valuationdate"],
  annualReturnPct: ["annualreturn", "annualreturnpct", "annualreturnrate", "couponrate", "coupon", "yieldpct", "yield", "expectedreturn", "expectedreturnpct", "returnpct"],
  creditRating: ["creditrating", "rating"],
  maturityDate: ["maturitydate", "maturity"],
  expenseRatioPct: ["expenseratio", "expenseratiopct", "ter"],
  underlyingHoldings: ["underlyingholdings", "topholdings", "holdings", "portfolioholdings"],
};

const HEADER_TO_FIELD = new Map<string, string>();
for (const [field, aliases] of Object.entries(CANONICAL_FIELDS)) {
  for (const alias of aliases) HEADER_TO_FIELD.set(alias, field);
}

const NUMERIC_FIELDS = new Set(["price", "annualReturnPct", "expenseRatioPct"]);

export interface UnderlyingHolding {
  name: string;
  weightPct?: number;
}

// "Reliance Industries:8.5; HDFC Bank:6.2; Some Odd Entry" -> keeps every
// piece even the malformed one (no weight parses -> weightPct just omitted),
// exactly the "missing data doesn't drop anything" rule applied one level
// deeper, inside a single field.
export function parseUnderlyingHoldings(raw: string): UnderlyingHolding[] {
  return raw
    .split(/[;\n]/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const at = piece.lastIndexOf(":");
      if (at < 0) return { name: piece };
      const name = piece.slice(0, at).trim();
      const weight = Number(piece.slice(at + 1).replace(/[%\s]/g, ""));
      return name ? { name, weightPct: Number.isFinite(weight) ? weight : undefined } : { name: piece };
    })
    .filter((h) => h.name);
}

export interface RowIssue {
  row: number; // 1-based, counting the header as row 0 (so row 1 = the first data row)
  message: string;
}

export interface ParsedInstrumentRow {
  symbol: string;
  name: string;
  issuer?: string;
  exchange?: string;
  metadata: Record<string, unknown>;
}

interface ParseResult {
  rows: ParsedInstrumentRow[];
  skipped: RowIssue[];
  warnings: RowIssue[];
}

// UPLOAD_ prefix keeps a derived symbol out of the namespace any live source
// (numeric AMFI codes, NSE tickers, CoinGecko symbols) could ever produce —
// see this file's own top comment for why that matters.
function slugify(name: string): string {
  return (
    "UPLOAD_" +
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60)
  );
}

// A row's OWN explicit symbol/ISIN is also namespaced — deliberately: if it
// weren't, a symbol that happened to match a live source's own code could get
// silently overwritten (metadata reset to {}) the next time that source
// refreshes successfully, exactly the failure mode this feature exists to
// avoid. See docs/INSTRUMENT_UPLOAD_FORMAT.md for how this reads to an admin.
function deriveSymbol(explicit: string | undefined, isin: string | undefined, name: string): string {
  const base = (explicit || isin || "").trim();
  return base ? `UPLOAD_${base.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` : slugify(name);
}

// Reads one already-header-mapped row. Only ever returns null for a row with
// no usable name — every other field is independently optional, so a mutual
// fund with no underlying-holdings column (or a malformed one) still gets
// everything else it DID have. Numeric fields that fail to parse are simply
// left out (a warning, not a skip) rather than stored as garbage or failing
// the row.
function parseRow(byField: Record<string, string> & { __extra?: Record<string, string> }, rowNumber: number, warnings: RowIssue[]): ParsedInstrumentRow | null {
  const name = (byField.name || "").trim();
  if (!name) return null;

  const metadata: Record<string, unknown> = {};
  for (const field of Object.keys(CANONICAL_FIELDS)) {
    if (["name", "symbol", "issuer", "exchange"].includes(field)) continue; // these land on top-level fields instead
    const raw = byField[field];
    if (raw === undefined || raw.trim() === "") continue;
    if (field === "underlyingHoldings") {
      const parsed = parseUnderlyingHoldings(raw);
      if (parsed.length) metadata.underlyingHoldings = parsed;
      continue;
    }
    if (NUMERIC_FIELDS.has(field)) {
      const num = Number(raw.replace(/[,%\s]/g, ""));
      if (Number.isFinite(num)) metadata[field] = num;
      else warnings.push({ row: rowNumber, message: `"${field}" value "${raw}" isn't a number — that one field was left blank, the rest of the row was kept.` });
      continue;
    }
    metadata[field] = raw.trim();
  }
  if (byField.isin) metadata.isin = byField.isin.trim();

  // Any column that wasn't one of the recognized aliases above still isn't
  // lost — kept verbatim under its own (normalized) header, so a bond's
  // "Credit Watch" or an insurer's "Sum Assured" column, say, still shows up
  // even though this file has no special-case name for it.
  const extra = byField.__extra as unknown as Record<string, string> | undefined;
  if (extra) for (const [key, value] of Object.entries(extra)) if (value.trim()) metadata[key] = value.trim();

  return {
    symbol: deriveSymbol(byField.symbol, byField.isin, name),
    name,
    issuer: byField.issuer?.trim() || undefined,
    exchange: byField.exchange?.trim() || undefined,
    metadata,
  };
}

// Pure parsing — no DB access — so it's directly unit-testable without a
// database, and so the controller can show a dry-run-style row count before
// anything is written (it isn't, today, but keeps that door open cheaply).
export function parseInstrumentUploadCsv(buffer: Buffer): ParseResult {
  const text = buffer.toString("utf-8").replace(/^﻿/, ""); // strip a UTF-8 BOM (Excel loves adding one)
  const { data, errors } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  const rows: ParsedInstrumentRow[] = [];
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  if (errors.length && data.length === 0) {
    skipped.push({ row: 0, message: `Couldn't read this file as CSV (${errors[0].message}).` });
    return { rows, skipped, warnings };
  }

  const limited = data.length > MAX_UPLOAD_ROWS;
  const usable = limited ? data.slice(0, MAX_UPLOAD_ROWS) : data;

  usable.forEach((rawRow, i) => {
    const rowNumber = i + 1;
    const byField: Record<string, string> & { __extra?: Record<string, string> } = {};
    const extra: Record<string, string> = {};
    for (const [header, value] of Object.entries(rawRow)) {
      if (value === null || value === undefined) continue;
      const key = normalizeHeaderKey(header);
      const field = HEADER_TO_FIELD.get(key);
      if (field) {
        byField[field] = String(value);
      } else if (key) {
        extra[header.trim().toLowerCase().replace(/\s+/g, "_")] = String(value);
      }
    }
    byField.__extra = extra;
    const parsed = parseRow(byField, rowNumber, warnings);
    if (!parsed) {
      skipped.push({ row: rowNumber, message: "No name in this row — nothing to identify the instrument by, so it was skipped." });
      return;
    }
    rows.push(parsed);
  });

  if (limited) {
    skipped.push({ row: 0, message: `This file has more than ${MAX_UPLOAD_ROWS.toLocaleString("en-IN")} rows — only the first ${MAX_UPLOAD_ROWS.toLocaleString("en-IN")} were read.` });
  }

  // Within one file, a later row with the same symbol wins (lets an admin
  // append a "corrections" block at the end of the same file); the earlier
  // one is reported so it's never a silent, unexplained loss.
  const bySymbol = new Map<string, ParsedInstrumentRow>();
  const dupeOrder: string[] = [];
  for (const row of rows) {
    if (bySymbol.has(row.symbol)) skipped.push({ row: 0, message: `"${row.name}" (${row.symbol}) appears more than once in this file — the later row replaced the earlier one.` });
    else dupeOrder.push(row.symbol);
    bySymbol.set(row.symbol, row);
  }
  return { rows: dupeOrder.map((s) => bySymbol.get(s)!), skipped, warnings };
}

export interface UploadSummary {
  assetClass: AssetClass;
  fileName: string;
  totalRows: number;
  inserted: number;
  updated: number;
  removeMissingRequested: boolean;
  deletedFromPrevious: number;
  retiredInsteadOfDeleted: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
  // Only present for a MUTUAL_FUND upload whose rows carried Underlying Holdings.
  lookthrough?: LookthroughUpdateResult;
}

// Builds the per-field Mongo update for ONE row — every key is a dot-path
// (`metadata.sector`, not `metadata`), so only the fields THIS row actually
// provides are touched; every other previously-stored field (top-level or
// inside metadata) survives untouched. This is what makes a lean "just the
// updated price" re-upload safe — it can't accidentally blank out a
// previous upload's sector/underlying-holdings/etc. just by omitting them.
function buildRowUpdate(row: ParsedInstrumentRow, fileName: string, now: Date): Record<string, unknown> {
  const set: Record<string, unknown> = {
    name: row.name,
    isActive: true,
    source: ADMIN_UPLOAD_SOURCE,
    lastRefreshedAt: now,
    "metadata.uploadedFileName": fileName,
    "metadata.uploadedAt": now,
  };
  if (row.issuer !== undefined) set.issuer = row.issuer;
  if (row.exchange !== undefined) set.exchange = row.exchange;
  for (const [key, value] of Object.entries(row.metadata)) set[`metadata.${key}`] = value;
  return set;
}

// The one DB-touching step for the Instrument collection. Deliberately NOT
// called "replaceInstruments" — see this file's own top comment. `fundHoldings`
// (from applyUploadedFundHoldingsToLookthrough) rides along only for a
// MUTUAL_FUND upload.
export async function applyInstrumentUpload(assetClass: AssetClass, fileName: string, buffer: Buffer, opts: { removeMissing?: boolean; actorId?: string } = {}): Promise<UploadSummary> {
  if (!(ASSET_CLASSES as readonly string[]).includes(assetClass)) {
    throw new ApiError(400, "INVALID_ASSET_CLASS", `"${assetClass}" isn't a recognized asset class.`);
  }
  const { rows, skipped, warnings } = parseInstrumentUploadCsv(buffer);
  if (rows.length === 0) {
    throw new ApiError(400, "NO_USABLE_ROWS", "No row in this file had a usable name — nothing to upload. See the skipped-row list for why.");
  }

  const now = new Date();
  const result = await Instrument.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { assetClass, symbol: row.symbol },
        update: { $set: buildRowUpdate(row, fileName, now) },
        upsert: true,
      },
    }))
  );
  const inserted = result.upsertedCount ?? 0;
  const updated = result.matchedCount ?? 0;

  // Removing an instrument genuinely missing from this newer file is
  // deliberately a SEPARATE, opt-in step — the default upsert above already
  // does the thing a re-upload is actually FOR (refresh existing + add new)
  // without ever touching an instrument this file simply didn't mention.
  let deletedFromPrevious = 0;
  let retiredInsteadOfDeleted = 0;
  if (opts.removeMissing) {
    const uploadedSymbols = rows.map((r) => r.symbol);
    const missing = await Instrument.find({ assetClass, source: ADMIN_UPLOAD_SOURCE, symbol: { $nin: uploadedSymbols } }).select("_id").lean();
    const missingIds = missing.map((m) => m._id);
    if (missingIds.length) {
      // A previously-uploaded instrument some user already holds is never
      // hard-deleted — that would leave Holding.instrumentId pointing at
      // nothing. It's retired instead: isActive:false takes it out of
      // search/autocomplete for NEW holdings, while the existing holding's
      // link (and whatever value it was last given) stays intact.
      const heldIds = await Holding.distinct("instrumentId", { instrumentId: { $in: missingIds } });
      const heldIdSet = new Set(heldIds.map((id) => String(id)));
      const toDelete = missingIds.filter((id) => !heldIdSet.has(String(id)));
      const toRetire = missingIds.filter((id) => heldIdSet.has(String(id)));
      const [deleteResult] = await Promise.all([
        toDelete.length ? Instrument.deleteMany({ _id: { $in: toDelete } }) : Promise.resolve({ deletedCount: 0 }),
        toRetire.length ? Instrument.updateMany({ _id: { $in: toRetire } }, { $set: { isActive: false } }) : Promise.resolve(null),
      ]);
      deletedFromPrevious = deleteResult.deletedCount ?? 0;
      retiredInsteadOfDeleted = toRetire.length;
    }
  }

  const lookthrough = assetClass === "MUTUAL_FUND" ? await applyUploadedFundHoldingsToLookthrough(rows, fileName, opts.actorId) : undefined;

  return {
    assetClass,
    fileName,
    totalRows: rows.length + skipped.filter((s) => s.row > 0).length,
    inserted,
    updated,
    removeMissingRequested: Boolean(opts.removeMissing),
    deletedFromPrevious,
    retiredInsteadOfDeleted,
    skipped,
    warnings,
    ...(lookthrough ? { lookthrough } : {}),
  };
}

export interface LookthroughUpdateResult {
  fundsUpdated: number;
  fundsSkippedNoWeight: number;
  draftVersion: number | null;
}

// A Mutual Fund upload's Underlying Holdings column feeds the SAME curated
// map the Look-Through Model admin screen edits by hand
// (LookthroughConfigPayload.mutualFundTopHoldings — see
// lookthroughService.ts::connectionBetween, which is what this whole map is
// FOR: detecting a fund's disclosed weight in a stock a user also holds
// directly). "Fill gaps, don't override wholesale" — ONLY the funds actually
// present in THIS file (by the same normalizeFundKey used at scoring-lookup
// time) get their entry replaced; every other fund's entry — hand-curated by
// an admin, or from an earlier upload — is left exactly as it is. This is the
// same upsert-not-replace philosophy as the Instrument rows themselves,
// applied one level up.
//
// Deliberately creates/updates a DRAFT, never auto-publishes: this map feeds
// every user's Dive Score, and every other config in this app (Scoring/
// Context/Suggestion) already requires an explicit human publish step before
// a change takes effect — a bulk file upload shouldn't be the one exception
// that skips that. The admin reviews and publishes from
// /admin → Look-Through Model, same as any other config edit.
export async function applyUploadedFundHoldingsToLookthrough(rows: ParsedInstrumentRow[], fileName: string, actorId?: string): Promise<LookthroughUpdateResult | undefined> {
  const bySymbolLatest = new Map<string, ParsedInstrumentRow>();
  for (const row of rows) bySymbolLatest.set(row.symbol, row); // parseInstrumentUploadCsv already dedupes, but stay defensive
  const upserts: Record<string, FundHoldingPayload[]> = {};
  let fundsSkippedNoWeight = 0;

  for (const row of bySymbolLatest.values()) {
    const raw = row.metadata.underlyingHoldings as UnderlyingHolding[] | undefined;
    if (!raw || !raw.length) continue;
    // FundHoldingPayload.weightPct is a required number (0-100) — a holding
    // with no parseable weight, or one out of range, can't be represented in
    // the strict scoring input; it's dropped HERE only (it still shows on the
    // instrument's own metadata.underlyingHoldings for display).
    const usable: FundHoldingPayload[] = raw.filter((h) => typeof h.weightPct === "number" && h.weightPct >= 0 && h.weightPct <= 100).map((h) => ({ company: h.name, weightPct: h.weightPct as number }));
    if (!usable.length) {
      fundsSkippedNoWeight += 1;
      continue;
    }
    const key = normalizeFundKey(row.name);
    if (key) upserts[key] = usable;
  }

  if (Object.keys(upserts).length === 0 && fundsSkippedNoWeight === 0) return undefined;
  if (Object.keys(upserts).length === 0) return { fundsUpdated: 0, fundsSkippedNoWeight, draftVersion: null };

  const draft = await getOrCreateDraftLookthroughConfig(actorId);
  const merged = { ...draft.payload.mutualFundTopHoldings, ...upserts };
  const updated = await updateDraftLookthroughConfig({ mutualFundTopHoldings: merged });

  return { fundsUpdated: Object.keys(upserts).length, fundsSkippedNoWeight, draftVersion: updated.version };
}

export type { IInstrument };
