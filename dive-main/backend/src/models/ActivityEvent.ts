import { Schema, model, Document, Types } from "mongoose";
import { env } from "../config/env";

/**
 * Raw product-analytics event stream (Phase 0 of docs/ADMIN_PANEL_PLAN.md) — the
 * in-house alternative to a third-party analytics tool. Written thin and
 * best-effort from across the app via services/activityLog.ts's `emitActivity`;
 * the admin panel's engagement/funnel/retention dashboards read aggregates off
 * this (Phase 1), and Phase 7 adds a daily rollup collection for long-horizon
 * queries.
 *
 * Raw rows self-expire via the TTL index below (default 180 days,
 * ACTIVITY_EVENT_RETENTION_DAYS) — the rollups are what's kept forever.
 */
export interface IActivityEvent extends Document {
  userId?: Types.ObjectId;
  sessionId?: string;
  type: string; // e.g. "login", "holding_added", "bot_scan", "report_purchased"
  props?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  ts: Date;
}

const activityEventSchema = new Schema<IActivityEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    sessionId: { type: String },
    type: { type: String, required: true },
    props: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    ts: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

activityEventSchema.index({ userId: 1, ts: -1 });
activityEventSchema.index({ type: 1, ts: -1 });
// TTL — Mongo bakes expireAfterSeconds in at index-creation time, so changing
// ACTIVITY_EVENT_RETENTION_DAYS later needs this index dropped and rebuilt.
activityEventSchema.index({ ts: 1 }, { expireAfterSeconds: env.activityEventRetentionDays * 24 * 60 * 60 });

export const ActivityEvent = model<IActivityEvent>("ActivityEvent", activityEventSchema);
