import { Schema, model, Document, Types } from "mongoose";
import { env } from "../config/env";

export type UsageEventKey = "bot_scan" | "doc_upload" | "portfolio_edit";

/**
 * One row per metered action (Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.4) —
 * enforcement counts rows in a rolling window
 * (`countDocuments({userId, key, ts: {$gte: cutoff}})`), not a
 * calendar-aligned counter, so "resets" is naturally "when the oldest
 * counted event ages out" rather than a fixed reset time. TTL-expires after
 * `USAGE_EVENT_RETENTION_DAYS` (default 35 — comfortably past the longest
 * window this app checks, 30 days) purely for storage hygiene; enforcement
 * itself only ever looks at the last 7/30 days regardless of how long rows
 * are kept.
 */
export interface IUsageEvent extends Document {
  userId: Types.ObjectId;
  key: UsageEventKey;
  ts: Date;
}

const usageEventSchema = new Schema<IUsageEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, enum: ["bot_scan", "doc_upload", "portfolio_edit"], required: true },
    ts: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

usageEventSchema.index({ userId: 1, key: 1, ts: -1 });
usageEventSchema.index({ ts: 1 }, { expireAfterSeconds: env.usageEventRetentionDays * 24 * 60 * 60 });

export const UsageEvent = model<IUsageEvent>("UsageEvent", usageEventSchema);
