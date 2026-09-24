import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { env } from "../config/env";

/**
 * Request logging + request-id propagation (Phase 0 of docs/ADMIN_PANEL_PLAN.md).
 *
 * Every request gets a stable id: an inbound `X-Request-Id` is trusted if
 * present (so a reverse proxy / the frontend can correlate), otherwise a fresh
 * UUID is minted. The id is echoed back in the response header AND attached as
 * `req.id`, and `req.log` is a child logger already bound to it — the audit
 * helper (services/auditLog.ts) reads `req.id` so an admin action in the audit
 * trail can be tied back to its full request log.
 *
 * `autoLogging` is off under test to keep Jest output clean.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const inbound = req.headers["x-request-id"];
    const id = (typeof inbound === "string" && inbound.trim()) || randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  autoLogging: env.nodeEnv !== "test",
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
});
