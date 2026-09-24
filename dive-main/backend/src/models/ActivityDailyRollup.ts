import { Schema, model, Document } from "mongoose";

/**
 * Long-horizon `ActivityEvent` aggregate (docs/ADMIN_PANEL_PLAN.md §4.3 —
 * "Monthly rollup collection ActivityDailyRollup for long-horizon
 * aggregates"), one document per (UTC calendar day, event type). Populated
 * once daily by jobs/activityRollup.cron.ts for the day that just completed,
 * from raw `ActivityEvent` rows before they age past the 180-day TTL — this
 * document itself never expires, so a day's totals survive long after its
 * underlying raw events are gone, giving the admin Analytics screen a real
 * trend line beyond the 180-day raw window instead of the data just
 * disappearing. `date` is UTC midnight rather than an IST calendar day —
 * plain and unambiguous, and a few hours of skew at a day boundary doesn't
 * meaningfully change a TREND chart the way it would a billing calculation.
 */
export interface IActivityDailyRollup extends Document {
  date: Date; // UTC midnight of the day this row summarizes
  type: string;
  count: number; // total events of this type on this day
  newDistinctUserCount: number; // users for whom this was their first-ever event of this type (see ActivityFirstTouch)
}

const activityDailyRollupSchema = new Schema<IActivityDailyRollup>(
  {
    date: { type: Date, required: true },
    type: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    newDistinctUserCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: false }
);

// The rollup job upserts on this — re-running it for a day it already
// processed replaces that day's row rather than duplicating it.
activityDailyRollupSchema.index({ date: 1, type: 1 }, { unique: true });

export const ActivityDailyRollup = model<IActivityDailyRollup>("ActivityDailyRollup", activityDailyRollupSchema);
