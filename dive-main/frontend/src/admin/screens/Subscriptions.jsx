import React, { useState, useEffect, useRef } from "react";
import { Loader2, Plus, Search, History, X } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";
import HighlightStyleFields from "../HighlightStyleFields";

function fmtINR(paise) {
  return "₹" + Math.round((paise || 0) / 100).toLocaleString("en-IN");
}

// Text form <-> array form for the "days before" thresholds. Kept as free
// text while editing (not a number input) since it's a LIST now — e.g.
// "7, 3, 0" fires an independent reminder at each of 7 days out, 3 days
// out, and the day it happens (see subscriptionService.ts::
// runRenewalReminderSweep). Invalid/blank entries are just dropped rather
// than blocking typing; the Save button's own disabled state is what
// prevents submitting something empty.
function parseDaysBeforeText(text) {
  return [...new Set(text.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 30))].sort((a, b) => b - a);
}

const REMINDER_CATEGORIES = [
  { key: "trialEnding", label: "Trial ending", hint: "Sent for a free trial — never mention a charge, a trial has no auto-billing behind it at all." },
  { key: "renewal", label: "Renewal (auto-renew on)", hint: "Sent for a paying subscriber who will be charged again automatically." },
  { key: "accessEnding", label: "Access ending (auto-renew off)", hint: "Sent when auto-renew is off — self-cancelled, or the plan was archived." },
];
const REMINDER_TOKENS = ["planName", "periodEnd", "price", "daysRemaining"];

