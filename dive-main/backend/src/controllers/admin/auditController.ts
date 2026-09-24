import { Response } from "express";
import { FilterQuery } from "mongoose";
import { AuditLog, IAuditLog } from "../../models/AuditLog";
import { StaffRequest } from "../../middleware/auth";

/**
 * Audit log viewer (Phase 1 of docs/ADMIN_PANEL_PLAN.md). Read-only by
 * design — there is deliberately no update/delete route anywhere for this
 * collection (see AuditLog.ts's own comment).
 */
export async function listAuditLogs(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

  const filter: FilterQuery<IAuditLog> = {};
  if (typeof req.query.actorId === "string") filter.actorId = req.query.actorId;
  if (typeof req.query.resourceType === "string") filter.resourceType = req.query.resourceType;
  if (typeof req.query.resourceId === "string") filter.resourceId = req.query.resourceId;
  if (typeof req.query.action === "string") filter.action = req.query.action;

  const [total, entries] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ ts: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({ entries, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}
