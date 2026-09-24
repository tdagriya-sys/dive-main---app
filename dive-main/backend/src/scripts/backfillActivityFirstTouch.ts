import { connectDb, disconnectDb } from "../db/connect";
import { ActivityEvent } from "../models/ActivityEvent";
import { ActivityFirstTouch } from "../models/ActivityFirstTouch";

/**
 * One-off backfill for `ActivityFirstTouch` (post-Phase-7 gap sweep —
 * docs/ADMIN_PANEL_PLAN.md §4.3/§13i). This collection didn't exist before
 * this fix, so without a backfill the admin Analytics funnel would suddenly
 * read near-zero right after deploy (every pre-existing user's first-touch
 * row missing) until fresh activity slowly repopulated it on its own.
 *
 * Reads whatever `ActivityEvent` history is STILL within its TTL right now
 * and derives each (userId, type) pair's earliest known `ts` — necessarily a
 * best-effort "the earliest we can still see," not a true "first ever," for
 * any user whose actual first occurrence has already aged past the 180-day
 * TTL by the time this runs. There's no way to recover data that's already
 * gone, which is exactly why this should run ONCE, as soon as possible after
 * deploying this fix — the longer it waits, the more real history the TTL
 * has already reaped.
 *
 * Idempotent via `ActivityFirstTouch`'s own unique (userId, type) index — an
 * upsert here only ever fills in a row that's still missing; re-running it
 * (e.g. after a partial failure) is a safe no-op for everything already done.
 */
export async function backfillActivityFirstTouch(): Promise<{ inserted: number; alreadyPresent: number }> {
  const groups = await ActivityEvent.aggregate([
    { $match: { userId: { $ne: null } } },
    { $group: { _id: { userId: "$userId", type: "$type" }, firstAt: { $min: "$ts" } } },
  ]);

  let inserted = 0;
  let alreadyPresent = 0;
  for (const g of groups) {
    const result = await ActivityFirstTouch.updateOne(
      { userId: g._id.userId, type: g._id.type },
      { $setOnInsert: { firstAt: g.firstAt } },
      { upsert: true }
    );
    if (result.upsertedCount) inserted += 1;
    else alreadyPresent += 1;
  }

  return { inserted, alreadyPresent };
}

// Allows `npx tsx src/scripts/backfillActivityFirstTouch.ts`.
if (require.main === module) {
  connectDb()
    .then(() => backfillActivityFirstTouch())
    .then(({ inserted, alreadyPresent }) => {
      // eslint-disable-next-line no-console
      console.log(`Backfilled ${inserted} ActivityFirstTouch row(s) (${alreadyPresent} already present).`);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
