import { Schema, model, Document, Types } from "mongoose";
import { ASSET_CLASSES, AssetClass } from "./Instrument";

export const HOLDING_SOURCES = ["AA", "MANUAL", "BOT", "FILE_UPLOAD"] as const;
export type HoldingSource = (typeof HOLDING_SOURCES)[number];

export interface IHolding extends Document {
  userId: Types.ObjectId;
  assetClass: AssetClass;
  instrumentId?: Types.ObjectId;
  name: string;
  investedValue: number;
  currentValue: number;
  quantity?: number;
  purchaseDate?: Date;
  extraFields: Record<string, unknown>;
  source: HoldingSource;
  sourceRef?: string; // e.g. AA consent id, upload batch id, bot scan session id
  needsReview: boolean; // true until user confirms BOT/FILE_UPLOAD parsed rows
  createdAt: Date;
  updatedAt: Date;
}

const holdingSchema = new Schema<IHolding>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assetClass: { type: String, enum: ASSET_CLASSES, required: true },
    instrumentId: { type: Schema.Types.ObjectId, ref: "Instrument" },
    name: { type: String, required: true },
    investedValue: { type: Number, required: true, min: 0 },
    currentValue: { type: Number, required: true, min: 0 },
    quantity: { type: Number },
    purchaseDate: { type: Date },
    extraFields: { type: Schema.Types.Mixed, default: {} },
    source: { type: String, enum: HOLDING_SOURCES, required: true },
    sourceRef: { type: String },
    needsReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);

holdingSchema.index({ userId: 1, assetClass: 1 });

export const Holding = model<IHolding>("Holding", holdingSchema);
