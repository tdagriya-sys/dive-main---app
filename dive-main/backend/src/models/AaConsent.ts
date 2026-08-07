import { Schema, model, Document, Types } from "mongoose";

export type ConsentStatus = "PENDING" | "ACTIVE" | "REJECTED" | "EXPIRED" | "REVOKED";

export interface IAaConsent extends Document {
  userId: Types.ObjectId;
  consentHandle: string;
  sessionId?: string;
  status: ConsentStatus;
  fipIds: string[];
  rawResponses: Record<string, unknown>[]; // audit trail of raw Finvu responses
  createdAt: Date;
  updatedAt: Date;
}

const aaConsentSchema = new Schema<IAaConsent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    consentHandle: { type: String, required: true, unique: true },
    sessionId: { type: String },
    status: { type: String, enum: ["PENDING", "ACTIVE", "REJECTED", "EXPIRED", "REVOKED"], default: "PENDING" },
    fipIds: { type: [String], default: [] },
    rawResponses: [Schema.Types.Mixed],
  },
  { timestamps: true }
);

export const AaConsent = model<IAaConsent>("AaConsent", aaConsentSchema);
