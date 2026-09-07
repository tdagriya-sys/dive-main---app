import { z } from "zod";
import { HOLDING_SOURCES } from "../models/Holding";

const objectIdRegex = /^[a-f\d]{24}$/i;
const sourceSchema = z.enum(HOLDING_SOURCES).optional();

// Same as ASSET_CLASSES minus "FD" and "PF" — kept as its own literal tuple
// (rather than filtering ASSET_CLASSES at runtime) so TypeScript can narrow
// ManualHoldingInput by `assetClass === "FD"`/`"PF"` in the controller. FD
// and PF each get their own schema (below) because they have a completely
// different field set (principal/rate/tenure-shaped, no market instrument)
// from every other class here (instrument+value-shaped).
const NON_FD_ASSET_CLASSES = [
  "EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "CRYPTO",
] as const;

const nonFdSchema = z.object({
  assetClass: z.enum(NON_FD_ASSET_CLASSES),
  instrumentId: z.string().regex(objectIdRegex).optional(),
  name: z.string().trim().min(1, "Instrument name is required"),
  investedValue: z.coerce.number().min(0),
  currentValue: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().min(0).optional(),
  purchaseDate: z.coerce.date().optional(),
  source: sourceSchema,
});

const fdSchema = z.object({
  assetClass: z.literal("FD"),
  bank: z.string().trim().min(1, "Bank / institution is required"),
  // min(0), not positive() — a pure RD (no lump sum, just an ongoing
  // monthlyContribution below) is a real, valid case, same as PF's own
  // openingBalance allowing 0 when a PF account is carried purely by
  // contributions.
  principal: z.coerce.number().min(0, "Principal amount can't be negative"),
  tenureMonths: z.coerce.number().int().positive("Tenure (months) must be greater than 0"),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(1990).max(new Date().getFullYear()),
  interestRate: z.coerce.number().positive("Interest rate must be greater than 0"),
  // Optional — an RD (or an FD topped up with periodic deposits) alongside
  // FD's original single-lump-sum shape. Same field name/shape as PF's own
  // monthlyContribution for consistency.
  monthlyContribution: z.coerce.number().min(0).optional(),
  source: sourceSchema,
});

// PF (PPF/EPF/VPF) mirrors FD's shape (principal/rate-based, no market
// instrument) but with a contribution-STREAM shape rather than FD's single
// lump-sum: openingBalance + an ongoing monthlyContribution, no fixed tenure
// (PPF's 15-year term is indefinitely extendable in 5-year blocks; EPF has
// no maturity at all short of retirement) — see computePfValues() below for
// why maturityValue/maturityDate are deliberately NOT computed here the way
// they are for FD.
const pfSchema = z.object({
  assetClass: z.literal("PF"),
  subType: z.enum(["PPF", "EPF", "VPF"]),
  institution: z.string().trim().min(1, "Institution is required"), // e.g. "SBI PPF" or "EPFO (via Acme Corp)"
  openingBalance: z.coerce.number().min(0),
  monthlyContribution: z.coerce.number().min(0).optional(),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(1990).max(new Date().getFullYear()),
  // Pre-filled by the caller from PF_DECLARED_RATES[subType] (config/pfRates.ts)
  // but stays free-form here — a holding keeps whatever rate was actually in
  // force when it was entered, and the government-declared rate can move.
  interestRatePercent: z.coerce.number().positive("Interest rate must be greater than 0"),
  source: sourceSchema,
});

export type NonFdHoldingInput = z.infer<typeof nonFdSchema>;
export type FdHoldingInput = z.infer<typeof fdSchema>;
export type PfHoldingInput = z.infer<typeof pfSchema>;
export type ManualHoldingInput = NonFdHoldingInput | FdHoldingInput | PfHoldingInput;

