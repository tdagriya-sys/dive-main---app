import { Schema, model, Document, Types } from "mongoose";

/**
 * Permanent, per-(user, event type) "did this user ever do this before"
 * marker — the fix for a real gap in `ActivityEvent`'s all-time analytics:
 * raw events TTL-expire after `ACTIVITY_EVENT_RETENTION_DAYS` (default 180),
 * so a naive `ActivityEvent.distinct("userId", { type })` silently loses
 * distinct-user-ever counts once events age past that window (the admin
 * Analytics funnel is exactly this query — see analyticsController.ts::
 * getFunnel). This collection is written once, atomically, the FIRST time a
 * user ever fires a given event type (services/activityLog.ts::emitActivity),
 * and never touched again for that (userId, type) pair — so it stays small
 * (bounded by users × event types, not by event volume) and, unlike the raw
 * events it's derived from, never expires. `getFunnel` counts rows here
 * instead of running `distinct` against `ActivityEvent`, so the funnel stays
 * exactly correct forever, independent of the TTL.
 */
export interface IActivityFirstTouch extends Document {
  userId: Types.ObjectId;
  type: string;
  firstAt: Date;
}

const activityFirstTouchSchema = new Schema<IActivityFirstTouch>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    firstAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false }
);

// The upsert in emitActivity relies on this being unique — it's what makes
// "insert only if this is truly the first one" atomic and race-safe.
activityFirstTouchSchema.index({ userId: 1, type: 1 }, { unique: true });

export const ActivityFirstTouch = model<IActivityFirstTouch>("ActivityFirstTouch", activityFirstTouchSchema);
