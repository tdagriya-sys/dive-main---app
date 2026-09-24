import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Lazy Redis singleton (Phase 0.2 of docs/ADMIN_PANEL_PLAN.md). Powers the
 * distributed cron lock (services/distributedLock.ts) today, and — once each
 * has its first real consumer — the BullMQ job queue (Phase 1's simulation
 * sandbox, Phase 5's notification sends), the shared rate-limit store, and
 * edit-session coalescing (both Phase 6a).
 *
 * `env.redisUrl` empty ("not configured") is a fully supported, deliberate
 * mode: every consumer of this client degrades gracefully (fail open / run
 * inline) instead of requiring Redis, so a dev machine that hasn't set it up
 * yet, and the test suite (which always blanks REDIS_URL — see
 * tests/setupEnv.ts), both keep working exactly as before Redis existed in
 * this codebase.
 */

let client: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!env.redisUrl) return null;
  if (client) return client;
  client = new Redis(env.redisUrl, {
    // Required to be null on any client BullMQ is handed (its own retry
    // policy takes over); harmless for this client's other uses (health
    // ping, distributed lock).
    maxRetriesPerRequest: null,
    // Bounded, capped backoff — a genuinely down Redis must never leave a
    // caller retrying forever. Every consumer here treats a rejected command
    // as "Redis unavailable right now" and fails open rather than waiting.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on("error", (err) => logger.warn({ err }, "[redis] connection error"));
  client.on("connect", () => logger.info("[redis] connected"));
  return client;
}

// Test-only: drop the cached client so a test that changes REDIS_URL /
// re-imports this module doesn't reuse a stale connection.
export function _resetRedisClientForTests(): void {
  if (client) client.disconnect();
  client = null;
}

export type RedisHealth = "not_configured" | "connected" | "error";

// Bounded PING — used by GET /api/health (app.ts) so a hanging Redis can
// never hang the health check itself, and by the future admin System Health
// screen (Phase 1).
export async function pingRedis(timeoutMs = 1000): Promise<RedisHealth> {
  const r = getRedisClient();
  if (!r) return "not_configured";
  try {
    await Promise.race([
      r.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs)),
    ]);
    return "connected";
  } catch (err) {
    logger.warn({ err }, "[redis] health ping failed");
    return "error";
  }
}