/**
 * FD and PF each have a distinct field set from every other asset class
 * (principal/tenure/rate-shaped vs instrument+value-shaped), so each is
 * validated as its own schema and dispatched on `assetClass` here rather
 * than via z.discriminatedUnion — the other 9 classes share one literal-enum
 * schema, which discriminatedUnion (one schema per literal branch) doesn't
 * fit cleanly.
 */
export function parseManualHolding(body: unknown): ManualHoldingInput {
  const assetClass = (body as { assetClass?: unknown })?.assetClass;
  if (assetClass === "FD") return fdSchema.parse(body);
  if (assetClass === "PF") return pfSchema.parse(body);
  return nonFdSchema.parse(body);
}

// Editing never changes assetClass (that would mean an entirely different
// field set, closer to "delete and recreate" than "edit") — every field is
// optional so a caller can send just what changed; the controller merges
// this onto the existing document, not a full replacement.
export const nonFdUpdateSchema = z.object({
  instrumentId: z.string().regex(objectIdRegex).optional(),
  name: z.string().trim().min(1, "Instrument name is required").optional(),
  investedValue: z.coerce.number().min(0).optional(),
  currentValue: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().min(0).optional(),
  purchaseDate: z.coerce.date().optional(),
});

export const fdUpdateSchema = z.object({
  bank: z.string().trim().min(1, "Bank / institution is required").optional(),
  principal: z.coerce.number().min(0, "Principal amount can't be negative").optional(),
  tenureMonths: z.coerce.number().int().positive("Tenure (months) must be greater than 0").optional(),
  startMonth: z.coerce.number().int().min(1).max(12).optional(),
  startYear: z.coerce.number().int().min(1990).max(new Date().getFullYear()).optional(),
  interestRate: z.coerce.number().positive("Interest rate must be greater than 0").optional(),
  monthlyContribution: z.coerce.number().min(0).optional(),
});

export const pfUpdateSchema = z.object({
  subType: z.enum(["PPF", "EPF", "VPF"]).optional(),
  institution: z.string().trim().min(1, "Institution is required").optional(),
  openingBalance: z.coerce.number().min(0).optional(),
  monthlyContribution: z.coerce.number().min(0).optional(),
  startMonth: z.coerce.number().int().min(1).max(12).optional(),
  startYear: z.coerce.number().int().min(1990).max(new Date().getFullYear()).optional(),
  interestRatePercent: z.coerce.number().positive("Interest rate must be greater than 0").optional(),
});

export type NonFdHoldingUpdateInput = z.infer<typeof nonFdUpdateSchema>;
export type FdHoldingUpdateInput = z.infer<typeof fdUpdateSchema>;
export type PfHoldingUpdateInput = z.infer<typeof pfUpdateSchema>;

export function parseNonFdHoldingUpdate(body: unknown): NonFdHoldingUpdateInput {
  return nonFdUpdateSchema.parse(body);
}

export function parseFdHoldingUpdate(body: unknown): FdHoldingUpdateInput {
  return fdUpdateSchema.parse(body);
}

export function parsePfHoldingUpdate(body: unknown): PfHoldingUpdateInput {
  return pfUpdateSchema.parse(body);
}

/**
 * FD current/maturity value, compounded quarterly (the typical convention for
 * Indian bank FDs) — an approximation, not the exact per-bank compounding
 * rule. Optionally also carries an RD-style `monthlyContribution` (an
 * ongoing periodic deposit, alongside or instead of a lump-sum `principal`)
 * — modeled as a growing monthly annuity at the SAME nominal `interestRate`,
 * same approach as computePfValues()'s own contributionGrown, but
 * MONTHLY-compounded (the natural basis for a monthly deposit stream) rather
 * than the lump sum's quarterly convention above. A real bank RD instead
 * blends monthly deposits into quarterly compounding via a more complex
 * formula that varies bank to bank; using two different compounding bases
 * for the two components at the same headline rate is a further disclosed
 * simplification on top of the quarterly-vs-real-world one already
 * documented above, not an attempt at exact RD maturity-value replication.
 */
