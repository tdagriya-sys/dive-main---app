import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { Counter } from "../models/Counter";
import { Invoice, IInvoice, IInvoiceLineItem } from "../models/Invoice";
import { Payment, IPayment, PaymentPurpose } from "../models/Payment";
import { User } from "../models/User";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";

/**
 * GST invoicing (Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3/§7.3). Every
 * in-app price is GST-inclusive, so `computeGstBreakdown` backs the 18% out
 * of the amount actually charged rather than adding it on top — the same
 * "prices already include tax" convention the plan doc's §3 locks in.
 *
 * Generation is one-way and one-shot: `generateInvoiceForPayment` is called
 * exactly once, right after a `Payment` is marked "paid" (paymentService.ts's
 * two SCORE_REPORT_PDF paths, subscriptionService.ts's mock-verify path and
 * its `subscription.charged` webhook branch) — never retroactively, and
 * silently skipped if an Invoice already exists for that payment (webhook +
 * frontend-verify races, same idempotency the rest of Phase 6a relies on).
 */

const SAC_CODE: Record<PaymentPurpose, string> = {
  // 998439 — "Other information technology services n.e.c." A reasonable
  // stand-in for a subscription/software-access charge; confirm the exact
  // SAC classification with your CA before relying on this for real GST
  // filings — that's an accounting decision, not something this code can
  // authoritatively verify.
  SCORE_REPORT_PDF: "998439",
  SUBSCRIPTION_INITIAL: "998439",
  SUBSCRIPTION_RENEWAL: "998439",
};

const LINE_ITEM_LABEL: Record<PaymentPurpose, string> = {
  SCORE_REPORT_PDF: "Divve Resilience Score Report (PDF)",
  SUBSCRIPTION_INITIAL: "Divve Premium subscription",
  SUBSCRIPTION_RENEWAL: "Divve Premium subscription renewal",
};

export function computeGstBreakdown(totalPaise: number, gstRatePct = 18): { subtotalPaise: number; gstAmountPaise: number } {
  const subtotalPaise = Math.round(totalPaise / (1 + gstRatePct / 100));
  const gstAmountPaise = totalPaise - subtotalPaise;
  return { subtotalPaise, gstAmountPaise };
}

async function nextInvoiceNumber(): Promise<string> {
  const counter = await Counter.findOneAndUpdate({ _id: "invoice_number" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `DIV-INV-${String(counter.seq).padStart(6, "0")}`;
}

export async function generateInvoiceForPayment(payment: IPayment): Promise<IInvoice | null> {
  if (payment.status !== "paid") return null;
  const existing = await Invoice.findOne({ paymentId: payment._id }).lean();
  if (existing) return null;

  const user = await User.findById(payment.userId).select("name email").lean();
  if (!user) return null;

  const { subtotalPaise, gstAmountPaise } = computeGstBreakdown(payment.amount);
  const lineItems: IInvoiceLineItem[] = [
    { description: LINE_ITEM_LABEL[payment.purpose], sacCode: SAC_CODE[payment.purpose], quantity: 1, unitPricePaise: subtotalPaise },
  ];

  const number = await nextInvoiceNumber();
  const invoice = await Invoice.create({
    number,
    userId: payment.userId,
    paymentId: payment._id,
    subscriptionId: payment.subscriptionId,
    lineItems,
    subtotalPaise,
    gstRatePct: 18,
    gstAmountPaise,
    totalPaise: payment.amount,
    placeOfSupply: env.gst.sellerState || "Not configured",
    sellerGstin: env.gst.sellerGstin || "Not configured",
    sellerName: env.gst.sellerName,
    buyerName: user.name,
    buyerEmail: user.email,
  });
  return invoice;
}

export async function listInvoicesForUser(userId: string) {
  return Invoice.find({ userId }).sort({ issuedAt: -1 }).lean();
}

export async function getInvoiceForDownload(invoiceId: string, userId?: string): Promise<IInvoice> {
  if (!Types.ObjectId.isValid(invoiceId)) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  const filter: Record<string, unknown> = { _id: invoiceId };
  if (userId) filter.userId = userId; // omitted for the admin download path, which may fetch any user's invoice
  const invoice = await Invoice.findOne(filter);
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  return invoice;
}

function fmtINR(paise: number): string {
  return "Rs. " + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 50;

export async function renderInvoicePdf(invoice: IInvoice): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(20).fillColor("#0A0A0B").text(invoice.sellerName, MARGIN, MARGIN);
  doc.fontSize(9).fillColor("#6B6B72");
  if (env.gst.isPlaceholder) {
    doc.text("PROVISIONAL — seller GSTIN not yet configured", { align: "left" });
  }
  doc.text(`GSTIN: ${invoice.sellerGstin}`);
  doc.moveDown(1.5);

  doc.fontSize(14).fillColor("#0A0A0B").text("Tax Invoice", { align: "right" });
  doc.fontSize(10).fillColor("#3F3F46");
  doc.text(`Invoice No: ${invoice.number}`, { align: "right" });
  doc.text(`Date: ${invoice.issuedAt.toLocaleDateString("en-IN")}`, { align: "right" });
  doc.text(`Place of supply: ${invoice.placeOfSupply}`, { align: "right" });
  doc.moveDown(1);

  doc.fontSize(11).fillColor("#0A0A0B").text("Billed to:");
  doc.fontSize(10).fillColor("#3F3F46").text(invoice.buyerName).text(invoice.buyerEmail);
  doc.moveDown(1.5);

  const tableTop = doc.y;
  const col = { desc: MARGIN, sac: 300, qty: 370, unit: 410, amount: 490 };
  doc.fontSize(9).fillColor("#6B6B72");
  doc.text("Description", col.desc, tableTop);
  doc.text("SAC", col.sac, tableTop);
  doc.text("Qty", col.qty, tableTop);
  doc.text("Unit (Rs.)", col.unit, tableTop);
  doc.text("Amount (Rs.)", col.amount, tableTop);
  doc.moveTo(MARGIN, tableTop + 14).lineTo(PAGE.width - MARGIN, tableTop + 14).strokeColor("#D4D4D8").stroke();

  let y = tableTop + 22;
  doc.fontSize(10).fillColor("#0A0A0B");
  for (const item of invoice.lineItems) {
    doc.text(item.description, col.desc, y, { width: 240 });
    doc.text(item.sacCode, col.sac, y);
    doc.text(String(item.quantity), col.qty, y);
    doc.text((item.unitPricePaise / 100).toFixed(2), col.unit, y);
    doc.text(((item.unitPricePaise * item.quantity) / 100).toFixed(2), col.amount, y);
    y += 20;
  }

  y += 10;
  doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).strokeColor("#D4D4D8").stroke();
  y += 14;
  doc.fontSize(10).fillColor("#3F3F46");
  doc.text("Subtotal", col.unit, y);
  doc.text(fmtINR(invoice.subtotalPaise), col.amount, y);
  y += 16;
  doc.text(`GST (${invoice.gstRatePct}%)`, col.unit, y);
  doc.text(fmtINR(invoice.gstAmountPaise), col.amount, y);
  y += 16;
  doc.fontSize(11).fillColor("#0A0A0B").text("Total", col.unit, y);
  doc.text(fmtINR(invoice.totalPaise), col.amount, y);

  doc.fontSize(8).fillColor("#A1A1AA").text(
    "This is a computer-generated invoice.",
    MARGIN,
    PAGE.height - MARGIN - 20,
    { align: "center", width: PAGE.width - MARGIN * 2 }
  );

  doc.end();
  return done;
}
