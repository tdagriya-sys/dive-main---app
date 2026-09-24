// Mirrors backend/src/auth/permissions.ts's PERMISSIONS array exactly — kept
// here (not fetched) since the list is small, static, and not sensitive; the
// backend is still the only place that ENFORCES any of these, this is purely
// for rendering the Roles editor's permission checkboxes. Keep in sync by
// hand, same convention as diveEngine.js's ASSET_CLASS_LABELS mirroring the
// backend's assetClass enum.
export const PERMISSIONS = [
  "users.view",
  "users.suspend",
  "users.impersonate",
  "users.export",
  "users.delete",
  "analytics.view",
  "revenue.view",
  "plans.manage",
  "subscriptions.manage",
  "subscriptions.refund",
  "scoring_config.view",
  "scoring_config.edit",
  "scoring_config.publish",
  "instruments.manage",
  "tickets.view",
  "tickets.respond",
  "tickets.assign",
  "tickets.manage",
  "notifications.send",
  "notifications.manage_templates",
  "audit.view",
  "feature_flags.manage",
  "system.view",
  "system.manage",
  "employees.manage",
  "roles.manage",
];