export function computeFdValues(input: FdHoldingInput) {
  const start = new Date(input.startYear, input.startMonth - 1, 1);
  const maturity = new Date(start);
  maturity.setMonth(maturity.getMonth() + input.tenureMonths);

  const now = new Date();
  const elapsedMonths = Math.min(
    input.tenureMonths,
    Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()))
  );

  const n = 4; // quarterly compounding — the lump-sum principal portion
  const r = input.interestRate / 100;
  const compoundLumpSum = (years: number) => input.principal * Math.pow(1 + r / n, n * years);

  const monthlyRate = r / 12;
  const contribution = input.monthlyContribution ?? 0;
  // Growing monthly annuity — approximates a steady monthlyContribution
  // compounding alongside the lump sum, rather than modeling each month's
  // exact deposit date. Same shape as computePfValues()'s own
  // contributionGrown.
  const contributionGrown = (months: number) =>
    monthlyRate === 0 ? contribution * months : contribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);

  // Raw principal + contributions to date, no interest — distinct from
  // currentValue below. Without this, an ongoing monthlyContribution would
  // silently inflate the account's apparent "gain" (currentValue minus
  // investedValue), since new contributions aren't returns — same reasoning
  // as computePfValues()'s own investedToDate. Equals `principal` exactly
  // when monthlyContribution is 0/unset, so this is a no-op for every
  // existing pure-FD holding with no contributions.
  const investedToDate = Math.round(input.principal + contribution * elapsedMonths);

  return {
    currentValue: Math.round(compoundLumpSum(elapsedMonths / 12) + contributionGrown(elapsedMonths)),
    maturityValue: Math.round(compoundLumpSum(input.tenureMonths / 12) + contributionGrown(input.tenureMonths)),
    maturityDate: maturity,
    investedToDate,
  };
}

/**
 * PF (PPF/EPF/VPF) current value — monthly-compounded, approximated the same
 * documented-simplification way computeFdValues() above already is, not the
 * exact per-scheme crediting rule: real PPF/EPF interest is CALCULATED
 * monthly (on the lowest balance between the 5th and end of month) but only
 * CREDITED to the balance once a year, so it doesn't actually compound
 * month-over-month the way this formula does — this approximation compounds
 * slightly more often than the real scheme, which very slightly overstates
 * growth at the same nominal declared rate (a small, one-directional bias,
 * not a wildly different number). Unlike computeFdValues(), this
 * deliberately does NOT return a maturityValue/maturityDate — PF's
 * "maturity" doesn't map cleanly onto a single date the way FD's does: EPF
 * has none short of retirement, and PPF's 15-year term is indefinitely
 * extendable in 5-year blocks rather than a hard end date. Modeling that
 * correctly is out of scope for v1 (see docs/PROTOTYPE_LIMITATIONS.md).
 */
export function computePfValues(input: PfHoldingInput) {
  const start = new Date(input.startYear, input.startMonth - 1, 1);
  const now = new Date();
  const elapsedMonths = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));

  const monthlyRate = input.interestRatePercent / 100 / 12;
  const openingGrown = input.openingBalance * Math.pow(1 + monthlyRate, elapsedMonths);
  // Growing monthly annuity — approximates a steady monthlyContribution
  // compounding alongside the opening balance rather than modeling each
  // month's exact contribution date.
  const contribution = input.monthlyContribution ?? 0;
  const contributionGrown =
    monthlyRate === 0 ? contribution * elapsedMonths : contribution * ((Math.pow(1 + monthlyRate, elapsedMonths) - 1) / monthlyRate);

  // Raw principal contributed to date (no interest) — distinct from
  // currentValue below. Without this, an ongoing monthlyContribution would
  // silently inflate the account's apparent "gain" (currentValue minus
  // investedValue), since new contributions aren't returns.
  const investedToDate = Math.round(input.openingBalance + contribution * elapsedMonths);

  return { currentValue: Math.round(openingGrown + contributionGrown), investedToDate };
}
