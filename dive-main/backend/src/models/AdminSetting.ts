import { Schema, model, Document } from "mongoose";
import { IHighlightStyle } from "./NotificationCategory";

export type AnnouncementLevel = "info" | "warning" | "critical";

export interface IAnnouncementValue {
  text: string;
  level: AnnouncementLevel;
  enabled: boolean;
  dismissible: boolean;
}

export interface IMaintenanceValue {
  enabled: boolean;
  message: string;
}

// The resilience-report PDF's admin-editable price (paymentService.ts::
// createReportOrder reads this, falling back to env.reportPricePaise when
// unset — see adminSettingService.ts). `originalPricePaise` is purely
// cosmetic — the struck-through "was" price the download button shows —
// `null` means don't show one at all.
export interface IReportPricingValue {
  pricePaise: number;
  originalPricePaise: number | null;
}

// One admin-editable notice per situation a renewal reminder can be about —
// trial ending (never involves a charge, see startFreeTrial's own comment:
// a free trial has no Razorpay subscription behind it at all), a normal
// auto-renewal charge, or access ending because auto-renew is off. Plain
// `{{token}}` placeholders are substituted at send time — see
// subscriptionService.ts::renderReminderTemplate for the exact token list.
// `title`/`body` also support `**bold**` and `==highlighted==` spans
// (notificationEmailService.ts::renderMarkdownToHtml); `highlightStyle` is
// this specific message's accent color/gradient/weight/size for its own
// `==highlighted==` spans — e.g. the "access ending" message might use red
// for urgency while "renewal" uses gold, since they're shown at different
// moments for different reasons.
export interface IRenewalReminderMessage {
  title: string;
  body: string;
  highlightStyle?: IHighlightStyle;
}

export interface IRenewalReminderMessages {
  trialEnding: IRenewalReminderMessage;
  renewal: IRenewalReminderMessage;
  accessEnding: IRenewalReminderMessage;
}

// `daysBefore` is a LIST now, not a single number — e.g. [7, 3, 0] fires an
// independent reminder at each of those thresholds rather than just once
// (Subscription.renewalRemindersSentDays tracks which thresholds have
// already fired for the CURRENT billing period — see subscriptionService.ts
// ::runRenewalReminderSweep). Read on every sweep run, falling back to
// env.renewalReminderDaysBefore/env.renewalReminderMessages when unset —
// see adminSettingService.ts. `enablePopup` additionally requests the
// one-time popup-card channel (dunningService.ts::notifyUser) on top of the
// always-on in-app+email delivery — off by default, since a popup is a more
// intrusive surface than the bell and email, and this feature's own
// "subscription" category has `userOptOutAllowed: false` (so this admin
// toggle is the ONLY on/off switch that exists for it — there's no
// per-user opt-out to fall back on).
export interface IRenewalReminderValue {
  daysBefore: number[];
  enablePopup: boolean;
  messages: IRenewalReminderMessages;
}

/**
 * A key/value singleton store (Phase 7 of docs/ADMIN_PANEL_PLAN.md §4.6) —
 * one document per key, `value` shaped however that key needs. Keys today:
 * `"announcement"` (IAnnouncementValue), `"maintenance"` (IMaintenanceValue),
 * `"reportPricing"` (IReportPricingValue), and `"renewalReminder"`
 * (IRenewalReminderValue) — see services/adminSettingService.ts for the
 * defaults used when a key's document doesn't exist yet (nothing is seeded
 * at boot; a missing document just means "off"/"use the env default", the
 * safe default for all of them).
 */
export interface IAdminSetting extends Document {
  key: string;
  value: IAnnouncementValue | IMaintenanceValue | IReportPricingValue | IRenewalReminderValue | Record<string, unknown>;
  updatedBy?: string;
  updatedAt: Date;
}

const adminSettingSchema = new Schema<IAdminSetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: String },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const AdminSetting = model<IAdminSetting>("AdminSetting", adminSettingSchema);
