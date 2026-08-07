import { Schema, model, Document } from "mongoose";

export const ASSET_CLASSES = [
  "EQUITY",
  "MUTUAL_FUND",
  "ETF",
  "BOND",
  "REIT",
  "INVIT",
  "GOLD",
  "SILVER",
  "ULIP_INSURANCE",
  "FD",
  "CRYPTO",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export interface IInstrument extends Document {
  assetClass: AssetClass;
  symbol: string;
  name: string;
  issuer?: string;
  exchange?: string;
  isActive: boolean;
  source: string; // e.g. "NSE", "AMFI", "COINGECKO", "SEED"
  metadata: Record<string, unknown>;
  lastRefreshedAt: Date;
}

const instrumentSchema = new Schema<IInstrument>(
  {
    assetClass: { type: String, enum: ASSET_CLASSES, required: true, index: true },
    symbol: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    issuer: { type: String },
    exchange: { type: String },
    isActive: { type: Boolean, default: true, index: true },
    source: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    lastRefreshedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

instrumentSchema.index({ assetClass: 1, symbol: 1 }, { unique: true });
instrumentSchema.index({ name: "text" });

export const Instrument = model<IInstrument>("Instrument", instrumentSchema);
