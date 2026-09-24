import { Schema, model, Document, Types } from "mongoose";
import { NotificationChannel, IHighlightStyle, highlightStyleSchema, INotificationCallout, calloutSchema, INotificationButton, buttonSchema } from "./NotificationCategory";

/**
 * A reusable, admin-authored notification (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5). `bodyMarkdown` supports a small fixed set
 * of `{{var}}` placeholders — `{{name}}`/`{{email}}`, the recipient's own —
 * substituted per-recipient at send time by
 * `services/notificationEmailService.ts::renderTemplate`. A campaign can
 * use a template by `key` (`NotificationCampaign.templateKey`) or skip this
 * entirely and author content inline (`NotificationCampaign.inlineContent`).
 *
 * `bodyMarkdown` also supports `**bold**`, `==highlighted==` spans, and
 * `![alt](url)` images (`notificationEmailService.ts::renderMarkdownToHtml`)
 * — `highlightStyle` is this template's accent color/gradient/weight/size
 * for every `==highlighted==` span, applied uniformly across whichever
 * channels this template sends on. `callout` is a separate, optional
 * headline block (its own image/text/highlightStyle) rendered ABOVE
 * `bodyMarkdown` — see NotificationCategory.ts::INotificationCallout.
 */
export interface INotificationTemplate extends Document {
  _id: Types.ObjectId;
  key: string;
  name: string;
  categoryKey: string;
  subject: string;
  bodyMarkdown: string;
  channels: NotificationChannel[];
  highlightStyle?: IHighlightStyle;
  callout?: INotificationCallout;
  button?: INotificationButton;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationTemplateSchema = new Schema<INotificationTemplate>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    categoryKey: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, required: true, trim: true },
    bodyMarkdown: { type: String, required: true },
    channels: { type: [String], enum: ["in_app", "email", "popup"], default: ["in_app"] },
    highlightStyle: { type: highlightStyleSchema },
    callout: { type: calloutSchema },
    button: { type: buttonSchema },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const NotificationTemplate = model<INotificationTemplate>("NotificationTemplate", notificationTemplateSchema);
