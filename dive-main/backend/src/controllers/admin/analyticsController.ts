import { Response } from "express";
import { ActivityEvent } from "../../models/ActivityEvent";
import { ActivityFirstTouch } from "../../models/ActivityFirstTouch";
import { ActivityDailyRollup } from "../../models/ActivityDailyRollup";
import { env } from "../../config/env";
import { StaffRequest } from "../../middleware/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Engagement / funnel / feature-usage analytics (Phase 1b of
 * docs/ADMIN_PANEL_PLAN.md), built entirely from `ActivityEvent` (Phase 1.1's
 * instrumentation) — no external API calls, so this stays cheap regardless of
 * user count, unlike a live Dive-Score distribution would be (deferred — see
 * the plan's own note on why computing every user's score just for a
 * histogram doesn't scale the way this does).
 */
export async function getEngagement(_req: StaffRequest, res: Response) {
  const now = new Date();
  const since1d = new Date(now.getTime() - 1 * DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [dau, wau, mau] = await Promise.all([
    ActivityEvent.distinct("userId", { ts: { $gte: since1d }, userId: { $ne: null } }),
    ActivityEvent.distinct("userId", { ts: { $gte: since7d }, userId: { $ne: null } }),
    ActivityEvent.distinct("userId", { ts: { $gte: since30d }, userId: { $ne: null } }),
  ]);

  res.status(200).json({ dau: dau.length, wau: wau.length, mau: mau.length, generatedAt: now });
}

// All-time (not time-windowed) conversion funnel — how many distinct users
// have EVER reached each stage. A simple, honest shape rather than a
// time-cohorted funnel (e.g. "of users who signed up in week N, how many
// converted by week N+2") — that needs cohort-aware aggregation, deferred
// alongside score distribution.
//
// Counts ActivityFirstTouch rows rather than running `ActivityEvent.distinct`
// — the raw events this would otherwise scan TTL-expire after
// ACTIVITY_EVENT_RETENTION_DAYS (default 180), which would make this "all
// time" figure silently shrink as old events age out. ActivityFirstTouch is
// written once, permanently, the first time a user ever fires a given event
// type (services/activityLog.ts::emitActivity), so it stays exactly correct
// regardless of the TTL.
const FUNNEL_STAGES = ["signup", "holding_added", "score_viewed", "report_purchased"] as const;

export async function getFunnel(_req: StaffRequest, res: Response) {
  const counts = await Promise.all(FUNNEL_STAGES.map((type) => ActivityFirstTouch.countDocuments({ type })));
  res.status(200).json({
    stages: FUNNEL_STAGES.map((type, i) => ({ type, distinctUsers: counts[i] })),
  });
}

// Raw event-type counts over a window — "what are people actually doing"
// (bot_scan vs doc_upload vs aa_sync etc.), independent of the funnel's fixed
// stage list. A window within the raw ActivityEvent retention period reads
// straight off it as before; a longer window also pulls in
// ActivityDailyRollup for the portion older than that (jobs/
// activityRollup.cron.ts populates one rollup row per day/type, and — unlike
// the raw events — those never expire), so asking for a year of history
// doesn't just silently return 180 days' worth.
export async function getFeatureUsage(req: StaffRequest, res: Response) {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const since = new Date(Date.now() - days * DAY_MS);
  const rawFloor = new Date(Date.now() - env.activityEventRetentionDays * DAY_MS);
  const rawSince = since > rawFloor ? since : rawFloor;

  const rawRows = await ActivityEvent.aggregate([
    { $match: { ts: { $gte: rawSince } } },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);
  const usage = new Map<string, number>(rawRows.map((r) => [r._id as string, r.count as number]));

  if (since < rawFloor) {
    const rollupRows = await ActivityDailyRollup.aggregate([
      { $match: { date: { $gte: since, $lt: rawFloor } } },
      { $group: { _id: "$type", count: { $sum: "$count" } } },
    ]);
    for (const r of rollupRows) {
      usage.set(r._id as string, (usage.get(r._id as string) || 0) + (r.count as number));
    }
  }

  const sorted = [...usage.entries()].sort((a, b) => b[1] - a[1]);
  res.status(200).json({ days, usage: sorted.map(([type, count]) => ({ type, count })) });
}
