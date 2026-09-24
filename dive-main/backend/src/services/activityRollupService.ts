import { ActivityEvent } from "../models/ActivityEvent";
import { ActivityFirstTouch } from "../models/ActivityFirstTouch";
import { ActivityDailyRollup } from "../models/ActivityDailyRollup";

/**
 * Long-horizon `ActivityEvent` rollup (docs/ADMIN_PANEL_PLAN.md §4.3, §12
 * decision #10) — run once daily by jobs/activityRollup.cron.ts, well after
 * the raw `ActivityEvent` TTL (`ACTIVITY_EVENT_RETENTION_DAYS`, default 180
 * days) so the day being summarized still has all of its raw rows intact.
 */

// The event types worth rolling up — the same list docs/ADMIN_PANEL_PLAN.md
// §4.3 names for ActivityEvent, not "whatever distinct `type` strings happen
// to exist" — so a stray or malformed type never becomes a permanent rollup
// row on its own.
const ROLLUP_TYPES = [
  "signup",
  "login",
  "logout",
  "session_restore",
  "holding_added",
  "holding_edited",
  "holding_deleted",
  "aa_sync",
  "bot_scan",
  "doc_upload",
  "score_viewed",
  "breakdown_viewed",
  "report_purchased",
  "report_downloaded",
  "subscription_started",
  "subscription_renewed",
  "subscription_cancelled",
  "plan_limit_reached",
  "ticket_created",
  "notification_opened",
  "feature_used",
] as const;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface RollupSummary {
  date: Date;
  typesRolledUp: number;
  totalEvents: number;
}

// Rolls up ONE UTC calendar day's raw ActivityEvent rows into permanent
// ActivityDailyRollup documents — one per event type that had any activity
// that day. `newDistinctUserCount` comes from ActivityFirstTouch (its
// `firstAt` is written from the exact same timestamp as the triggering
// ActivityEvent — see activityLog.ts::emitActivity — so filtering it to this
// same day window is already exactly "users for whom this was their first
// ever occurrence of this type, on this day," no extra join needed).
// Idempotent (upsert): safe to re-run for a day already rolled up, which is
// what makes the cron safe to retry or invoke manually.
export async function rollUpActivityForDay(day: Date): Promise<RollupSummary> {
  const dayStart = startOfUtcDay(day);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  let typesRolledUp = 0;
  let totalEvents = 0;
  for (const type of ROLLUP_TYPES) {
    const [count, newDistinctUserCount] = await Promise.all([
      ActivityEvent.countDocuments({ type, ts: { $gte: dayStart, $lt: dayEnd } }),
      ActivityFirstTouch.countDocuments({ type, firstAt: { $gte: dayStart, $lt: dayEnd } }),
    ]);
    if (count === 0 && newDistinctUserCount === 0) continue;

    await ActivityDailyRollup.findOneAndUpdate({ date: dayStart, type }, { $set: { count, newDistinctUserCount } }, { upsert: true });
    typesRolledUp += 1;
    totalEvents += count;
  }

  return { date: dayStart, typesRolledUp, totalEvents };
}

// Rolls up "yesterday" (UTC) — the most recently fully-completed day. Run
// once daily, well after midnight, so every one of that day's events has
// already landed by the time this reads them.
export async function runActivityRollup(): Promise<RollupSummary> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return rollUpActivityForDay(yesterday);
}
