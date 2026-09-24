import { Response } from "express";
import { User } from "../../models/User";
import { Holding } from "../../models/Holding";
import { Payment } from "../../models/Payment";
import { ActivityEvent } from "../../models/ActivityEvent";
import { StaffRequest } from "../../middleware/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Top-line KPI snapshot (Phase 1 of docs/ADMIN_PANEL_PLAN.md — "Dashboard
 * KPIs"). Deliberately open to any authenticated staff member regardless of
 * their granted permissions (mounted with just `requireStaff`, no specific
 * `requirePermission`) — a low-sensitivity overview every staff role should
 * see on login, the same way a company dashboard greets any employee.
 */
export async function getDashboard(_req: StaffRequest, res: Response) {
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [
    totalUsers,
    newSignups7d,
    newSignups30d,
    staffCount,
    totalHoldings,
    holdingsValueAgg,
    paidReportsCount,
    revenueAgg,
    activeUserIds30d,
  ] = await Promise.all([
    User.countDocuments({ staffRole: null }),
    User.countDocuments({ staffRole: null, createdAt: { $gte: since7d } }),
    User.countDocuments({ staffRole: null, createdAt: { $gte: since30d } }),
    User.countDocuments({ staffRole: { $ne: null } }),
    Holding.countDocuments({}),
    Holding.aggregate([{ $group: { _id: null, total: { $sum: "$currentValue" } } }]),
    Payment.countDocuments({ status: "paid" }),
    Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    ActivityEvent.distinct("userId", { type: "login", ts: { $gte: since30d } }),
  ]);

  res.status(200).json({
    users: {
      total: totalUsers,
      newSignups7d,
      newSignups30d,
      active30d: activeUserIds30d.length,
      staffCount,
    },
    portfolios: {
      totalHoldings,
      totalHoldingsValue: holdingsValueAgg[0]?.total ?? 0,
    },
    revenue: {
      paidReportsCount,
      totalRevenuePaise: revenueAgg[0]?.total ?? 0,
    },
    generatedAt: now,
  });
}
