import { Request } from "express";
import { ActivityEvent } from "../models/ActivityEvent";
import { ActivityFirstTouch } from "../models/ActivityFirstTouch";
import { logger } from "../lib/logger";
import { reqInfo } from "../lib/reqInfo";

/**
 * Emit a product-analytics event (Phase 0 of docs/ADMIN_PANEL_PLAN.md).
 *
 * Designed to be called WITHOUT `await` from request handlers — it never throws
 * and returns a promise only so tests (and a future batching layer) can wait on
 * it. A failed write is a warning, not an error: losing an analytics row must
 * never affect the user's request. Phase 1 adds a queue-backed batch writer
 * behind this same function signature.
 */

// `id` typed `unknown` — see lib/reqInfo.ts's own PartialReq for why.
type PartialReq = Partial<Pick<Request, "ip" | "headers">> & { id?: unknown };

export interface EmitActivityOptions {
  userId?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
  req?: PartialReq;
}

export function emitActivity(type: string, opts: EmitActivityOptions = {}): Promise<void> {
  const { ip, userAgent } = reqInfo(opts.req);
  const ts = new Date();

  // Permanent, one-time-per-(user, type) marker — see ActivityFirstTouch's
  // own comment for why this exists (the raw event below TTL-expires; this
  // never does, so admin/analyticsController.ts::getFunnel can count
  // distinct-users-ever without silently losing data past that window). A
  // plain insert against the model's unique (userId, type) index IS the
  // atomicity — a duplicate-key error (code 11000) just means this user has
  // already done `type` before, the expected, common case, not a failure.
  const firstTouch = opts.userId
    ? ActivityFirstTouch.create({ userId: opts.userId, type, firstAt: ts }).catch((err) => {
        if ((err as { code?: number })?.code !== 11000) {
          logger.warn({ err, type }, "ACTIVITY_FIRST_TOUCH_FAILED");
        }
      })
    : Promise.resolve();

  const event = ActivityEvent.create({
    userId: opts.userId,
    sessionId: opts.sessionId,
    type,
    props: opts.props,
    ip,
    userAgent,
    ts,
  }).catch((err) => {
    logger.warn({ err, type }, "ACTIVITY_EMIT_FAILED");
  });

  return Promise.all([event, firstTouch]).then(() => undefined);
}
