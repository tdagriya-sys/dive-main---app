import { Schema, model, Document, Types } from "mongoose";

// "popup" — a one-time modal card shown on the Home screen the next time
// the recipient opens the web app (see notificationService.ts::
// listMyPopupNotifications and frontend/src/components/NotificationPopupCard.jsx).
// "Once" means once per notification row, exactly like the bell's own
// `readAt` — the frontend marks a popup read the moment it's dismissed, and
// a read row is never shown again.
export type NotificationChannel = "in_app" | "email" | "popup";

export type CategoryEmailSender = "system" | "marketing";

// Optional per-notification accent styling for `==highlighted text==` spans
// (see services/notificationEmailService.ts::renderMarkdownToHtml) — shared
// by the renewal-reminder message templates (AdminSetting.ts) and the
// general campaign system (NotificationTemplate.ts/NotificationCampaign.ts)
// rather than each redefining it, since the shape and rendering rules are
// identical everywhere it's used. `color` is ignored once BOTH gradient
// fields are set (a gradient needs `background-clip: text`, which itself
// requires `color: transparent` — the two can't combine). Free-text CSS
// values are deliberately constrained by validators/notification.ts's own
// regex before ever reaching here — see that file's comment for why.
export interface IHighlightStyle {
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  fontSize?: string;
}

export const highlightStyleSchema = new Schema<IHighlightStyle>(
  {
    color: { type: String },
    gradientFrom: { type: String },
    gradientTo: { type: String },
    fontWeight: { type: String, enum: ["normal", "bold"] },
    fontStyle: { type: String, enum: ["normal", "italic"] },
    fontSize: { type: String },
  },
  { _id: false }
);

// A separate, optional block (image and/or a short line of text) rendered
// ABOVE the main body — for a headline discount/countdown/announcement a
// sender wants to lead with, distinct from an inline `==highlighted==` span
// buried in a sentence (see services/notificationEmailService.ts::
// renderCalloutHtml, which is the only place this is actually rendered).
// `text` needs no `==` markers — the whole field IS highlighted, always,
// using its OWN `highlightStyle` (independent of the body's own, so e.g. a
// "New feature" callout can use a different accent than an inline mention
// in the same message). Both `text` and `imageUrl` are optional and
// independent of each other; an empty callout (neither set) renders
// nothing.
export interface INotificationCallout {
  text?: string;
  imageUrl?: string;
  // Makes the whole callout (image + text) a clickable link — an absolute
  // http(s) URL, or an app-relative path like "/?go=login". See
  // notificationEmailService.ts::sanitizeLinkUrl for the exact rules.
  linkUrl?: string;
  highlightStyle?: IHighlightStyle;
}

export const calloutSchema = new Schema<INotificationCallout>(
  {
    text: { type: String },
    imageUrl: { type: String },
    linkUrl: { type: String },
    highlightStyle: { type: highlightStyleSchema },
  },
  { _id: false }
);

// An optional call-to-action button under the message body. Rendered as a
// real styled button on email and the pop-up card, and as a simple "Label →"
// text link on the in-app bell (see notificationEmailService.ts).
export interface INotificationButton {
  label: string;
  url: string;
}

export const buttonSchema = new Schema<INotificationButton>(
  {
    label: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false }
);

/**
 * Admin-configurable notification topic (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5). `key` is what `NotificationTemplate`/
 * `NotificationCampaign`/`UserNotification`/`UserNotificationPref` all
 * store — a plain string, not a Mongo ref, for the same reason
 * `Ticket.categoryKey` is: a notification already sent keeps its category
 * label even if the category row is later edited.
 *
 * `userOptOutAllowed: false` means `UserNotificationPref` is never
 * consulted for this category — every user gets it regardless (account
 * security notices, billing/subscription state changes). Seeded categories
 * (see `services/notificationService.ts::seedDefaultNotificationCategoriesIfEmpty`):
 * `account`/`subscription` (no opt-out), `score`/`product`/`marketing`
 * (opt-out allowed). `support` is deliberately NOT seeded here — ticket
 * reply notifications (backend/src/services/ticketEmailService.ts) are a
 * separate, already-built pipeline from Phase 4; unifying the two is out of
 * scope for this phase (see this phase's own changelog entry).
 */
export interface INotificationCategory extends Document {
  _id: Types.ObjectId;
  key: string;
  label: string;
  description?: string;
  defaultChannels: NotificationChannel[];
  userOptOutAllowed: boolean;
  // Which address this category's EMAILS go out from. "system" (the default)
  // is the no-reply address (EMAIL_FROM) that also sends sign-in codes;
  // "marketing" is the separate MARKETING_EMAIL_FROM address, so promotional
  // mail's spam complaints can never hurt the no-reply address's reputation.
  // Only campaign emails to registered users consult it (email-list campaigns
  // always use the marketing address). See campaignSenderService.ts.
  emailSender: CategoryEmailSender;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationCategorySchema = new Schema<INotificationCategory>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    defaultChannels: { type: [String], enum: ["in_app", "email", "popup"], default: ["in_app"] },
    userOptOutAllowed: { type: Boolean, default: true },
    emailSender: { type: String, enum: ["system", "marketing"], default: "system" },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const NotificationCategory = model<INotificationCategory>("NotificationCategory", notificationCategorySchema);
