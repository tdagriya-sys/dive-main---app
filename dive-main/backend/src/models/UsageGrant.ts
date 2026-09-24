import { Schema, model, Document, Types } from "mongoose";
import { UsageEventKey } from "./UsageEvent";

// "score_report" isn't a rolling-window metered UsageEvent key (there's no
// weekly/monthly reset for it — see this model's own comment on bonusTotal),
// so it's a grant-only key, added here rather than to UsageEventKey itself.
export type UsageGrantKey = UsageEventKey | "score_report";

/**
 * A standing, admin-granted extra allowance on top of whatever the user's
 * plan already grants for one key (Phase 6a follow-up —
 * usageService.ts::getLimits adds this to the plan's own weekly/monthly
 * limit). Independent of plan: meaningful for a Freemium user (raises their
 * otherwise-small cap) or a Premium one (bot_scan/doc_upload aren't
 * unlimited even on Premium). One row per (userId, key) — granting again
 * for the same key REPLACES the amount rather than stacking, so repeated
 * admin clicks can't silently accumulate.
 */
export interface IUsageGrant extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: UsageGrantKey;
  bonusWeekly: number;
  bonusMonthly: number;
  // "score_report" only — a flat lifetime bonus count, unlike
  // bonusWeekly/bonusMonthly's rolling windows: the resilience report has no
  // recurring reset, it's unlocked per portfolio version (see
  // paymentService.ts::ensureReportAccess), so this just raises the total
  // number of free portfolio-version-unlocks this specific user gets on top
  // of whatever their plan's own complimentaryReportDownloads already grants.
  bonusTotal?: number;
  createdAt: Date;
  updatedAt: Date;
}

const usageGrantSchema = new Schema<IUsageGrant>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, enum: ["bot_scan", "doc_upload", "portfolio_edit", "score_report"], required: true },
    bonusWeekly: { type: Number, default: 0, min: 0 },
    bonusMonthly: { type: Number, default: 0, min: 0 },
    bonusTotal: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

usageGrantSchema.index({ userId: 1, key: 1 }, { unique: true });

export const UsageGrant = model<IUsageGrant>("UsageGrant", usageGrantSchema);
