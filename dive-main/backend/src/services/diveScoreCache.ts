import { DiveScoreBreakdown } from "./diveScoreService";

/**
 * The Dive Score result cache, extracted into its own module (Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md) so both `diveScoreService.ts` (which reads/writes
 * it) and the scoring/context config services (which need to invalidate it
 * on every publish/rollback — a stale cached score must never keep showing
 * the OLD model's number after an admin changes something) can depend on it
 * without a circular import between the two.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  breakdown: DiveScoreBreakdown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedBreakdown(userId: string): DiveScoreBreakdown | undefined {
  const entry = cache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry.breakdown;
  return undefined;
}

export function setCachedBreakdown(userId: string, breakdown: DiveScoreBreakdown): void {
  cache.set(userId, { breakdown, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Called from every place a user's holdings or age (the two scoring inputs
// that live outside the already-cached price-history layer) can change:
// holdingsController's create/update/delete, aaController's AA sync, and
// userController's profile update. Also called on account deletion, purely
// for hygiene.
export function invalidateDiveScoreCache(userId: string): void {
  cache.delete(userId);
}

// A published/rolled-back scoring or context config changes the scoring
// INPUTS for every user at once, not just one — so the whole cache is
// cleared rather than trying to track which userIds might be affected. See
// services/config/scoringConfigService.ts / contextConfigService.ts.
export function invalidateAllDiveScoreCache(): void {
  cache.clear();
}
