import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { userActivityQuerySchema, UserActivityQuery } from "../../validators/userActivity";
import { EXPORT_ROW_LIMIT, UserActivityFilters, exportUserActivityCsv, listActivityTypes, parseFilterDate, queryUserActivity } from "../../services/userActivityService";
import { recordAudit } from "../../services/auditLog";

/**
 * The admin "User Activity" page (what USERS did in the app) — deliberately a
 * separate screen from the Audit Log, which stays the staff-only trail. Viewing
 * needs `users.view`; the CSV export needs `users.export` plus a step-up
 * re-authentication, and every export is itself written to the Audit Log.
 */

function toFilters(q: UserActivityQuery): UserActivityFilters {
  const from = parseFilterDate(q.from, false);
  const to = parseFilterDate(q.to, true);
  if (q.from && !from) throw new ApiError(400, "INVALID_DATE", "The 'from' date isn't a valid date.");
  if (q.to && !to) throw new ApiError(400, "INVALID_DATE", "The 'to' date isn't a valid date.");
  if (from && to && from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "The 'from' date is after the 'to' date.");
  return {
    user: q.user || undefined,
    types: q.type ? q.type.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    group: q.group,
    from,
    to,
  };
}

export async function listActivity(req: StaffRequest, res: Response) {
  const q = userActivityQuerySchema.parse(req.query);
  const result = await queryUserActivity(toFilters(q), q.page, q.limit);
  res.status(200).json(result);
}

export async function getActivityTypes(_req: StaffRequest, res: Response) {
  res.status(200).json({ types: await listActivityTypes() });
}

export async function exportActivity(req: StaffRequest, res: Response) {
  const q = userActivityQuerySchema.parse(req.query);
  const filters = toFilters(q);
  const { csv, rowCount, truncated } = await exportUserActivityCsv(filters);

  await recordAudit(
    {
      action: "user_activity.exported",
      resourceType: "ActivityEvent",
      // Which filters were used and how many rows left the system — never the rows themselves.
      meta: { rowCount, truncated, user: q.user, type: q.type, group: q.group, from: q.from, to: q.to },
    },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="user-activity-${stamp}.csv"`);
  res.setHeader("X-Export-Row-Count", String(rowCount));
  res.setHeader("X-Export-Truncated", String(truncated));
  res.setHeader("X-Export-Row-Limit", String(EXPORT_ROW_LIMIT));
  res.status(200).send(csv);
}
