import { Response } from "express";
import { FilterQuery } from "mongoose";
import { Payment, IPayment } from "../../models/Payment";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { refundPaymentSchema, reportPricingSchema } from "../../validators/subscription";
import * as paymentService from "../../services/paymentService";
import * as revenueAnalyticsService from "../../services/revenueAnalyticsService";
import * as adminSettingService from "../../services/adminSettingService";
import { recordAudit } from "../../services/auditLog";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Revenue detail (Phase 1b of docs/ADMIN_PANEL_PLAN.md) — today's only real
 * revenue source is the one-off ₹99 resilience-report PDF (`Payment`,
 * `purpose: "SCORE_REPORT_PDF"`); there's no subscription revenue yet
 * (Phase 6a), so this is a payment ledger + a simple daily trend rather than
 * an MRR-shaped view — that reshapes once subscriptions exist.
 */
export async function getRevenueSummary(_req: StaffRequest, res: Response) {
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const [totals, byDay] = await Promise.all([
    Payment.aggregate([
      { $match: { status: "paid" } },
      {
        $group: {
          _id: "$isMock",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
    ]),
    Payment.aggregate([
      { $match: { status: "paid", createdAt: { $gte: since30d } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const real = totals.find((t) => t._id === false) || { count: 0, amount: 0 };
  const mock = totals.find((t) => t._id === true) || { count: 0, amount: 0 };

  res.status(200).json({
    real: { count: real.count, amountPaise: real.amount },
    mock: { count: mock.count, amountPaise: mock.amount },
    totalCount: real.count + mock.count,
    totalAmountPaise: real.amount + mock.amount,
    last30dByDay: byDay.map((d) => ({ date: d._id, count: d.count, amountPaise: d.amount })),
  });
}

export async function listPayments(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const filter: FilterQuery<IPayment> = {};
  if (status) filter.status = status;

  const [total, payments] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter)
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    payments: payments.map((p) => {
      const user = p.userId as unknown as { _id: unknown; name?: string; email?: string } | null;
      return {
        id: String(p._id),
        userId: user ? String(user._id) : null,
        userName: user?.name ?? null,
        userEmail: user?.email ?? null,
        purpose: p.purpose,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        isMock: p.isMock,
        refundedAmountPaise: p.refundedAmountPaise ?? 0,
        createdAt: p.createdAt,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

// --- Phase 6b — billing polish (docs/ADMIN_PANEL_PLAN.md §9's "6b" row) ---

export async function getMrrSummary(_req: StaffRequest, res: Response) {
  const summary = await revenueAnalyticsService.getMrrSummary();
  res.status(200).json(summary);
}

export async function getPlanPerformance(_req: StaffRequest, res: Response) {
  const rows = await revenueAnalyticsService.getPlanPerformance();
  res.status(200).json({ plans: rows });
}

export async function getMrrMovement(req: StaffRequest, res: Response) {
  const months = Math.min(24, Math.max(1, parseInt(String(req.query.months ?? "6"), 10) || 6));
  const movement = await revenueAnalyticsService.getMrrMovement(months);
  res.status(200).json({ movement });
}

export async function getFailedPayments(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const { payments, total } = await revenueAnalyticsService.getFailedPayments(page, limit);
  res.status(200).json({ payments, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

// `subscriptions.refund` + step-up (routes/admin.routes.ts) — moves real
// money back to a real customer, the same bar as cancel/change-plan/grant.
export async function refundPayment(req: StaffRequest, res: Response) {
  const data = refundPaymentSchema.parse(req.body);
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");

  const before = { status: payment.status, refundedAmountPaise: payment.refundedAmountPaise ?? 0 };
  const updated = await paymentService.refundPayment(req.params.id, data.amountPaise);

  await recordAudit(
    { action: "payment.refunded", resourceType: "Payment", resourceId: String(updated._id), before, after: { refundedAmountPaise: updated.refundedAmountPaise }, meta: { amountPaise: data.amountPaise ?? updated.amount } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ payment: { id: String(updated._id), refundedAmountPaise: updated.refundedAmountPaise, refundIds: updated.refundIds } });
}

// Admin-editable resilience-report pricing (§13 changelog — "report pricing
// + complimentary downloads"). No step-up: same "instantly reversible by
// editing it again" bar as the announcement/maintenance settings
// (systemController.ts), and the same permission (`plans.manage`) plan
// price edits already use — this is the same kind of change, just for the
// one-off report instead of a subscription plan.
export async function getReportPricing(_req: StaffRequest, res: Response) {
  const pricing = await adminSettingService.getReportPricing();
  res.status(200).json(pricing);
}

export async function updateReportPricing(req: StaffRequest, res: Response) {
  const data = reportPricingSchema.parse(req.body);
  const before = await adminSettingService.getReportPricing();
  const value = await adminSettingService.setReportPricing({ pricePaise: data.pricePaise, originalPricePaise: data.originalPricePaise ?? null }, req.staff!.email);
  await recordAudit(
    { action: "admin_setting.report_pricing_updated", resourceType: "AdminSetting", resourceId: "reportPricing", before, after: value },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json(value);
}
