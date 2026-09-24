import { Schema, model, Document, Types } from "mongoose";

/**
 * Append-only record of every consequential action, especially staff actions in
 * the admin panel (Phase 0 of docs/ADMIN_PANEL_PLAN.md). There is deliberately
 * NO update or delete path anywhere in the app for this collection — entries are
 * written once and only ever read.
 *
 * `actorLabel` is denormalised (the actor's email/name at the time) so the trail
 * stays readable even after that user is deleted. `diff` holds a shallow
 * before/after of what changed — see services/auditLog.ts's `shallowDiff`.
 */
export interface IAuditLog extends Document {
  actorId?: Types.ObjectId;
  actorRole?: string; // "superadmin" | "admin" | "employee" | "system" | "user"
  actorLabel?: string;
  // Set when a staff member performed this while impersonating a user
  // (read-only impersonation — see the plan §8).
  impersonatingUserId?: Types.ObjectId;
  action: string; // dot-namespaced, e.g. "scoring_config.publish", "user.suspend"
  resourceType: string; // e.g. "ScoringConfig", "User", "SubscriptionPlan"
  resourceId?: string;
  diff?: { before?: unknown; after?: unknown };
  ip?: string;
  userAgent?: string;
  requestId?: string;
  meta?: Record<string, unknown>;
  ts: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    actorRole: { type: String },
    actorLabel: { type: String },
    impersonatingUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    diff: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String },
    meta: { type: Schema.Types.Mixed },
    ts: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: false }
);

// The two dominant read patterns in the admin UI: "history for this one
// resource" and "everything this staff member did, newest first".
auditLogSchema.index({ resourceType: 1, resourceId: 1, ts: -1 });
auditLogSchema.index({ actorId: 1, ts: -1 });

export const AuditLog = model<IAuditLog>("AuditLog", auditLogSchema);
