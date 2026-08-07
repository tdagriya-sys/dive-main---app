import { z } from "zod";
import { HOLDING_SOURCES } from "../models/Holding";

const objectIdRegex = /^[a-f\d]{24}$/i;
const sourceSchema = z.enum(HOLDING_SOURCES).optional();

// Same as ASSET_CLASSES minus "FD" — kept as its own literal tuple (rather than
// filtering ASSET_CLASSES at runtime) so TypeScript can narrow ManualHoldingInput
// by `assetClass === "FD"` in the controller.
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
  principal: z.coerce.number().positive("Principal amount must be greater than 0"),
  tenureMonths: z.coerce.number().int().positive("Tenure (months) must be greater than 0"),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(1990).max(new Date().getFullYear()),
  interestRate: z.coerce.number().positive("Interest rate must be greater than 0"),
  source: sourceSchema,
});

export type NonFdHoldingInput = z.infer<typeof nonFdSchema>;
export type FdHoldingInput = z.infer<typeof fdSchema>;
export type ManualHoldingInput = NonFdHoldingInput | FdHoldingInput;

/**
 * FD has a distinct field set from every other asset class (principal/tenure/
 * start-month/rate vs instrument+value), so it's validated as its own schema
 * and dispatched on `assetClass` here rather than via z.discriminatedUnion —
 * the other 10 classes share one literal-enum schema, which discriminatedUnion
 * (one schema per literal branch) doesn't fit cleanly.
 */
export function parseManualHolding(body: unknown): ManualHoldingInput {
  const assetClass = (body as { assetClass?: unknown })?.assetClass;
  return assetClass === "FD" ? fdSchema.parse(body) : nonFdSchema.parse(body);
}

/**
 * FD current/maturity value, compounded quarterly (the typical convention for
 * Indian bank FDs) — an approximation, not the exact per-bank compounding rule.
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

  const n = 4; // quarterly compounding
  const r = input.interestRate / 100;
  const compound = (years: number) => input.principal * Math.pow(1 + r / n, n * years);

  return {
    currentValue: Math.round(compound(elapsedMonths / 12)),
    maturityValue: Math.round(compound(input.tenureMonths / 12)),
    maturityDate: maturity,
  };
}
