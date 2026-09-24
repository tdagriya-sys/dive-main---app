import { Schema, model, Document } from "mongoose";

/**
 * One row per execution of a scheduled job (Phase 1 of docs/ADMIN_PANEL_PLAN.md
 * — "System health ... job runs"). Wraps the existing daily crons
 * (instrumentRefresh.cron.ts, valuationRefresh.cron.ts) so the admin System
 * screen can show "last run: 6:02am, ok, 4.1k instruments refreshed" instead
 * of only what's in the process's own stdout logs.
 */
export interface ISystemJobRun extends Document {
  job: string; // e.g. "instrumentRefresh", "valuationRefresh"
  startedAt: Date;
  finishedAt?: Date;
  ok?: boolean;
  error?: string;
  stats?: Record<string, unknown>;
  host?: string;
}

const systemJobRunSchema = new Schema<ISystemJobRun>({
  job: { type: String, required: true, index: true },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date },
  ok: { type: Boolean },
  error: { type: String },
  stats: { type: Schema.Types.Mixed },
  host: { type: String },
});

systemJobRunSchema.index({ job: 1, startedAt: -1 });

export const SystemJobRun = model<ISystemJobRun>("SystemJobRun", systemJobRunSchema);
