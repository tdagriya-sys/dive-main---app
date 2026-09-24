import * as Sentry from "@sentry/node";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Error tracking (Phase 0.2 of docs/ADMIN_PANEL_PLAN.md — closes
 * docs/PRODUCTION_READINESS_AUDIT.md #24's "no Sentry/APM integration" half).
 *
 * A no-op with no `SENTRY_DSN` set — same "placeholder/unset means inert, not
 * fake-real" convention as every other integration in config/env.ts (Finvu,
 * Razorpay, email, AI extraction). Never called under NODE_ENV=test.
 */
export function initSentry(): void {
  if (!env.sentryDsn || env.nodeEnv === "test") return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: 0,
  });
  logger.info("[sentry] initialized");
}

// Safe to call unconditionally from anywhere an unexpected error is caught —
// a no-op (never throws) before initSentry() has run or when it was never
// configured at all.
export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  if (!env.sentryDsn || env.nodeEnv === "test") return;
  try {
    Sentry.captureException(err, extra ? { extra } : undefined);
  } catch (captureErr) {
    logger.warn({ err: captureErr }, "[sentry] captureException itself failed");
  }
}
