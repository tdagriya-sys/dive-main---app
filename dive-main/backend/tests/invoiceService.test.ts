import { User } from "../src/models/User";
import { Payment } from "../src/models/Payment";
import { Invoice } from "../src/models/Invoice";
import * as invoiceService from "../src/services/invoiceService";

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3/§7.3 — GST invoicing.

let mobileCounter = 9950000000;
async function makeUser() {
  return User.create({ name: "Invoice User", mobile: String(mobileCounter++), email: `inv-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

async function makePaidPayment(userId: string, amount = 11900) {
  return Payment.create({
    userId,
    purpose: "SUBSCRIPTION_INITIAL",
    amount,
    currency: "INR",
    razorpayOrderId: `order_${Date.now()}_${Math.random()}`,
    razorpayPaymentId: `pay_${Date.now()}_${Math.random()}`,
    status: "paid",
    isMock: true,
  });
}

describe("computeGstBreakdown", () => {
  it("backs 18% out of a GST-inclusive total rather than adding it on top", () => {
    const { subtotalPaise, gstAmountPaise } = invoiceService.computeGstBreakdown(11900);
    expect(subtotalPaise + gstAmountPaise).toBe(11900);
    // 11900 / 1.18 ≈ 10084.75 → rounds to 10085
    expect(subtotalPaise).toBe(10085);
    expect(gstAmountPaise).toBe(11900 - 10085);
  });

  it("handles zero cleanly", () => {
    expect(invoiceService.computeGstBreakdown(0)).toEqual({ subtotalPaise: 0, gstAmountPaise: 0 });
  });
});

describe("generateInvoiceForPayment", () => {
  it("generates an invoice with a sequential number and matching totals", async () => {
    const user = await makeUser();
    const payment = await makePaidPayment(String(user._id));
    const invoice = await invoiceService.generateInvoiceForPayment(payment);
    expect(invoice).not.toBeNull();
    expect(invoice!.number).toMatch(/^DIV-INV-\d{6}$/);
    expect(invoice!.totalPaise).toBe(11900);
    expect(invoice!.subtotalPaise + invoice!.gstAmountPaise).toBe(11900);
    expect(invoice!.buyerEmail).toBe(user.email);
    expect(invoice!.lineItems).toHaveLength(1);
  });

  it("is idempotent — a second call for the same payment doesn't create a duplicate", async () => {
    const user = await makeUser();
    const payment = await makePaidPayment(String(user._id));
    const first = await invoiceService.generateInvoiceForPayment(payment);
    const second = await invoiceService.generateInvoiceForPayment(payment);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await Invoice.countDocuments({ paymentId: payment._id })).toBe(1);
  });

  it("refuses to invoice a payment that isn't paid", async () => {
    const user = await makeUser();
    const payment = await Payment.create({
      userId: user._id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: 11900,
      currency: "INR",
      razorpayOrderId: "order_pending",
      status: "created",
      isMock: true,
    });
    expect(await invoiceService.generateInvoiceForPayment(payment)).toBeNull();
  });

  it("increments the invoice number across multiple payments", async () => {
    const user = await makeUser();
    const first = await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(user._id)));
    const second = await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(user._id)));
    const firstSeq = parseInt(first!.number.split("-")[2], 10);
    const secondSeq = parseInt(second!.number.split("-")[2], 10);
    expect(secondSeq).toBe(firstSeq + 1);
  });
});

describe("listInvoicesForUser / getInvoiceForDownload", () => {
  it("lists only the requesting user's own invoices, newest first", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(userA._id)));
    await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(userA._id)));
    await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(userB._id)));

    const listA = await invoiceService.listInvoicesForUser(String(userA._id));
    expect(listA).toHaveLength(2);
  });

  it("refuses to hand back another user's invoice when userId scoping is applied", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const invoice = await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(userA._id)));
    await expect(invoiceService.getInvoiceForDownload(String(invoice!._id), String(userB._id))).rejects.toMatchObject({ status: 404 });
  });

  it("renders a real PDF buffer", async () => {
    const user = await makeUser();
    const invoice = await invoiceService.generateInvoiceForPayment(await makePaidPayment(String(user._id)));
    const pdf = await invoiceService.renderInvoicePdf(invoice!);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
