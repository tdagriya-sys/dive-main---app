import { randomUUID } from "crypto";
import { getRedisClient } from "../lib/redisClient";
import { logger } from "../lib/logger";

/**
 * Cross-instance mutex for the daily cron jobs (Phase 0.2 of
 * docs/ADMIN_PANEL_PLAN.md — closes docs/PRODUCTION_READINESS_AUDIT.md #7:
 * "the daily instrument-refresh cron has no distributed lock", which applies
 * equally to valuationRefresh.cron.ts). With N backend instances each running
 * node-cron's own schedule independently, every one of them fires the SAME
 * job at the same wall-clock minute — without this, that's N concurrent
 * AMFI/NSE/CoinGecko refreshes (or N concurrent holding-revaluation passes)
 * instead of one.
 *
 * Deliberately FAILS OPEN when Redis isn't configured or is unreachable: a
 * single-instance deployment (today's reality — see the deploy guide) or a
 * dev machine without Redis set up must keep working exactly as before this
 * existed, not have its cron silently stop running. The lock only PREVENTS a
 * concurrent second run; it never blocks the first, and "Redis is down" never
 * means "the job doesn't run" — only "the cross-instance guard is off."
 */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const redis = getRedisClient();
  if (!redis) {
    return await fn();
  }

  const token = randomUUID();
  let acquired = false;
  try {
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    acquired = result === "OK";
  } catch (err) {
    logger.warn({ err, key }, "[distributedLock] acquire failed — Redis unreachable, running unlocked");
    return await fn();
  }

  if (!acquired) {
    logger.info({ key }, "[distributedLock] another instance holds this lock — skipping this run");
    return undefined;
  }

  try {
    return await fn();
  } finally {
    // Compare-and-delete via a small Lua script — only release the lock if
    // it's still the one THIS run acquired, so a run that outlives its own
    // TTL (Mongo/network stalls) can never delete a lock a different
    // instance has since legitimately acquired.
    const releaseScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await redis.eval(releaseScript, 1, key, token);
    } catch (err) {
      logger.warn({ err, key }, "[distributedLock] release failed (lock will simply expire via its TTL)");
    }
  }
}
