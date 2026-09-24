import pino from "pino";
import { env } from "../config/env";

/**
 * The one structured logger for the backend (Phase 0 of
 * docs/ADMIN_PANEL_PLAN.md — replaces scattered `console.*` / `morgan`).
 *
 * - JSON lines to stdout: parseable by any log aggregator, correlatable by the
 *   `reqId` field that middleware/httpLogger.ts stamps on every request-scoped
 *   child logger.
 * - `silent` under NODE_ENV=test so the Jest output stays clean (matches the
 *   existing "skip in test" convention used by rateLimit.ts / priceHistoryService.ts).
 * - Sensitive fields are redacted here centrally so no call site has to remember
 *   to strip a token/password before logging an object.
 */
export const logger = pino({
  level: env.nodeEnv === "test" ? "silent" : env.logLevel,
  base: { service: "dive-backend" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.passwordHash",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.totpSecret",
      "*.tokenHash",
    ],
    remove: true,
  },
});
