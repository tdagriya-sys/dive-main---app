import React from "react";
import { useDive } from "../context/DiveContext";

// docs/ADMIN_PANEL_PLAN.md §7 — "Onboarding/upload/botscan/manual-entry
// screens surface remaining quota for Freemium." Before this, the ONLY place
// a Freemium user could see their usage was the Subscription screen, and the
// only in-the-moment feedback was the PLAN_LIMIT_REACHED paywall modal —
// reactive, shown only AFTER they'd already hit the wall. This surfaces the
// same `entitlements.usage`/`entitlements.entitlements` data proactively, on
// the screen where the metered action actually happens.
const LABELS = {
  bot_scan: "Bot Scan AI extractions",
  doc_upload: "AI document extractions",
  portfolio_edit: "portfolio edits",
};

// Maps a usage key to its plan-entitlement limit field names (see
// backend/src/services/entitlementService.ts's IPlanEntitlements) — `null`
// on either means that window is unlimited.
const LIMIT_FIELDS = {
  bot_scan: { weekly: "botScanWeekly", monthly: "botScanMonthly" },
  doc_upload: { weekly: "docUploadWeekly", monthly: "docUploadMonthly" },
  portfolio_edit: { weekly: "portfolioEditWeekly", monthly: "portfolioEditMonthly" },
};

export default function UsageQuotaNote({ usageKey }) {
  const { entitlements } = useDive();
  // Renders nothing for Premium (unlimited), before entitlements has loaded,
  // or for a key with no limit configured — never a loading flicker or an
  // empty box.
  if (!entitlements || entitlements.isPremium) return null;
  const fields = LIMIT_FIELDS[usageKey];
  const usage = entitlements.usage?.[usageKey];
  if (!fields || !usage) return null;

  const weeklyLimit = entitlements.entitlements?.[fields.weekly];
  const monthlyLimit = entitlements.entitlements?.[fields.monthly];
  if (weeklyLimit == null && monthlyLimit == null) return null;

  const weeklyLeft = weeklyLimit != null ? Math.max(0, weeklyLimit - usage.weekly) : Infinity;
  const monthlyLeft = monthlyLimit != null ? Math.max(0, monthlyLimit - usage.monthly) : Infinity;
  // Same "whichever window hits first" rule enforceUsage itself applies
  // server-side — the smaller remaining count is the one that actually
  // blocks the next attempt.
  const left = Math.min(weeklyLeft, monthlyLeft);
  const windowLabel = weeklyLeft <= monthlyLeft ? "week" : "month";

  if (left <= 0) {
    return (
      <p className="text-xs font-semibold text-[var(--red)] mb-4" data-testid={`usage-quota-note-${usageKey}`}>
        You've used all your free {LABELS[usageKey]} for this {windowLabel} — upgrade to Premium for unlimited access.
      </p>
    );
  }
  return (
    <p className="text-xs text-[var(--text-tertiary)] mb-4" data-testid={`usage-quota-note-${usageKey}`}>
      {left} {LABELS[usageKey]} left on your free plan this {windowLabel}.
    </p>
  );
}
