import { Schema, model, Document, Types } from "mongoose";

// Every real Razorpay order/subscription charge this app has ever created,
// plus (isMock: true) the dev-mode stand-ins created when RAZORPAY_KEY_ID/
// SECRET aren't set (see paymentService.ts) — so local development and
// tests can exercise the full order → pay → verify → download flow without
// a real Razorpay account. `SUBSCRIPTION_INITIAL`/`SUBSCRIPTION_RENEWAL`
// (Phase 6a) record each individual charge Razorpay's Subscriptions API
// fires against a `Subscription` — the `Subscription` document itself is
// the source of truth for CURRENT plan/status, these rows are the ledger of
// what was actually charged, same one-purpose-value-per-feature pattern
// SCORE_REPORT_PDF already established.
export type PaymentPurpose = "SCORE_REPORT_PDF" | "SUBSCRIPTION_INITIAL" | "SUBSCRIPTION_RENEWAL";
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
  // A free unlock granted by a plan's `complimentaryReportDownloads`
  // entitlement or an admin UsageGrant (key "score_report") — see
  // paymentService.ts::ensureReportAccess. Distinguishes a genuine ₹0
  // transaction from every other paid row for admin visibility (Revenue.jsx)
  // without changing hasPaidForReport's query shape at all — a complimentary
  // row is "paid" exactly like a real one, which is the whole point: it
  // unlocks the report the same way, and stays unlocked until the portfolio
  // changes again, same as a real purchase.
  isComplimentary?: boolean;
  // Snapshot of the user's User.portfolioVersion at the moment this payment
  // was marked "paid" — hasPaidForReport() (paymentService.ts) compares this
  // against the user's CURRENT portfolioVersion, so a paid report stays
  // downloadable for free until the underlying portfolio actually changes.
  // -1 while status is still "created" (not yet meaningful). Meaningless for
  // subscription-purpose rows (left at the default).
  portfolioVersionAtPayment: number;
  // Subscription-purpose rows only (Phase 6a) — links a charge back to the
  // Subscription it renewed/started, and records a refund independently of
  // status ("paid" stays true after a partial refund; a full refund doesn't
  // retroactively become "not paid", it's still a real historical charge).
  subscriptionId?: Types.ObjectId;
  refundedAmountPaise?: number;
  refundIds?: string[];
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["SCORE_REPORT_PDF", "SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    status: { type: String, enum: ["created", "paid", "failed"], default: "created", index: true },
    isMock: { type: Boolean, default: false },
    isComplimentary: { type: Boolean, default: false },
    portfolioVersionAtPayment: { type: Number, default: -1 },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    refundedAmountPaise: { type: Number },
    refundIds: { type: [String], default: undefined },
    failureReason: { type: String },
  },
  { timestamps: true }
);

// hasPaidForReport()'s exact query shape — userId + purpose + status +
// portfolioVersionAtPayment all together, every call.
paymentSchema.index({ userId: 1, purpose: 1, status: 1, portfolioVersionAtPayment: 1 });

export const Payment = model<IPayment>("Payment", paymentSchema);
