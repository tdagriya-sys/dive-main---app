import { AdminSetting, IAnnouncementValue, IMaintenanceValue, IReportPricingValue, IRenewalReminderValue } from "../models/AdminSetting";
import { env } from "../config/env";

/**
 * Announcement banner + maintenance mode (Phase 7 of docs/ADMIN_PANEL_PLAN.md
 * §4.6/§5.3/§7). Nothing is seeded at boot — a missing document just means
 * "off", the safe default for both, so a fresh database behaves exactly like
 * every existing deploy did before this phase shipped.
 */

const DEFAULT_ANNOUNCEMENT: IAnnouncementValue = { text: "", level: "info", enabled: false, dismissible: true };
const DEFAULT_MAINTENANCE: IMaintenanceValue = { enabled: false, message: "" };

export async function getAnnouncement(): Promise<IAnnouncementValue> {
  const doc = await AdminSetting.findOne({ key: "announcement" }).lean();
  return (doc?.value as IAnnouncementValue) ?? DEFAULT_ANNOUNCEMENT;
}

export async function getMaintenance(): Promise<IMaintenanceValue> {
  const doc = await AdminSetting.findOne({ key: "maintenance" }).lean();
  return (doc?.value as IMaintenanceValue) ?? DEFAULT_MAINTENANCE;
}

export async function setAnnouncement(value: IAnnouncementValue, updatedBy: string): Promise<IAnnouncementValue> {
  await AdminSetting.findOneAndUpdate({ key: "announcement" }, { value, updatedBy }, { upsert: true });
  return value;
}

export async function setMaintenance(value: IMaintenanceValue, updatedBy: string): Promise<IMaintenanceValue> {
  await AdminSetting.findOneAndUpdate({ key: "maintenance" }, { value, updatedBy }, { upsert: true });
  // Update the cache immediately rather than merely invalidating it — a
  // toggle takes effect on the very next request in THIS process, not "up
  // to 5s later"; the TTL below only matters for a separate process (a
  // second app instance in a multi-instance deploy) picking up a change
  // made elsewhere.
  maintenanceCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Cached in-process for the maintenance-mode gate (app.ts) — that middleware
// runs on every single request, so it can't afford a DB round-trip each
// time. `setMaintenance` above keeps this process's own cache in sync
// immediately; the TTL here only bounds how stale a DIFFERENT process's copy
// can get after a change made through that other process.
let maintenanceCache: { value: IMaintenanceValue; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5000;

export async function getMaintenanceCached(): Promise<IMaintenanceValue> {
  if (maintenanceCache && maintenanceCache.expiresAt > Date.now()) return maintenanceCache.value;
  const value = await getMaintenance();
  maintenanceCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Resilience-report PDF pricing — admin-editable follow-up to the
// previously-hardcoded env.reportPricePaise (still the fallback default
// here, so an unconfigured deploy behaves exactly as before). Read on every
// order-creation and report-price lookup, same as announcement/maintenance
// above; no separate cache since neither of those hot paths (order create,
// one lightweight GET) run anywhere near app.ts's per-request rate.
const DEFAULT_REPORT_PRICING: IReportPricingValue = { pricePaise: env.reportPricePaise, originalPricePaise: null };

export async function getReportPricing(): Promise<IReportPricingValue> {
  const doc = await AdminSetting.findOne({ key: "reportPricing" }).lean();
  return (doc?.value as IReportPricingValue) ?? DEFAULT_REPORT_PRICING;
}

export async function setReportPricing(value: IReportPricingValue, updatedBy: string): Promise<IReportPricingValue> {
  await AdminSetting.findOneAndUpdate({ key: "reportPricing" }, { value, updatedBy }, { upsert: true });
  return value;
}

// Renewal/expiry reminder timing + per-situation message templates
// (jobs/renewalReminder.cron.ts) — admin-editable follow-up to
// env.renewalReminderDaysBefore, same no-seed/env-fallback pattern as
// reportPricing above. A free trial NEVER auto-charges (see
// startFreeTrial's own comment — it has no Razorpay subscription behind it
// at all), so trialEnding's default deliberately never mentions a charge
// either way, unlike renewal/accessEnding.
const DEFAULT_RENEWAL_REMINDER: IRenewalReminderValue = {
  daysBefore: env.renewalReminderDaysBefore,
  enablePopup: false,
  messages: {
    trialEnding: {
      title: "Your free trial is ending soon",
      body: "Your {{planName}} free trial ends on {{periodEnd}}. Subscribe from the Subscription screen before then to keep uninterrupted Premium access — a trial never auto-charges you.",
    },
    renewal: {
      title: "Your plan renews soon",
      body: "Your {{planName}} plan renews on {{periodEnd}}. You'll be automatically charged ₹{{price}} to continue your Premium access.",
    },
    accessEnding: {
      title: "Your Premium access is ending soon",
      body: "Your {{planName}} plan access ends on {{periodEnd}} since auto-renew is turned off. Resubscribe any time from the Subscription screen to keep your benefits without interruption.",
    },
  },
};

// Falls back to the full default (not a partial merge) unless the stored
// value has the current shape — `daysBefore` as an array plus all three
// message templates. Guards against a value saved under an earlier version
// of this setting's shape crashing the sweep instead of just needing to be
// re-saved once through the admin UI.
export async function getRenewalReminderSettings(): Promise<IRenewalReminderValue> {
  const doc = await AdminSetting.findOne({ key: "renewalReminder" }).lean();
  const value = doc?.value as IRenewalReminderValue | undefined;
  if (!value || !Array.isArray(value.daysBefore) || !value.messages) return DEFAULT_RENEWAL_REMINDER;
  // `enablePopup` postdates this setting's first shape — default it to
  // "off" for a value saved before the field existed, rather than treating
  // the whole document as stale and discarding an admin's custom messages.
  return { ...value, enablePopup: value.enablePopup ?? false };
}

export async function setRenewalReminderSettings(value: IRenewalReminderValue, updatedBy: string): Promise<IRenewalReminderValue> {
  // Dedupe + sort descending so the sweep can rely on a clean, ordered list.
  const daysBefore = [...new Set(value.daysBefore)].sort((a, b) => b - a);
  const normalized: IRenewalReminderValue = { ...value, daysBefore };
  await AdminSetting.findOneAndUpdate({ key: "renewalReminder" }, { value: normalized, updatedBy }, { upsert: true });
  return normalized;
}
