import { Types } from "mongoose";
import { UserNotification } from "../models/UserNotification";
import { UserNotificationPref } from "../models/UserNotificationPref";
import { NotificationCategory, NotificationChannel } from "../models/NotificationCategory";
import { ApiError } from "../middleware/errorHandler";

/**
 * The logged-in user's own notification surface (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5/§7 — the real header bell, replacing
 * `frontend/src/components/AppHeader.jsx`'s client-only stub, and the
 * notification-preferences section in `screens/Preferences.jsx`).
 */

export const DEFAULT_NOTIFICATION_CATEGORIES = [
  { key: "account", label: "Account", description: "Security and account-related notices.", defaultChannels: ["in_app", "email"], userOptOutAllowed: false, isSystem: true },
  { key: "subscription", label: "Subscription & billing", description: "Changes to your plan, payments, and renewals.", defaultChannels: ["in_app", "email"], userOptOutAllowed: false, isSystem: true },
  { key: "score", label: "Dive Score", description: "Updates about your resilience score.", defaultChannels: ["in_app"], userOptOutAllowed: true, isSystem: false },
  { key: "product", label: "Product updates", description: "New features and improvements.", defaultChannels: ["in_app"], userOptOutAllowed: true, isSystem: false },
  // Promotional mail goes out from the separate marketing address, never the
  // no-reply address that sends sign-in codes (see campaignSenderService.ts).
  { key: "marketing", label: "Marketing", description: "Tips, offers, and other Divve news.", defaultChannels: ["in_app", "email"], userOptOutAllowed: true, emailSender: "marketing", isSystem: false },
];

// Mirrors index.ts's "seed if empty" convention (Instrument, then
// TicketCategory in Phase 4) — a fresh database always has a working set
// of categories, fully admin-editable afterward.
export async function seedDefaultNotificationCategoriesIfEmpty(): Promise<void> {
  const count = await NotificationCategory.countDocuments();
  if (count > 0) {
    // A database seeded before `emailSender` existed has a "marketing"
    // category with no value. Give it the marketing sender — ONLY where the
    // field is missing, so a value an admin later chose (even "system") is
    // never overwritten on a restart.
    await NotificationCategory.updateMany({ key: "marketing", emailSender: { $exists: false } }, { $set: { emailSender: "marketing" } });
    return;
  }
  await NotificationCategory.insertMany(DEFAULT_NOTIFICATION_CATEGORIES);
}

export async function listMyNotifications(userId: string, limit = 50) {
  // `_id` as a tie-breaker — two notifications created in the same
  // millisecond (e.g. a campaign fanning out to a batch of users, or two
  // notifications in quick succession in a test) would otherwise sort in
  // an arbitrary order; ObjectIds are monotonically increasing, so this
  // reliably keeps "most recent first" even on an exact deliveredAt tie.
  return UserNotification.find({ userId, channel: "in_app" }).sort({ deliveredAt: -1, _id: -1 }).limit(limit).lean();
}

// The Home-screen popup card's own feed (frontend/src/components/
// NotificationPopupCard.jsx) — deliberately separate from the bell's
// listMyNotifications above rather than one endpoint with a `channel`
// query param, since the two have different semantics: the bell shows a
// scrollable history (read AND unread), while a popup is a one-shot queue
// (unread only, oldest first so a user who hasn't opened the app in days
// sees them in the order they arrived, not skips straight to the newest).
// A popup is "shown" by the frontend calling the SAME markRead below once
// it's been displayed and dismissed — there's no separate "shown" field.
export async function listMyPopupNotifications(userId: string, limit = 5) {
  return UserNotification.find({ userId, channel: "popup", readAt: null }).sort({ deliveredAt: 1, _id: 1 }).limit(limit).lean();
}

export async function getUnreadCount(userId: string): Promise<number> {
  return UserNotification.countDocuments({ userId, channel: "in_app", readAt: null });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await UserNotification.updateOne({ _id: notificationId, userId }, { readAt: new Date() });
}

export async function markAllRead(userId: string): Promise<void> {
  await UserNotification.updateMany({ userId, channel: "in_app", readAt: null }, { readAt: new Date() });
}

export interface CategoryPreference {
  categoryKey: string;
  label: string;
  userOptOutAllowed: boolean;
  channels: { channel: NotificationChannel; enabled: boolean }[];
}

// Merges each category's own defaultChannels with the user's explicit
// overrides — an absent UserNotificationPref row means "use the default"
// (see UserNotificationPref's own comment).
export async function getPreferences(userId: string): Promise<CategoryPreference[]> {
  const [categories, prefs] = await Promise.all([
    NotificationCategory.find({}).sort({ label: 1 }).lean(),
    UserNotificationPref.find({ userId }).lean(),
  ]);
  const prefMap = new Map(prefs.map((p) => [`${p.categoryKey}:${p.channel}`, p.enabled]));

  return categories.map((c) => ({
    categoryKey: c.key,
    label: c.label,
    userOptOutAllowed: c.userOptOutAllowed,
    channels: (["in_app", "email", "popup"] as const).map((channel) => ({
      channel,
      enabled: prefMap.get(`${c.key}:${channel}`) ?? c.defaultChannels.includes(channel),
    })),
  }));
}

export async function updatePreference(userId: string, categoryKey: string, channel: NotificationChannel, enabled: boolean): Promise<void> {
  const category = await NotificationCategory.findOne({ key: categoryKey }).lean();
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Notification category not found.");
  if (!category.userOptOutAllowed) {
    throw new ApiError(400, "OPT_OUT_NOT_ALLOWED", "This category can't be turned off.");
  }
  await UserNotificationPref.updateOne(
    { userId: new Types.ObjectId(userId), categoryKey, channel },
    { $set: { enabled } },
    { upsert: true }
  );
}
