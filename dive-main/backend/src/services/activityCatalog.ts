/**
 * The vocabulary of the user-activity stream: every event type the app records
 * about what USERS do, with a plain-English label and a group, so the admin
 * "User Activity" page can offer a readable filter instead of raw identifiers.
 *
 * This stream is deliberately separate from the Audit Log: the Audit Log is the
 * append-only trail of STAFF actions; this is what users did in the app.
 * (Raw rows expire after ACTIVITY_EVENT_RETENTION_DAYS — see models/ActivityEvent.ts.)
 *
 * Privacy rule for every event added here: `props` may name WHAT changed (a field
 * name, a plan key, a coupon code, a reason) but never carries a password, OTP,
 * token, or the new/old VALUE of a personal field.
 */
export type ActivityGroup = "account" | "security" | "portfolio" | "billing" | "support";

export interface ActivityTypeInfo {
  label: string;
  group: ActivityGroup;
}

export const ACTIVITY_TYPES: Record<string, ActivityTypeInfo> = {
  // account
  signup: { label: "Signed up", group: "account" },
  login: { label: "Logged in", group: "account" },
  logout: { label: "Logged out", group: "account" },
  profile_updated: { label: "Profile updated", group: "account" },
  preferences_updated: { label: "Preferences updated", group: "account" },
  data_export_requested: { label: "Requested a data export", group: "account" },
  account_deleted: { label: "Deleted their account", group: "account" },
  // security
  login_failed: { label: "Failed login", group: "security" },
  otp_failed: { label: "Wrong or expired one-time code", group: "security" },
  password_reset_requested: { label: "Requested a password reset", group: "security" },
  password_reset_completed: { label: "Reset their password", group: "security" },
  password_changed: { label: "Changed their password", group: "security" },
  password_change_failed: { label: "Password change refused (wrong current password)", group: "security" },
  session_reuse_detected: { label: "Reused an old session token", group: "security" },
  // portfolio
  holding_added: { label: "Added a holding", group: "portfolio" },
  holding_edited: { label: "Edited a holding", group: "portfolio" },
  holding_deleted: { label: "Deleted a holding", group: "portfolio" },
  doc_upload: { label: "Uploaded a document", group: "portfolio" },
  bot_scan: { label: "Ran a screen scan", group: "portfolio" },
  aa_sync: { label: "Linked accounts", group: "portfolio" },
  score_viewed: { label: "Viewed their score", group: "portfolio" },
  plan_limit_reached: { label: "Hit a plan limit", group: "portfolio" },
  // billing
  subscription_started: { label: "Started a subscription", group: "billing" },
  subscription_renewed: { label: "Subscription renewed", group: "billing" },
  subscription_cancelled: { label: "Cancelled a subscription", group: "billing" },
  subscription_reactivated: { label: "Reactivated a subscription", group: "billing" },
  coupon_redeemed: { label: "Redeemed a coupon", group: "billing" },
  payment_failed: { label: "Payment failed", group: "billing" },
  report_purchased: { label: "Bought a score report", group: "billing" },
  report_downloaded: { label: "Downloaded a score report", group: "billing" },
  // support
  ticket_created: { label: "Raised a support ticket", group: "support" },
};

export function activityLabel(type: string): string {
  return ACTIVITY_TYPES[type]?.label ?? type;
}

export function activityGroup(type: string): ActivityGroup | "other" {
  return ACTIVITY_TYPES[type]?.group ?? "other";
}
