import { Request } from "express";
import { AuditLog } from "../models/AuditLog";
import { logger } from "../lib/logger";
import { reqInfo } from "../lib/reqInfo";

/**
 * The one way to write an audit entry (Phase 0 of docs/ADMIN_PANEL_PLAN.md).
 * Called from every admin mutation and from sensitive user-facing events
 * (password change, account delete, payment state changes).
 *
 * Best-effort: a failed write is logged at `error` level (so it's alertable)
 * but never throws — an audit outage must not take down the action being
 * audited. Phase 3 revisits whether the most critical actions (role changes,
 * config publishes) should instead hard-fail if they can't be recorded.
 */

export interface AuditActor {
  actorId?: string;
  actorRole?: string; // "superadmin" | "admin" | "employee" | "system" | "user"
  actorLabel?: string; // email/name snapshot, for a trail that survives user deletion
  impersonatingUserId?: string;
}

export interface AuditEntryInput {
  action: string; // dot-namespaced, e.g. "scoring_config.publish"
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

// `id` typed `unknown` — see lib/reqInfo.ts's own PartialReq for why.
type PartialReq = Partial<Pick<Request, "ip" | "headers">> & { id?: unknown };

// Compares two plain objects at the top level only and returns just the keys
// that actually changed, on both sides — so the stored diff is small and
// readable ("what did this publish change?") rather than a full document dump.
export function shallowDiff(
  before: unknown,
  after: unknown
): { before?: Record<string, unknown>; after?: Record<string, unknown> } | undefined {
  const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isPlain(before) && !isPlain(after)) {
    if (before === undefined && after === undefined) return undefined;
    return { before: before as never, after: after as never };
  }
  const b = isPlain(before) ? before : {};
  const a = isPlain(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  let any = false;
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
      any = true;
      changedBefore[k] = b[k];
      changedAfter[k] = a[k];
    }
  }
  return any ? { before: changedBefore, after: changedAfter } : undefined;
}

export async function recordAudit(
  input: AuditEntryInput,
  actor: AuditActor = {},
  req?: PartialReq
): Promise<void> {
  try {
    const { ip, userAgent, requestId } = reqInfo(req);
    const diff =
      input.before !== undefined || input.after !== undefined
        ? shallowDiff(input.before, input.after)
        : undefined;
    await AuditLog.create({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      actorLabel: actor.actorLabel,
      impersonatingUserId: actor.impersonatingUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      diff,
      ip,
      userAgent,
      requestId,
      meta: input.meta,
      ts: new Date(),
    });
  } catch (err) {
    logger.error({ err, action: input.action, resourceType: input.resourceType }, "AUDIT_WRITE_FAILED");
  }
}
