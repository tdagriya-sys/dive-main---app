import { Schema, model, Document, Types } from "mongoose";
import { NotificationChannel, IHighlightStyle, highlightStyleSchema, INotificationCallout, calloutSchema, INotificationButton, buttonSchema } from "./NotificationCategory";

// "external" — people who are NOT Divve users: a named list of imported
// email addresses (see ExternalContact.ts), emailed only. Sent by email only,
// since there's no account to show an in-app notification or pop-up on.
export type CampaignAudienceType = "all" | "segment" | "user_ids" | "external";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";

// Four mutually-exclusive subscription-lifecycle buckets (see
// notificationAudienceService.ts::segmentFilter for exactly how each
// resolves against Subscription/Payment):
// "active_subscription" — currently has live Premium access (trialing,
//   active, or past_due, i.e. what entitlementService.ts::getActiveSubscription
//   itself would grant access to right now).
// "lapsed_payer" — paid for a real subscription at least once but has no
//   active subscription right now (the trial/plan ran out and they haven't
//   renewed or resubscribed).
// "trial_only" — claimed the one-time free trial (User.hasUsedTrial) but
//   has never made a real subscription payment, ever — including if that
//   trial has since expired.
// "never_engaged" — never claimed a trial AND never paid for a
//   subscription — hasn't touched the paid product at all yet.
export type SegmentSubscriptionFilter = "active_subscription" | "lapsed_payer" | "trial_only" | "never_engaged";

// Independent of the subscription buckets above — a user can be in either
// report-purchase bucket regardless of their subscription history.
export type SegmentReportFilter = "purchased_report" | "never_purchased_report";

/**
 * A real-user-only, bounded segment query (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5's "segment builder"). Originally narrower
 * than the plan's own list (no subscription-status filter, since
 * `Subscription` didn't exist until Phase 6a) — `subscriptionFilter`/
 * `reportFilter` closed that gap once billing data existed to filter on;
 * still no Dive Score band (same compute-cost concern §13a already flagged
 * for a live score-distribution chart), no city (`User` has no such field
 * at all). See `services/notificationAudienceService.ts` for how each field
 * resolves.
 */
export interface ICampaignSegmentQuery {
  signupFrom?: Date;
  signupTo?: Date;
  hasHoldings?: boolean;
  minHoldingsCount?: number;
  activeSinceDays?: number;
  subscriptionFilter?: SegmentSubscriptionFilter;
  reportFilter?: SegmentReportFilter;
}

export interface ICampaignInlineContent {
  subject: string;
  bodyMarkdown: string;
  highlightStyle?: IHighlightStyle;
  callout?: INotificationCallout;
  button?: INotificationButton;
}

export interface ICampaignStats {
  targeted: number;
  sent: number;
  failed: number;
  // External-list sends only: addresses left out because that person already
  // has a Divve account (they'd get the in-app version of a campaign instead,
  // never a duplicate cold email), or has unsubscribed.
  skippedRegistered?: number;
  skippedUnsubscribed?: number;
}

export interface INotificationCampaign extends Document {
  _id: Types.ObjectId;
  name: string;
  templateKey?: string;
  inlineContent?: ICampaignInlineContent;
  // A snapshot of the content actually resolved at send time (before any
  // per-recipient {{name}} substitution) — so the detail page can show
  // exactly what went out even if the template it came from is edited later.
  sentContent?: ICampaignInlineContent;
  categoryKey: string;
  channels: NotificationChannel[];
  audience: CampaignAudienceType;
  segmentQuery?: ICampaignSegmentQuery;
  userIds?: Types.ObjectId[];
  // The imported list an `audience: "external"` campaign goes to.
  externalListKey?: string;
  scheduleAt?: Date;
  status: CampaignStatus;
  stats?: ICampaignStats;
  error?: string;
  createdBy: Types.ObjectId;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const segmentQuerySchema = new Schema<ICampaignSegmentQuery>(
  {
    signupFrom: { type: Date },
    signupTo: { type: Date },
    hasHoldings: { type: Boolean },
    minHoldingsCount: { type: Number },
    activeSinceDays: { type: Number },
    subscriptionFilter: { type: String, enum: ["active_subscription", "lapsed_payer", "trial_only", "never_engaged"] },
    reportFilter: { type: String, enum: ["purchased_report", "never_purchased_report"] },
  },
  { _id: false }
);

const inlineContentSchema = new Schema<ICampaignInlineContent>(
  {
    subject: { type: String, required: true, trim: true },
    bodyMarkdown: { type: String, required: true },
    highlightStyle: { type: highlightStyleSchema },
    callout: { type: calloutSchema },
    button: { type: buttonSchema },
  },
  { _id: false }
);

const statsSchema = new Schema<ICampaignStats>(
  {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skippedRegistered: { type: Number },
    skippedUnsubscribed: { type: Number },
  },
  { _id: false }
);

const notificationCampaignSchema = new Schema<INotificationCampaign>(
  {
    name: { type: String, required: true, trim: true },
    templateKey: { type: String, trim: true, lowercase: true },
    inlineContent: { type: inlineContentSchema },
    sentContent: { type: inlineContentSchema },
    categoryKey: { type: String, required: true, trim: true, lowercase: true },
    channels: { type: [String], enum: ["in_app", "email", "popup"], default: ["in_app"] },
    audience: { type: String, enum: ["all", "segment", "user_ids", "external"], required: true },
    segmentQuery: { type: segmentQuerySchema },
    userIds: { type: [Schema.Types.ObjectId], ref: "User" },
    externalListKey: { type: String, trim: true },
    scheduleAt: { type: Date },
    status: { type: String, enum: ["draft", "scheduled", "sending", "sent", "cancelled", "failed"], default: "draft", index: true },
    stats: { type: statsSchema },
    error: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

export const NotificationCampaign = model<INotificationCampaign>("NotificationCampaign", notificationCampaignSchema);
