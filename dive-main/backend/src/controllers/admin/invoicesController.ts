import { Response } from "express";
import { Invoice } from "../../models/Invoice";
import { StaffRequest } from "../../middleware/auth";
import * as invoiceService from "../../services/invoiceService";

/**
 * Admin visibility into issued GST invoices (Phase 6b of
 * docs/ADMIN_PANEL_PLAN.md §5.3) — gated by `revenue.view`, same permission
 * as the rest of the Revenue surface.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listInvoices(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

  const [total, invoices] = await Promise.all([
    Invoice.countDocuments({}),
    Invoice.find({})
      .populate("userId", "name email")
      .sort({ issuedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    invoices: invoices.map((inv) => {
      const user = inv.userId as unknown as { _id: unknown; name?: string; email?: string } | null;
      return {
        id: String(inv._id),
        number: inv.number,
        userName: user?.name ?? inv.buyerName,
        userEmail: user?.email ?? inv.buyerEmail,
        totalPaise: inv.totalPaise,
        gstAmountPaise: inv.gstAmountPaise,
        issuedAt: inv.issuedAt,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

// No userId scoping (unlike the user-facing downloadMyInvoicePdf) — staff
// with `revenue.view` can pull any user's invoice, e.g. for a support ticket.
export async function downloadInvoicePdf(req: StaffRequest, res: Response) {
  const invoice = await invoiceService.getInvoiceForDownload(req.params.id);
  const pdf = await invoiceService.renderInvoicePdf(invoice);
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.number}.pdf"`);
  res.send(pdf);
}
