import { Schema, model, Document, Types } from "mongoose";
import { NotificationChannel } from "./NotificationCategory";

/**
 * A user's explicit override of one category+channel's delivery (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5). Absent row = that category's
 * `defaultChannels` apply. Never consulted for a category with
 * `userOptOutAllowed: false` (see `NotificationCategory`'s own comment) —
 * `services/notificationAudienceService.ts::resolveDeliveryChannels`
 * enforces that, not this schema.
 */
export interface IUserNotificationPref extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  categoryKey: string;
  channel: NotificationChannel;
  enabled: boolean;
}

const userNotificationPrefSchema = new Schema<IUserNotificationPref>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  categoryKey: { type: String, required: true, trim: true, lowercase: true },
  channel: { type: String, enum: ["in_app", "email", "popup"], required: true },
  enabled: { type: Boolean, required: true },
});

userNotificationPrefSchema.index({ userId: 1, categoryKey: 1, channel: 1 }, { unique: true });

export const UserNotificationPref = model<IUserNotificationPref>("UserNotificationPref", userNotificationPrefSchema);
