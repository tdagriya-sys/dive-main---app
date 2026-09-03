import { Schema, model, Document, Types } from "mongoose";

// Every real Razorpay order this app has ever created, plus (isMock: true)
// the dev-mode stand-ins created when RAZORPAY_KEY_ID/SECRET aren't set
// (see paymentService.ts) — so local development and tests can exercise the
// full order → pay → verify → download flow without a real Razorpay account.
// One purpose today (SCORE_REPORT_PDF); the field exists so a second paid
// feature later doesn't need a schema migration, just a new purpose value.
export type PaymentPurpose = "SCORE_REPORT_PDF";
export type PaymentStatus = "created" | "paid" | "failed";

export interface IPayment extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: PaymentPurpose;
  amount: number; // paise
  currency: string; // "INR"
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  status: PaymentStatus;
  isMock: boolean;
  // Snapshot of the user's User.portfolioVersion at the moment this payment
  // was marked "paid" — hasPaidForReport() (paymentService.ts) compares this
  // against the user's CURRENT portfolioVersion, so a paid report stays
  // downloadable for free until the underlying portfolio actually changes.
  // -1 while status is still "created" (not yet meaningful).
  portfolioVersionAtPayment: number;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["SCORE_REPORT_PDF"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    status: { type: String, enum: ["created", "paid", "failed"], default: "created", index: true },
    isMock: { type: Boolean, default: false },
    portfolioVersionAtPayment: { type: Number, default: -1 },
  },
  { timestamps: true }
);

// hasPaidForReport()'s exact query shape — userId + purpose + status +
// portfolioVersionAtPayment all together, every call.
paymentSchema.index({ userId: 1, purpose: 1, status: 1, portfolioVersionAtPayment: 1 });

export const Payment = model<IPayment>("Payment", paymentSchema);
