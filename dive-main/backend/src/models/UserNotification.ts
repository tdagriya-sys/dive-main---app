import { Schema, model, Document, Types } from "mongoose";
import { NotificationChannel } from "./NotificationCategory";

/**
 * One delivered notification, in-app, email, or popup (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5). Powers the header bell
 * (`frontend/src/components/AppHeader.jsx`, previously a client-only stub
 * — see this phase's own changelog entry) AND, for `channel: "popup"` rows,
 * `frontend/src/components/NotificationPopupCard.jsx` — a one-time modal
 * shown on the Home screen. `readAt` is set the moment the bell panel is
 * opened (mirrors the old stub's own "opening marks everything read"
 * behavior), or, for a popup row, the moment it's dismissed — a popup row
 * is never shown again once `readAt` is set, exactly like the bell.
 *
 * One row per (recipient, channel) — a campaign sent on `in_app`, `email`,
 * AND `popup` creates THREE rows per recipient, so "opened"/"seen" (readAt
 * set) is trackable per channel rather than conflated across all three.
 *
 * `bodyHtml` is `body` pre-rendered through
 * `notificationEmailService.ts::renderMarkdownToHtml` (bold + `==highlight==`
 * spans) at send time, using whatever `IHighlightStyle` the sender resolved
 * THEN — stored rather than re-rendered live so a template edited after
 * sending doesn't retroactively change a notification already delivered.
 * Only ever set for `email`/`popup` rows; the bell's plain-text list keeps
 * reading `body` directly.
 */
export interface IUserNotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  campaignId?: Types.ObjectId;
  categoryKey: string;
  title: string;
  body: string;
  bodyHtml?: string;
  link?: string;
  // The campaign button's label, when a campaign had one — the bell shows
  // `link` as a simple "linkLabel →" text link under the message.
  linkLabel?: string;
  channel: NotificationChannel;
  deliveredAt: Date;
  readAt?: Date;
  emailStatus?: "queued" | "sent" | "bounced" | "failed";
}

const userNotificationSchema = new Schema<IUserNotification>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: "NotificationCampaign", index: true },
  categoryKey: { type: String, required: true, trim: true, lowercase: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  bodyHtml: { type: String },
  link: { type: String },
  linkLabel: { type: String },
  channel: { type: String, enum: ["in_app", "email", "popup"], required: true },
  deliveredAt: { type: Date, required: true, default: () => new Date() },
  readAt: { type: Date },
  emailStatus: { type: String, enum: ["queued", "sent", "bounced", "failed"] },
});

userNotificationSchema.index({ userId: 1, deliveredAt: -1 });

export const UserNotification = model<IUserNotification>("UserNotification", userNotificationSchema);
