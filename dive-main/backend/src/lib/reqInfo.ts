import { Request } from "express";

/**
 * Pulls the request-scoped context the audit log / activity stream want to
 * record (Phase 0 of docs/ADMIN_PANEL_PLAN.md), from whatever subset of an
 * Express request a caller passes. Tolerant of a partial object (tests pass a
 * bare `{ ip, headers }`) and of `req.id` being a string or number (pino-http
 * types it as `string | number`).
 */
export interface ReqInfo {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

// `id` is typed `unknown` rather than `string | number` — pino-http augments
// Express's Request.id with its own branded ReqId type, which a plain
// `string | number` parameter wouldn't structurally accept; `unknown` accepts
// any caller's shape, real or a test's bare object, and String(id) below
// stringifies whatever comes through.
type PartialReq = Partial<Pick<Request, "ip" | "headers">> & { id?: unknown };

export function reqInfo(req?: PartialReq): ReqInfo {
  if (!req) return {};
  const uaHeader = req.headers?.["user-agent"];
  return {
    ip: req.ip,
    userAgent: typeof uaHeader === "string" ? uaHeader : undefined,
    requestId: req.id != null ? String(req.id) : undefined,
  };
}