// How many days before currentPeriodEnd jobs/renewalReminder.cron.ts warns a
// subscriber about an upcoming renewal charge, trial ending, or access
// lapsing, plus the exact wording sent for each situation (see
// backend/src/services/adminSettingService.ts::getRenewalReminderSettings).
// Same "instantly reversible, no step-up" pattern as Revenue.jsx's
// ReportPricingCard.
function RenewalReminderCard({ settings, onSave, saving, saved }) {
  const [daysBeforeText, setDaysBeforeText] = useState(settings.daysBefore.join(", "));
  const [enablePopup, setEnablePopup] = useState(!!settings.enablePopup);
  const [messages, setMessages] = useState(settings.messages);

  const daysBefore = parseDaysBeforeText(daysBeforeText);
  const dirty =
    JSON.stringify(daysBefore) !== JSON.stringify(settings.daysBefore) ||
    enablePopup !== !!settings.enablePopup ||
    JSON.stringify(messages) !== JSON.stringify(settings.messages);
  const canSave = daysBefore.length > 0 && REMINDER_CATEGORIES.every((c) => messages[c.key]?.title?.trim() && messages[c.key]?.body?.trim());

  function updateMessage(key, field, value) {
    setMessages((m) => ({ ...m, [key]: { ...m[key], [field]: value } }));
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-subscriptions-renewal-reminder-card">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Renewal reminder</p>
      <p className="text-xs text-[var(--text-secondary)] mb-3">
        Warns a subscriber (in-app + email) ahead of a renewal charge, a trial ending, or access lapsing. Set as many day-thresholds as you like — each fires its own reminder.
      </p>

      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-3 max-w-sm">
        Days before (comma-separated, e.g. 7, 3, 0)
        <input
          type="text"
          data-testid="admin-renewal-reminder-days-input"
          value={daysBeforeText}
          onChange={(e) => setDaysBeforeText(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-4">
        <input type="checkbox" data-testid="admin-renewal-reminder-popup-checkbox" checked={enablePopup} onChange={(e) => setEnablePopup(e.target.checked)} />
        Also show as a pop-up card the next time the subscriber opens the app (shown once, then dismissed for good)
      </label>

      <div className="grid md:grid-cols-3 gap-3 mb-4">
        {REMINDER_CATEGORIES.map((c) => (
          <div key={c.key} className="rounded-xl border border-[var(--border)] p-3">
            <p className="text-xs font-bold mb-1">{c.label}</p>
            <p className="text-[10px] text-[var(--text-tertiary)] mb-2">{c.hint}</p>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2">
              Title
              <input
                type="text"
                data-testid={`admin-renewal-reminder-${c.key}-title-input`}
                value={messages[c.key]?.title ?? ""}
                onChange={(e) => updateMessage(c.key, "title", e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2">
              Body
              <textarea
                rows={3}
                data-testid={`admin-renewal-reminder-${c.key}-body-input`}
                value={messages[c.key]?.body ?? ""}
                onChange={(e) => updateMessage(c.key, "body", e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs outline-none resize-y"
              />
            </label>
            <p className="text-[10px] text-[var(--text-secondary)] mb-1">Highlight style — applies to every ==highlighted== span below. Only shows on email/pop-up; the bell (in-app) shows plain text with bold only.</p>
            <HighlightStyleFields
              testIdPrefix={`admin-renewal-reminder-${c.key}-highlight`}
              value={messages[c.key]?.highlightStyle}
              onChange={(style) => updateMessage(c.key, "highlightStyle", style)}
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Available tokens: {REMINDER_TOKENS.map((t) => `{{${t}}}`).join(", ")}</p>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-3">Formatting: **bold text**, and ==highlighted text== to apply that category's highlight style above.</p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="admin-renewal-reminder-save-btn"
          disabled={saving || !dirty || !canSave}
          onClick={() => onSave({ daysBefore, enablePopup, messages })}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {!dirty && saved && <span className="text-xs text-[var(--green)] font-bold">Saved</span>}
      </div>
    </div>
  );
}

const STATUS_BADGE = {
  trialing: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  active: "bg-[var(--green)]/10 text-[var(--green)]",
  past_due: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  cancelled: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
  expired: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

const EMPTY_ENTITLEMENTS = {
  botScanWeekly: 1, botScanMonthly: 3, docUploadWeekly: 1, docUploadMonthly: 3,
  portfolioEditWeekly: 2, portfolioEditMonthly: 5, dailyRevaluation: false, earlyAccess: false, priorityWeight: 0,
  complimentaryReportDownloads: 0,
};

// Requirement: the grant forms need to be workable by email, not just the
// raw Mongo _id (which was never discoverable from the admin UI at all) —
// reused by both GrantForm (complimentary subscription) and
// UsageBonusForm (extra key limits). Debounced search against the SAME
// `GET /admin/users?q=` list endpoint UsersList.jsx already uses (250ms,
// mirroring that screen's own convention) — its email is masked for
// privacy in list view, so selecting a match fills the field with the
// user's real, unmasked `id` instead (resolveUserRef accepts either),
// while showing the picked name/email as a plain-text confirmation label.
function UserPicker({ testIdPrefix, value, onChange, selectedLabel, onSelect, placeholder = "Name, email, or user ID" }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/admin/users", { params: { q: query, limit: 5 } });
        if (!cancelled) setMatches(data.users);
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="relative">
      {selectedLabel ? (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-card-hover)] px-2 py-1.5 text-sm" data-testid={`${testIdPrefix}-selected`}>
          <span className="truncate">{selectedLabel}</span>
          <button type="button" onClick={() => { onChange(""); onSelect(null); setQuery(""); }} className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5">
          <Search size={13} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            data-testid={`${testIdPrefix}-input`}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)} // lets an onMouseDown selection register first
            placeholder={placeholder}
            className="w-full bg-transparent text-sm outline-none"
          />
          {searching && <Loader2 size={13} className="animate-spin text-[var(--text-tertiary)] shrink-0" />}
        </div>
      )}
      {showDropdown && !selectedLabel && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] shadow-lg overflow-hidden" data-testid={`${testIdPrefix}-dropdown`}>
          {matches.map((u) => (
            <button
              key={u.id}
              type="button"
              data-testid={`${testIdPrefix}-option-${u.id}`}
              onMouseDown={() => {
                onChange(u.id);
                onSelect(u);
                setShowDropdown(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-card-hover)]"
            >
              <span className="font-bold">{u.name}</span> <span className="text-[var(--text-tertiary)]">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GrantForm({ onGrant }) {
  const [open, setOpen] = useState(false);
  const [userIdOrEmail, setUserIdOrEmail] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [planKey, setPlanKey] = useState("premium_monthly");
  const [days, setDays] = useState(30);

  function reset() {
    setUserIdOrEmail("");
    setSelectedUser(null);
  }

  if (!open) {
    return (
      <button type="button" data-testid="admin-subscriptions-grant-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> Grant complimentary
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4">
      <div className="grid grid-cols-3 gap-2 mb-2">
        <UserPicker
          testIdPrefix="admin-subscriptions-grant-user"
          value={userIdOrEmail}
          onChange={setUserIdOrEmail}
          selectedLabel={selectedUser ? `${selectedUser.name} (${selectedUser.email})` : null}
          onSelect={setSelectedUser}
        />
        <select data-testid="admin-subscriptions-grant-plan-select" value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="premium_monthly">Premium (Monthly)</option>
          <option value="premium_annual">Premium (Annual)</option>
        </select>
        <input data-testid="admin-subscriptions-grant-days-input" type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-subscriptions-grant-submit-btn"
          disabled={!userIdOrEmail.trim()}
          onClick={async () => {
            await onGrant({ userIdOrEmail: userIdOrEmail.trim(), planKey, days });
            reset();
            setOpen(false);
          }}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          Grant
        </button>
      </div>
    </div>
  );
}

function SubscriptionRow({ s, onCancel, onChangePlan, onViewHistory }) {
  const [planKey, setPlanKey] = useState(s.planKey);
  return (
    <tr className="border-b border-[var(--border)] last:border-0" data-testid={`admin-subscriptions-row-${s.id}`}>
      <td className="px-4 py-3 font-bold">{s.userName || s.userEmail || s.userId}</td>
      <td className="px-4 py-3">
        <select data-testid={`admin-subscriptions-planselect-${s.id}`} value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none">
          <option value="premium_monthly">premium_monthly</option>
          <option value="premium_annual">premium_annual</option>
        </select>
      </td>
      <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[s.status] || ""}`}>{s.status}</span></td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{new Date(s.currentPeriodEnd).toLocaleDateString("en-IN")}{s.cancelAtPeriodEnd ? " (cancelling)" : ""}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" data-testid={`admin-subscriptions-history-btn-${s.id}`} onClick={() => onViewHistory(s.userId)} className="flex items-center gap-1 text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <History size={13} /> History
          </button>
          {planKey !== s.planKey && (
            <button type="button" data-testid={`admin-subscriptions-changeplan-btn-${s.id}`} onClick={() => onChangePlan(s.id, planKey)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
              Save plan
            </button>
          )}
          {s.status !== "cancelled" && (
            <button type="button" data-testid={`admin-subscriptions-cancel-btn-${s.id}`} onClick={() => onCancel(s.id)} className="text-xs font-bold text-[var(--red)] hover:underline">
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Requirement: a per-user view of every PAST subscription, not just the
// current one — Subscription rows are superseded, never deleted (see
// subscriptionService.ts::upsertLocalSubscription), so this is a plain
// chronological read via GET /admin/subscriptions/by-user/:userId.
function SubscriptionHistoryModal({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/admin/subscriptions/by-user/${userId}`)
      .then((res) => setData(res.data))
      .catch(() => setError("Couldn't load this user's subscription history."));
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="admin-subscription-history-modal">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-lg">{data ? `${data.user.name}'s subscription history` : "Subscription history"}</h2>
          <button type="button" data-testid="admin-subscription-history-close-btn" onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        {error && <p className="text-[var(--red)] text-sm">{error}</p>}
        {!data && !error && <p className="text-sm text-[var(--text-tertiary)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
        {data && data.subscriptions.length === 0 && <p className="text-sm text-[var(--text-tertiary)]" data-testid="admin-subscription-history-empty">No subscriptions yet — this user has always been on Freemium.</p>}
        {data && data.subscriptions.length > 0 && (
          <div className="space-y-3">
            {data.subscriptions.map((s) => (
              <div key={s.id} className="rounded-xl border border-[var(--border)] p-3 text-sm" data-testid={`admin-subscription-history-row-${s.id}`}>
                <div className="flex items-center justify-between">
                  <p className="font-bold">{s.planName || s.planKey}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[s.status] || ""}`}>{s.status}</span>
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {new Date(s.currentPeriodStart).toLocaleDateString("en-IN")} – {new Date(s.currentPeriodEnd).toLocaleDateString("en-IN")}
                  {s.trialDaysGranted ? ` · ${s.trialDaysGranted}-day trial` : ""}
                  {s.cancelAtPeriodEnd ? " · cancelling" : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanEntitlementsInput({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      {["botScanWeekly", "botScanMonthly", "docUploadWeekly", "docUploadMonthly", "portfolioEditWeekly", "portfolioEditMonthly"].map((k) => (
        <label key={k} className="flex flex-col gap-1">
          {k}
          <input
            type="number"
            value={value[k] ?? ""}
            placeholder="unlimited"
            onChange={(e) => onChange({ ...value, [k]: e.target.value === "" ? null : Number(e.target.value) })}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 outline-none"
          />
        </label>
      ))}
      {/* How many times a subscriber on this plan can unlock the resilience
          -score PDF for free before paying again — counts distinct
          portfolio-version unlocks, not downloads (see paymentService.ts::
          ensureReportAccess). Blank = unlimited on this plan. */}
      <label className="flex flex-col gap-1" data-testid="admin-plans-entitlement-complimentary-report-label">
        complimentaryReportDownloads
        <input
          type="number"
          min={0}
          data-testid="admin-plans-entitlement-complimentary-report-input"
          value={value.complimentaryReportDownloads ?? ""}
          placeholder="unlimited"
          onChange={(e) => onChange({ ...value, complimentaryReportDownloads: e.target.value === "" ? null : Number(e.target.value) })}
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 outline-none"
        />
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.dailyRevaluation} onChange={(e) => onChange({ ...value, dailyRevaluation: e.target.checked })} /> dailyRevaluation</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.earlyAccess} onChange={(e) => onChange({ ...value, earlyAccess: e.target.checked })} /> earlyAccess</label>
    </div>
  );
}

function NewPlanForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [pricePaise, setPricePaise] = useState(0);
  const [interval, setInterval_] = useState("month");
  const [trialDays, setTrialDays] = useState(0);
  const [entitlements, setEntitlements] = useState(EMPTY_ENTITLEMENTS);

  if (!open) {
    return (
      <button type="button" data-testid="admin-plans-new-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New plan
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input data-testid="admin-plans-new-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <input data-testid="admin-plans-new-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <input data-testid="admin-plans-new-price-input" type="number" min={0} value={pricePaise} onChange={(e) => setPricePaise(Number(e.target.value))} placeholder="Price (paise)" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <select data-testid="admin-plans-new-interval-select" value={interval} onChange={(e) => setInterval_(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="month">month</option>
          <option value="year">year</option>
          <option value="one_time">one_time</option>
        </select>
        <input data-testid="admin-plans-new-trialdays-input" type="number" min={0} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} placeholder="Trial days" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      <PlanEntitlementsInput value={entitlements} onChange={setEntitlements} />
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-plans-new-create-btn"
          disabled={!key.trim() || !name.trim()}
          onClick={async () => {
            await onCreate({ key: key.trim(), name: name.trim(), pricePaise, interval, trialDays, entitlements });
            setKey("");
            setName("");
            setOpen(false);
          }}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}

// Requirement: an admin needs to change trial-day count and the
// coverage/benefits copy shown on an EXISTING plan's card
// (screens/Subscription.jsx), not just set them once at creation — there
// was previously no way to touch either after a plan was created.
function PlanRow({ plan, allPlans, onPublish, onArchive, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [trialDays, setTrialDays] = useState(plan.trialDays);
  const [benefitsText, setBenefitsText] = useState((plan.benefits || []).join("\n"));
  const [complimentaryReportDownloads, setComplimentaryReportDownloads] = useState(plan.entitlements?.complimentaryReportDownloads ?? 0);
  const [linkedPlanKey, setLinkedPlanKey] = useState(plan.linkedPlanKey || "");

  // Only a plan on the OTHER billing interval (Monthly<->Annual) can be
  // linked — see plansController.ts::setSymmetricPlanLink's own validation.
  // Also excludes archived plans (linking to one that's about to disappear
  // from the public list is never useful) and, obviously, this plan itself.
  const linkCandidates = (allPlans || []).filter((p) => p.key !== plan.key && p.isActive && p.interval !== "one_time" && p.interval !== plan.interval);

  if (editing) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-plans-row-${plan.id}`}>
        <p className="text-sm font-bold mb-2">{plan.name} <span className="text-xs font-normal text-[var(--text-tertiary)]">({plan.key})</span></p>
        <label className="flex flex-col gap-1 text-xs mb-2">
          Trial days
          <input
            type="number"
            min={0}
            data-testid={`admin-plans-edit-trialdays-input-${plan.id}`}
            value={trialDays}
            onChange={(e) => setTrialDays(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none w-32"
          />
        </label>
        {/* How many free resilience-report unlocks a subscriber on this plan
            gets before paying again — see PlanEntitlementsInput's own
            comment (used only at creation) for the exact mechanics. Blank =
            unlimited on this plan. */}
        <label className="flex flex-col gap-1 text-xs mb-2">
          Complimentary report downloads (blank = unlimited)
          <input
            type="number"
            min={0}
            data-testid={`admin-plans-edit-complimentary-report-input-${plan.id}`}
            value={complimentaryReportDownloads ?? ""}
            onChange={(e) => setComplimentaryReportDownloads(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none w-32"
          />
        </label>
        {plan.interval !== "one_time" && (
          <label className="flex flex-col gap-1 text-xs mb-2">
            Link with (shown as one card with a Monthly/Annual toggle on the user's Subscription screen)
            <select
              data-testid={`admin-plans-edit-link-select-${plan.id}`}
              value={linkedPlanKey}
              onChange={(e) => setLinkedPlanKey(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none"
            >
              <option value="">Not linked — its own card</option>
              {linkCandidates.map((p) => (
                <option key={p.key} value={p.key}>{p.name} ({p.interval})</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs mb-3">
          Benefits (one per line — shown as bullets on the plan card)
          <textarea
            data-testid={`admin-plans-edit-benefits-input-${plan.id}`}
            value={benefitsText}
            onChange={(e) => setBenefitsText(e.target.value)}
            rows={4}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
          <button
            type="button"
            data-testid={`admin-plans-edit-save-btn-${plan.id}`}
            onClick={async () => {
              await onUpdate(plan.id, {
                trialDays,
                entitlements: { complimentaryReportDownloads },
                benefits: benefitsText.split("\n").map((line) => line.trim()).filter(Boolean),
                ...(plan.interval !== "one_time" ? { linkedPlanKey: linkedPlanKey || null } : {}),
              });
              setEditing(false);
            }}
            className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-plans-row-${plan.id}`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-sm font-bold">{plan.name}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            {plan.key} · {fmtINR(plan.pricePaise)}/{plan.interval} · trial {plan.trialDays}d ·{" "}
            {plan.entitlements?.complimentaryReportDownloads === null
              ? "unlimited free reports"
              : `${plan.entitlements?.complimentaryReportDownloads ?? 0} free report${plan.entitlements?.complimentaryReportDownloads === 1 ? "" : "s"}`}
          </p>
          {plan.benefits && plan.benefits.length > 0 && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">{plan.benefits.join(" · ")}</p>
          )}
          {plan.linkedPlanKey && (
            <p className="text-xs text-[var(--dive-blue)] mt-1" data-testid={`admin-plans-linked-note-${plan.id}`}>
              Linked with {(allPlans || []).find((p) => p.key === plan.linkedPlanKey)?.name || plan.linkedPlanKey} — shown as one toggle card
            </p>
          )}
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-bold ${plan.isActive ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}>{plan.isActive ? "active" : plan.visibility}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button type="button" data-testid={`admin-plans-edit-btn-${plan.id}`} onClick={() => setEditing(true)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
          Edit
        </button>
        {plan.razorpayPlanId ? (
          <span className="text-xs text-[var(--text-tertiary)]" data-testid={`admin-plans-razorpayid-${plan.id}`}>Razorpay: {plan.razorpayPlanId}</span>
        ) : plan.pricePaise > 0 ? (
          <button type="button" data-testid={`admin-plans-publish-btn-${plan.id}`} onClick={() => onPublish(plan.id)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
            Publish to Razorpay
          </button>
        ) : null}
        {plan.isActive && (
          <button type="button" data-testid={`admin-plans-archive-btn-${plan.id}`} onClick={() => onArchive(plan.id)} className="text-xs font-bold text-[var(--red)] hover:underline">
            Archive
          </button>
        )}
      </div>
    </div>
  );
}

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3 — coupons, folded into this same
// screen as a third tab rather than a new sidebar entry, matching how
// Plans already shares this screen instead of getting its own nav item.
// Eligibility is orthogonal to which plan(s) a coupon applies to — see
// Coupon.ts's own comment on CouponEligibility for exact definitions.
const COUPON_ELIGIBILITY_OPTIONS = [
  { value: "any", label: "Anyone" },
  { value: "new_user", label: "New users (within 7 days of signup)" },
  { value: "first_time", label: "First-time subscribers only" },
  { value: "renewal", label: "Renewal/returning subscribers only" },
];

// A recurring plan's coupon can discount just the first charge, or every
// auto-renewal for the subscription's whole life — see backend's
// Coupon.ts::CouponDiscountDuration. "recurring" is the default and matches
// this feature's original (pre-toggle) behavior.
const COUPON_DURATION_OPTIONS = [
  { value: "recurring", label: "Every renewal (recurring)" },
  { value: "once", label: "First charge only (one-time)" },
];

function NewCouponForm({ plans, onCreate }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState("percent");
  const [value, setValue] = useState(10);
  const [planKey, setPlanKey] = useState("");
  const [eligibility, setEligibility] = useState("any");
  const [discountDuration, setDiscountDuration] = useState("recurring");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [maxRedemptionsPerUser, setMaxRedemptionsPerUser] = useState("");

  if (!open) {
    return (
      <button type="button" data-testid="admin-coupons-new-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New coupon
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4 w-full">
      <div className="grid grid-cols-4 gap-2 mb-2">
        <input data-testid="admin-coupons-new-code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none uppercase" />
        <select data-testid="admin-coupons-new-type-select" value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="percent">% off</option>
          <option value="flat">₹ off (flat)</option>
        </select>
        <input data-testid="admin-coupons-new-value-input" type="number" min={1} value={value} onChange={(e) => setValue(Number(e.target.value))} placeholder={type === "percent" ? "20" : "paise"} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input data-testid="admin-coupons-new-maxredemptions-input" type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Max total uses (optional)" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <input data-testid="admin-coupons-new-maxredemptionsperuser-input" type="number" min={1} value={maxRedemptionsPerUser} onChange={(e) => setMaxRedemptionsPerUser(e.target.value)} placeholder="Max uses per user (optional)" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      <select data-testid="admin-coupons-new-plan-select" value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none mb-2">
        <option value="">Applies to all paid plans</option>
        {(plans || []).filter((p) => p.pricePaise > 0).map((p) => (
          <option key={p.key} value={p.key}>{p.name} only</option>
        ))}
      </select>
      <select data-testid="admin-coupons-new-eligibility-select" value={eligibility} onChange={(e) => setEligibility(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none mb-2">
        {COUPON_ELIGIBILITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select data-testid="admin-coupons-new-duration-select" value={discountDuration} onChange={(e) => setDiscountDuration(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none mb-2">
        {COUPON_DURATION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-coupons-new-create-btn"
          disabled={!code.trim() || !value}
          onClick={async () => {
            await onCreate({
              code: code.trim(),
              type,
              value: Number(value),
              appliesToPlanKeys: planKey ? [planKey] : [],
              eligibility,
              discountDuration,
              ...(maxRedemptions ? { maxRedemptions: Number(maxRedemptions) } : {}),
              ...(maxRedemptionsPerUser ? { maxRedemptionsPerUser: Number(maxRedemptionsPerUser) } : {}),
            });
            setCode("");
            setValue(10);
            setPlanKey("");
            setEligibility("any");
            setDiscountDuration("recurring");
            setMaxRedemptions("");
            setMaxRedemptionsPerUser("");
            setOpen(false);
          }}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function CouponRow({ coupon, onToggleActive }) {
  const discountLabel = coupon.type === "percent" ? `${coupon.value}% off` : `${fmtINR(coupon.value)} off`;
  const eligibilityLabel = COUPON_ELIGIBILITY_OPTIONS.find((o) => o.value === (coupon.eligibility || "any"))?.label || "Anyone";
  const isOneTime = coupon.discountDuration === "once";
  return (
    <tr className="border-b border-[var(--border)] last:border-0" data-testid={`admin-coupons-row-${coupon.id}`}>
      <td className="px-4 py-3 font-bold">{coupon.code}</td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{discountLabel}</td>
      <td className="px-4 py-3 text-[var(--text-tertiary)]" data-testid={`admin-coupons-duration-${coupon.id}`}>{isOneTime ? "First charge only" : "Every renewal"}</td>
      <td className="px-4 py-3 text-[var(--text-tertiary)]">{coupon.appliesToPlanKeys.length === 0 ? "All paid plans" : coupon.appliesToPlanKeys.join(", ")}</td>
      <td className="px-4 py-3 text-[var(--text-tertiary)]" data-testid={`admin-coupons-eligibility-${coupon.id}`}>{eligibilityLabel}</td>
      <td className="px-4 py-3">
        {coupon.redeemedCount}{coupon.maxRedemptions != null ? ` / ${coupon.maxRedemptions}` : ""}
        {coupon.maxRedemptionsPerUser != null && <span className="text-[var(--text-tertiary)]"> · {coupon.maxRedemptionsPerUser}/user</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 rounded-full text-xs font-bold ${coupon.isActive ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}>{coupon.isActive ? "active" : "inactive"}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <button type="button" data-testid={`admin-coupons-toggle-btn-${coupon.id}`} onClick={() => onToggleActive(coupon.id, !coupon.isActive)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
          {coupon.isActive ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  );
}

function TrialRow({ t, onRegrant }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0" data-testid={`admin-trials-row-${t.id}`}>
      <td className="px-4 py-3 font-bold">{t.userName || t.userEmail}</td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{t.planName || t.planKey}</td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{t.forfeited ? "Not claimed" : t.legacy ? "Legacy" : `${t.trialDaysGranted}d`}</td>
      <td className="px-4 py-3">
        {t.forfeited ? (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]">subscribed directly</span>
        ) : t.status ? (
          <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[t.status] || ""}`}>{t.status}</span>
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">
        {t.currentPeriodStart && t.currentPeriodEnd ? `${new Date(t.currentPeriodStart).toLocaleDateString("en-IN")} – ${new Date(t.currentPeriodEnd).toLocaleDateString("en-IN")}` : "Unknown"}
      </td>
      <td className="px-4 py-3 text-right">
        {t.hasUsedTrial ? (
          <button type="button" data-testid={`admin-trials-regrant-btn-${t.id}`} onClick={() => onRegrant(t.userId)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
            Regrant trial
          </button>
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]" data-testid={`admin-trials-already-regranted-${t.id}`}>Regranted</span>
        )}
      </td>
    </tr>
  );
}

// Requirement: an admin-grantable extra allowance for one metered key, on
// top of whatever the user's plan already grants — works for Freemium or
// Premium alike (unlike Grant Complimentary, which grants a whole plan).
function UsageBonusForm({ onGrant }) {
  const [open, setOpen] = useState(false);
  const [userIdOrEmail, setUserIdOrEmail] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [key, setKey] = useState("portfolio_edit");
  const [bonusWeekly, setBonusWeekly] = useState(0);
  const [bonusMonthly, setBonusMonthly] = useState(0);
  const [bonusTotal, setBonusTotal] = useState(0);
  // "score_report" is a flat lifetime count (see UsageGrant.ts's own comment
  // on bonusTotal) — nothing weekly/monthly to show for it, unlike every
  // other key.
  const isReportKey = key === "score_report";

  function reset() {
    setUserIdOrEmail("");
    setSelectedUser(null);
    setBonusWeekly(0);
    setBonusMonthly(0);
    setBonusTotal(0);
  }

  if (!open) {
    return (
      <button type="button" data-testid="admin-usagegrant-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> Grant extra limits
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4">
      <div className="grid grid-cols-4 gap-2 mb-2">
        <UserPicker
          testIdPrefix="admin-usagegrant-user"
          value={userIdOrEmail}
          onChange={setUserIdOrEmail}
          selectedLabel={selectedUser ? `${selectedUser.name} (${selectedUser.email})` : null}
          onSelect={setSelectedUser}
        />
        <select data-testid="admin-usagegrant-key-select" value={key} onChange={(e) => setKey(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="portfolio_edit">Portfolio edits</option>
          <option value="bot_scan">Bot Scan</option>
          <option value="doc_upload">Doc Upload</option>
          <option value="score_report">Resilience report (free downloads)</option>
        </select>
        {isReportKey ? (
          <input
            data-testid="admin-usagegrant-total-input"
            type="number"
            min={0}
            value={bonusTotal}
            onChange={(e) => setBonusTotal(Number(e.target.value))}
            placeholder="+ free downloads"
            className="col-span-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        ) : (
          <>
            <input data-testid="admin-usagegrant-weekly-input" type="number" min={0} value={bonusWeekly} onChange={(e) => setBonusWeekly(Number(e.target.value))} placeholder="+ per week" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
            <input data-testid="admin-usagegrant-monthly-input" type="number" min={0} value={bonusMonthly} onChange={(e) => setBonusMonthly(Number(e.target.value))} placeholder="+ per month" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
          </>
        )}
      </div>
      {isReportKey && (
        <p className="text-[11px] text-[var(--text-tertiary)] mb-2">
          A flat lifetime count on top of whatever this user's plan already grants — counts distinct portfolio-version unlocks, not downloads.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-usagegrant-submit-btn"
          disabled={!userIdOrEmail.trim()}
          onClick={async () => {
            await onGrant({ userIdOrEmail: userIdOrEmail.trim(), key, bonusWeekly, bonusMonthly, bonusTotal });
            reset();
            setOpen(false);
          }}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          Grant
        </button>
      </div>
    </div>
  );
}

/**
 * Plans + Subscriptions admin (Phase 6a of docs/ADMIN_PANEL_PLAN.md
 * §5.3/§7) — one screen, two tabs, since the sidebar list names only
 * "Subscriptions" as one section (§7's own sidebar enumeration). Every
 * mutation on the Subscriptions tab is step-up gated, same as an employee
 * invite or a config publish — cancel/change-plan/grant all directly
 * change what a real user is billed or granted.
 */
export default function Subscriptions() {
  const [tab, setTab] = useState("subscriptions");
  const [subscriptions, setSubscriptions] = useState(null);
  const [plans, setPlans] = useState(null);
  const [coupons, setCoupons] = useState(null);
  const [renewalReminder, setRenewalReminder] = useState(null);
  const [savingRenewalReminder, setSavingRenewalReminder] = useState(false);
  const [renewalReminderSaved, setRenewalReminderSaved] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [stepUpRequest, setStepUpRequest] = useState(null);
  const [trials, setTrials] = useState(null);
  const [trialsError, setTrialsError] = useState("");
  const [historyUserId, setHistoryUserId] = useState(null);
  // Search/filter/sort for the Subscriptions and Trials tables — both are
  // server-side (query params on the list endpoints), not client-side
  // filtering of an already-fetched page, since either list can exceed one
  // page and a user on page 2 must still be findable by search. `userId` is
  // set only once a specific person is picked from the search box's own
  // autocomplete dropdown (see UserPicker) — an exact filter, separate from
  // the free-text `q`, which the picker still uses for its live suggestions
  // and as a plain substring fallback for anyone who doesn't bother picking.
  const [subsQuery, setSubsQuery] = useState({ q: "", userId: "", status: "", sort: "newest" });
  const [trialsQuery, setTrialsQuery] = useState({ q: "", userId: "", status: "", sort: "newest" });
  const [subsSelectedUser, setSubsSelectedUser] = useState(null);
  const [trialsSelectedUser, setTrialsSelectedUser] = useState(null);

  async function loadSubscriptions(query) {
    try {
      const { data } = await api.get("/admin/subscriptions", { params: { q: query.q || undefined, userId: query.userId || undefined, status: query.status || undefined, sort: query.sort } });
      setSubscriptions(data.subscriptions);
    } catch {
      setError("Couldn't load subscriptions. Please try again.");
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [plansRes, couponsRes, renewalReminderRes] = await Promise.all([api.get("/admin/plans"), api.get("/admin/coupons"), api.get("/admin/subscriptions/renewal-reminder-settings")]);
      setPlans(plansRes.data.plans);
      setCoupons(couponsRes.data.coupons);
      setRenewalReminder(renewalReminderRes.data);
      await loadSubscriptions(subsQuery);
    } catch {
      setError("Couldn't load subscriptions. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced re-search — mirrors UsersList.jsx's own 250ms convention.
  // Skips its very first run since `load()` above already fetches with the
  // initial (default) subsQuery on mount; without the skip this would fire
  // a redundant second fetch immediately after.
  const isFirstSubsQuery = useRef(true);
  useEffect(() => {
    if (isFirstSubsQuery.current) {
      isFirstSubsQuery.current = false;
      return;
    }
    const timer = setTimeout(() => loadSubscriptions(subsQuery), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsQuery.q, subsQuery.userId, subsQuery.status, subsQuery.sort]);

  function requestStepUpToken() {
    return new Promise((resolve, reject) => setStepUpRequest({ resolve, reject }));
  }
  async function withStepUp(call) {
    try {
      return await call();
    } catch (err) {
      if (!isStepUpRequiredError(err)) throw err;
      const token = await requestStepUpToken();
      return call(token);
    }
  }

  async function cancelSubscription(id) {
    setError("");
    try {
      await withStepUp((token) => api.post(`/admin/subscriptions/${id}/cancel`, { atPeriodEnd: false }, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't cancel this subscription.");
    }
  }
  async function changePlan(id, planKey) {
    setError("");
    try {
      await withStepUp((token) => api.post(`/admin/subscriptions/${id}/change-plan`, { planKey }, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't change this subscription's plan.");
    }
  }
  async function grant(body) {
    setError("");
    try {
      await withStepUp((token) => api.post("/admin/subscriptions/grant", body, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't grant this subscription.");
    }
  }
  // No step-up — same "instantly reversible by editing it again" bar as
  // Revenue.jsx's report-pricing save.
  async function saveRenewalReminderSettings(next) {
    setError("");
    setSavingRenewalReminder(true);
    setRenewalReminderSaved(false);
    try {
      const res = await api.patch("/admin/subscriptions/renewal-reminder-settings", next);
      setRenewalReminder(res.data);
      setRenewalReminderSaved(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't save the renewal reminder settings.");
    } finally {
      setSavingRenewalReminder(false);
    }
  }

  async function loadTrials(query = trialsQuery) {
    setTrialsError("");
    try {
      const { data } = await api.get("/admin/subscriptions/trials", { params: { q: query.q || undefined, userId: query.userId || undefined, status: query.status || undefined, sort: query.sort } });
      setTrials(data.trials);
    } catch {
      setTrialsError("Couldn't load trial users. Please try again.");
    }
  }
  async function regrantTrial(userId) {
    setTrialsError("");
    try {
      await withStepUp((token) => api.post(`/admin/users/${userId}/trial/reset`, {}, { headers: { "x-step-up-token": token } }));
      await loadTrials();
    } catch (err) {
      setTrialsError(err?.response?.data?.message || "Couldn't regrant this user's trial.");
    }
  }

  // Same lazy-tab-aware debounce as the Subscriptions table above: skip the
  // very first run so it doesn't double-fetch the moment the Trials tab is
  // first opened (that click already calls loadTrials() itself), then
  // debounce every real change to the search/filter/sort controls.
  const isFirstTrialsQuery = useRef(true);
  useEffect(() => {
    if (isFirstTrialsQuery.current) {
      isFirstTrialsQuery.current = false;
      return;
    }
    const timer = setTimeout(() => loadTrials(trialsQuery), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialsQuery.q, trialsQuery.userId, trialsQuery.status, trialsQuery.sort]);
  async function grantUsageBonus(body) {
    setError("");
    try {
      await withStepUp((token) => api.post("/admin/subscriptions/usage-grants", body, { headers: { "x-step-up-token": token } }));
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't grant extra limits.");
    }
  }
  async function createPlan(body) {
    await api.post("/admin/plans", body);
    await load();
  }
  async function updatePlan(id, body) {
    setError("");
    try {
      await api.patch(`/admin/plans/${id}`, body);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't update this plan.");
    }
  }
  async function publishPlan(id) {
    setError("");
    try {
      await withStepUp((token) => api.post(`/admin/plans/${id}/publish-to-razorpay`, {}, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't publish this plan to Razorpay.");
    }
  }
  async function archivePlan(id) {
    setError("");
    setNotice("");
    const { data } = await api.post(`/admin/plans/${id}/archive`);
    // Existing subscribers keep every benefit until their own currentPeriodEnd
    // — this only turns off auto-renew so they're never charged again for a
    // plan that's no longer for sale (see plansController.ts::archivePlan).
    if (data.subscribersAffected > 0) {
      setNotice(`Archived. Auto-renew turned off for ${data.subscribersAffected} existing subscriber${data.subscribersAffected === 1 ? "" : "s"} — they keep access until their plan ends.`);
    }
    await load();
  }
  async function createCoupon(body) {
    setError("");
    try {
      await api.post("/admin/coupons", body);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't create this coupon.");
    }
  }
  async function toggleCouponActive(id, isActive) {
    setError("");
    try {
      await api.patch(`/admin/coupons/${id}`, { isActive });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't update this coupon.");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-subscriptions-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-subscriptions-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Subscriptions</h1>
        <div className="flex gap-2">
          <button data-testid="admin-subscriptions-tab-subscriptions" onClick={() => setTab("subscriptions")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "subscriptions" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Subscriptions</button>
          <button data-testid="admin-subscriptions-tab-plans" onClick={() => setTab("plans")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "plans" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Plans</button>
          <button data-testid="admin-subscriptions-tab-coupons" onClick={() => setTab("coupons")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "coupons" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Coupons</button>
          {/* Lazily loaded — no reason to fetch this on every visit to the
              screen when the Subscriptions tab is the default landing view. */}
          <button
            data-testid="admin-subscriptions-tab-trials"
            onClick={() => {
              setTab("trials");
              if (!trials) loadTrials();
            }}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "trials" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}
          >
            Trials
          </button>
          <button data-testid="admin-subscriptions-tab-reminders" onClick={() => setTab("reminders")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "reminders" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Reminders</button>
        </div>
      </div>

      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-subscriptions-error">{error}</p>}
      {notice && <p className="text-[var(--green)] mb-4 text-sm" data-testid="admin-subscriptions-notice">{notice}</p>}

      {tab === "subscriptions" && (
        <>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-64">
                <UserPicker
                  testIdPrefix="admin-subscriptions-search"
                  value={subsQuery.q}
                  onChange={(v) => setSubsQuery((s) => ({ ...s, q: v }))}
                  selectedLabel={subsSelectedUser ? `${subsSelectedUser.name} (${subsSelectedUser.email})` : ""}
                  onSelect={(u) => {
                    setSubsSelectedUser(u);
                    setSubsQuery((s) => ({ ...s, q: "", userId: u ? u.id : "" }));
                  }}
                  placeholder="Search name or email"
                />
              </div>
              <select
                data-testid="admin-subscriptions-status-filter"
                value={subsQuery.status}
                onChange={(e) => setSubsQuery((s) => ({ ...s, status: e.target.value }))}
                className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              >
                <option value="">All statuses</option>
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
              <select
                data-testid="admin-subscriptions-sort-select"
                value={subsQuery.sort}
                onChange={(e) => setSubsQuery((s) => ({ ...s, sort: e.target.value }))}
                className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="expiring_soon">Expiring soonest</option>
                <option value="expiring_latest">Expiring latest</option>
              </select>
            </div>
            <div className="flex gap-2">
              <UsageBonusForm onGrant={grantUsageBonus} />
              <GrantForm onGrant={grant} />
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-subscriptions-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Period end</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <SubscriptionRow key={s.id} s={s} onCancel={cancelSubscription} onChangePlan={changePlan} onViewHistory={setHistoryUserId} />
                ))}
                {subscriptions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-subscriptions-empty">No subscriptions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "trials" && (
        <>
          {trialsError && <p className="text-[var(--red)] mb-4" data-testid="admin-trials-error">{trialsError}</p>}
          {!trials ? (
            <p className="text-[var(--text-tertiary)] flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <div className="w-64">
                  <UserPicker
                    testIdPrefix="admin-trials-search"
                    value={trialsQuery.q}
                    onChange={(v) => setTrialsQuery((s) => ({ ...s, q: v }))}
                    selectedLabel={trialsSelectedUser ? `${trialsSelectedUser.name} (${trialsSelectedUser.email})` : ""}
                    onSelect={(u) => {
                      setTrialsSelectedUser(u);
                      setTrialsQuery((s) => ({ ...s, q: "", userId: u ? u.id : "" }));
                    }}
                    placeholder="Search name or email"
                  />
                </div>
                <select
                  data-testid="admin-trials-status-filter"
                  value={trialsQuery.status}
                  onChange={(e) => setTrialsQuery((s) => ({ ...s, status: e.target.value }))}
                  className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                >
                  <option value="">All statuses</option>
                  <option value="legacy">Legacy (unknown length)</option>
                  <option value="forfeited">Not claimed (subscribed directly)</option>
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past due</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                </select>
                <select
                  data-testid="admin-trials-sort-select"
                  value={trialsQuery.sort}
                  onChange={(e) => setTrialsQuery((s) => ({ ...s, sort: e.target.value }))}
                  className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
              <table className="w-full text-sm" data-testid="admin-trials-table">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Trial length</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Trial period</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {trials.map((t) => (
                    <TrialRow key={t.id} t={t} onRegrant={regrantTrial} />
                  ))}
                  {trials.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-trials-empty">No one has claimed a trial yet.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "reminders" && renewalReminder && (
        <RenewalReminderCard settings={renewalReminder} onSave={saveRenewalReminderSettings} saving={savingRenewalReminder} saved={renewalReminderSaved} />
      )}

      {tab === "plans" && (
        <>
          <div className="flex justify-end mb-4"><NewPlanForm onCreate={createPlan} /></div>
          {plans.map((p) => (
            <PlanRow key={p.id} plan={p} allPlans={plans} onPublish={publishPlan} onArchive={archivePlan} onUpdate={updatePlan} />
          ))}
        </>
      )}

      {tab === "coupons" && (
        <>
          <div className="flex justify-end mb-4"><NewCouponForm plans={plans} onCreate={createCoupon} /></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-coupons-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Applies to</th>
                  <th className="px-4 py-3">Eligibility</th>
                  <th className="px-4 py-3">Redeemed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <CouponRow key={c.id} coupon={c} onToggleActive={toggleCouponActive} />
                ))}
                {coupons.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-coupons-empty">No coupons yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {historyUserId && <SubscriptionHistoryModal userId={historyUserId} onClose={() => setHistoryUserId(null)} />}

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
