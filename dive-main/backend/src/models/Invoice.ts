import { Schema, model, Document, Types } from "mongoose";

export interface IInvoiceLineItem {
  description: string;
  sacCode: string;
  quantity: number;
  unitPricePaise: number;
}

/**
 * A GST invoice for one `Payment` (Phase 6b of docs/ADMIN_PANEL_PLAN.md
 * §4.3). Generated the moment a `Payment` is marked "paid" (see
 * invoiceService.ts::generateInvoiceForPayment, called from paymentService.ts
 * and subscriptionService.ts's own "paid" transitions) — never retroactively
 * for older payments, and never for a failed one. All of `subtotalPaise` /
 * `gstAmountPaise` / `totalPaise` are computed once at issuance and stored
 * verbatim rather than recomputed on read, so a later change to the GST rate
 * or seller details never rewrites a historical invoice's numbers out from
 * under it.
 *
 * There's no persistent blob storage anywhere in this codebase (see Phase 4's
 * own note on `uploadMiddleware.ts` being in-memory only) — the PDF itself is
 * rendered on demand from these stored fields at download time
 * (invoiceService.ts::renderInvoicePdf), exactly like the existing resilience
 * -score report PDF, rather than storing a generated file anywhere.
 */
export interface IInvoice extends Document {
  _id: Types.ObjectId;
  number: string; // "DIV-INV-000001" — see invoiceService.ts::nextInvoiceNumber
  userId: Types.ObjectId;
  paymentId: Types.ObjectId;
  subscriptionId?: Types.ObjectId;
  lineItems: IInvoiceLineItem[];
  subtotalPaise: number;
  gstRatePct: number;
  gstAmountPaise: number;
  totalPaise: number;
  placeOfSupply: string;
  sellerGstin: string;
  sellerName: string;
  buyerName: string;
  buyerEmail: string;
  issuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceLineItemSchema = new Schema<IInvoiceLineItem>(
  {
    description: { type: String, required: true },
    sacCode: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unitPricePaise: { type: Number, required: true },
  },
  { _id: false }
);

const invoiceSchema = new Schema<IInvoice>(
  {
    number: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, unique: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    lineItems: { type: [invoiceLineItemSchema], required: true },
    subtotalPaise: { type: Number, required: true },
    gstRatePct: { type: Number, required: true, default: 18 },
    gstAmountPaise: { type: Number, required: true },
    totalPaise: { type: Number, required: true },
    placeOfSupply: { type: String, required: true },
    sellerGstin: { type: String, required: true },
    sellerName: { type: String, required: true },
    buyerName: { type: String, required: true },
    buyerEmail: { type: String, required: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

invoiceSchema.index({ userId: 1, issuedAt: -1 });

export const Invoice = model<IInvoice>("Invoice", invoiceSchema);
