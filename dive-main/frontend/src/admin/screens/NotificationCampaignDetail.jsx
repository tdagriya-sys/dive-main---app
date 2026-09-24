import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";
import NotificationContentFields from "../NotificationContentFields";
import { cleanButton } from "../ButtonFields";
import { cleanCallout } from "../CalloutFields";
import { cleanHighlightStyle } from "../HighlightStyleFields";

const CHANNEL_LABELS = { in_app: "In-app (bell)", email: "Email", popup: "Pop-up card" };

function fmtDateTime(value) {
  return value ? new Date(value).toLocaleString("en-IN") : "—";
}

function Card({ title, children, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-4" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {children}
    </div>
  );
}

const HOLDINGS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "true", label: "Has holdings" },
  { value: "false", label: "No holdings" },
];

// Four mutually-exclusive subscription-lifecycle buckets — see backend's
// models/NotificationCampaign.ts::SegmentSubscriptionFilter for the exact
// definition each one resolves to.
const SUBSCRIPTION_FILTER_OPTIONS = [
  { value: "", label: "Any" },
  { value: "active_subscription", label: "Has an active subscription" },
  { value: "lapsed_payer", label: "No active subscription, but bought at least once" },
  { value: "trial_only", label: "Only claimed a free trial, never bought" },
  { value: "never_engaged", label: "Never claimed a trial or bought" },
];

const REPORT_FILTER_OPTIONS = [
  { value: "", label: "Any" },
  { value: "purchased_report", label: "Bought the resilience report at least once" },
  { value: "never_purchased_report", label: "Never bought the resilience report" },
];

const optionLabel = (options, value) => options.find((o) => o.value === value)?.label || value;

// A segment's filters as plain sentences — for the read-only "who this went
// to" summary (the editable controls above only exist while it's a draft).
function describeSegment(segment = {}) {
  const parts = [];
  if (segment.signupFrom) parts.push(`Signed up after ${new Date(segment.signupFrom).toLocaleDateString("en-IN")}`);
  if (segment.signupTo) parts.push(`Signed up before ${new Date(segment.signupTo).toLocaleDateString("en-IN")}`);
  if (segment.hasHoldings === true) parts.push("Has holdings");
  if (segment.hasHoldings === false) parts.push("No holdings");
  if (segment.minHoldingsCount) parts.push(`At least ${segment.minHoldingsCount} holdings`);
  if (segment.activeSinceDays) parts.push(`Active in the last ${segment.activeSinceDays} days`);
  if (segment.subscriptionFilter) parts.push(optionLabel(SUBSCRIPTION_FILTER_OPTIONS, segment.subscriptionFilter));
  if (segment.reportFilter) parts.push(optionLabel(REPORT_FILTER_OPTIONS, segment.reportFilter));
  return parts;
}

function AudienceSummary({ campaign }) {
  return (
    <div className="rounded-xl bg-[var(--surface-card-hover)] p-3 mb-3 text-sm" data-testid="admin-campaign-audience-summary">
      {campaign.audience === "all" && <p>Every active user.</p>}
      {campaign.audience === "segment" && (
        <>
          <p className="font-bold mb-1">A segment of users who match:</p>
          {describeSegment(campaign.segmentQuery).length === 0 ? (
            <p className="text-[var(--text-secondary)]">No filters — everyone.</p>
          ) : (
            <ul className="list-disc pl-5 text-[var(--text-secondary)]">
              {describeSegment(campaign.segmentQuery).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </>
      )}
      {campaign.audience === "external" && (
        <>
          <p className="font-bold mb-1" data-testid="admin-campaign-audience-external-title">Email list “{campaign.externalListKey}” — people who aren't on Divve yet:</p>
          <ul className="list-disc pl-5 text-[var(--text-secondary)]">
            {campaign.externalList && (
              <li data-testid="admin-campaign-audience-external-list">
                The list now has {campaign.externalList.total} contact(s): {campaign.externalList.subscribed} subscribed, {campaign.externalList.unsubscribed} unsubscribed.
              </li>
            )}
            {campaign.stats?.skippedRegistered !== undefined && (
              <li data-testid="admin-campaign-audience-external-skipped">
                Left out when it was sent: {campaign.stats.skippedRegistered} already on Divve, {campaign.stats.skippedUnsubscribed} unsubscribed.
              </li>
            )}
          </ul>
        </>
      )}
      {campaign.audience === "user_ids" && (
        <>
          <p className="font-bold mb-1">{(campaign.userIds || []).length} specific user(s):</p>
          <ul className="list-disc pl-5 text-[var(--text-secondary)]" data-testid="admin-campaign-audience-users">
            {(campaign.audienceUsers || []).map((u) => <li key={u.id}>{u.name} — {u.email}</li>)}
          </ul>
          {(campaign.userIds || []).length > (campaign.audienceUsers || []).length && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Showing the first {(campaign.audienceUsers || []).length}.</p>
          )}
        </>
      )}
    </div>
  );
}

// What recipients actually see, rendered server-side (a sent campaign shows
// its send-time snapshot, so a template edited afterwards can't change it)
// plus the message exactly as it was written.
function ContentPreview({ campaign }) {
  const preview = campaign.preview;
  if (!preview) {
    return <p className="text-sm text-[var(--text-tertiary)]" data-testid="admin-campaign-content-unavailable">No content is configured for this campaign.</p>;
  }
  const { content, richHtml, inAppHtml, inAppLink } = preview;
  const channels = campaign.channels || [];
  const usesTemplateLive = campaign.templateKey && !campaign.inlineContent && !campaign.sentContent;
  return (
    <div data-testid="admin-campaign-content-preview">
      {usesTemplateLive && (
        <p className="text-xs text-[var(--text-secondary)] mb-3" data-testid="admin-campaign-content-template-note">
          Uses the template “{campaign.templateName || campaign.templateKey}”. Use “Edit content” to change the wording for this campaign only — the template itself isn't touched.
        </p>
      )}
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Subject</p>
      <p className="font-bold text-sm mb-4" data-testid="admin-campaign-content-subject">{content.subject}</p>

      {(channels.includes("popup") || channels.includes("email")) && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Pop-up card / email</p>
          <div
            className="rounded-xl bg-[var(--surface-card-hover)] p-4 text-sm text-[var(--text-secondary)] leading-relaxed"
            data-testid="admin-campaign-content-rich"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: richHtml }}
          />
        </div>
      )}
      {channels.includes("in_app") && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Bell (in-app)</p>
          <div className="rounded-xl bg-[var(--surface-card-hover)] p-4 text-sm text-[var(--text-secondary)]">
            <div data-testid="admin-campaign-content-bell" dangerouslySetInnerHTML={{ __html: inAppHtml }} />
            {inAppLink && <p className="mt-2 text-xs font-bold text-[var(--gold-c)]" data-testid="admin-campaign-content-bell-link">{inAppLink.linkLabel} → {inAppLink.link}</p>}
          </div>
        </div>
      )}

      <details className="text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer font-bold">As written</summary>
        <pre className="whitespace-pre-wrap font-sans mt-2" data-testid="admin-campaign-content-raw">{content.bodyMarkdown}</pre>
        {content.callout && (
          <p className="mt-2" data-testid="admin-campaign-content-callout">
            Callout: {[content.callout.text && `“${content.callout.text}”`, content.callout.imageUrl && `image ${content.callout.imageUrl}`, content.callout.linkUrl && `links to ${content.callout.linkUrl}`].filter(Boolean).join(" · ")}
          </p>
        )}
        {content.button && <p className="mt-1" data-testid="admin-campaign-content-button">Button: “{content.button.label}” → {content.button.url}</p>}
      </details>
    </div>
  );
}

/**
 * The single-campaign builder + dispatch console (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §7 — "campaign builder with a segment builder +
 * live audience count, schedule, delivery dashboard"). Editable only while
 * `status:"draft"` (the backend enforces this too — see
 * notificationCampaignService.ts's updateCampaign). Schedule/send reuse
 * the same step-up flow as Roles.jsx/Employees.jsx.
 */
export default function NotificationCampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [stepUpRequest, setStepUpRequest] = useState(null);

  const [segment, setSegment] = useState({});
  const [audienceMode, setAudienceMode] = useState("all");
  const [userIdsText, setUserIdsText] = useState("");
  // "Email list" audience: imported contacts who aren't Divve users (Admin →
  // Notifications → Email lists). Emailed only.
  const [externalListKey, setExternalListKey] = useState("");
  const [externalLists, setExternalLists] = useState(null);
  // Which address this campaign's emails go out from (no-reply vs the separate
  // marketing address) and whether it can send right now. Best-effort.
  const [sender, setSender] = useState(null);
  const [preview, setPreview] = useState(null);
  const [testEmail, setTestEmail] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [stats, setStats] = useState(null);
  // Editing a draft's content (the "Content" card) — kept separate from the
  // audience state above since they save independently.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [savingContent, setSavingContent] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/admin/notification-campaigns/${id}`);
      setCampaign(data.campaign);
      setAudienceMode(data.campaign.audience);
      setSegment(data.campaign.segmentQuery || {});
      setUserIdsText((data.campaign.userIds || []).join(", "));
      setExternalListKey(data.campaign.externalListKey || "");
      if (data.campaign.audience === "external" && data.campaign.status === "draft") loadExternalLists();
      if (["draft", "scheduled"].includes(data.campaign.status)) loadSender();
      if (["sent", "sending", "scheduled"].includes(data.campaign.status)) {
        const statsRes = await api.get(`/admin/notification-campaigns/${id}/stats`);
        setStats(statsRes.data.stats);
      }
    } catch (err) {
      setError(err?.response?.status === 404 ? "Campaign not found." : "Couldn't load this campaign. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadSender() {
    try {
      const { data } = await api.get(`/admin/notification-campaigns/${id}/sender`);
      setSender(data.sender || null);
    } catch {
      setSender(null);
    }
  }

  async function loadExternalLists() {
    try {
      const { data } = await api.get("/admin/external-lists");
      setExternalLists(data.lists || []);
    } catch {
      setExternalLists([]);
    }
  }

  function chooseAudienceMode(mode) {
    setAudienceMode(mode);
    setPreview(null);
    if (mode === "external" && externalLists === null) loadExternalLists();
  }

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

  async function startEditing() {
    setActionError("");
    // A template-based draft starts from that template's wording; saving
    // turns it into custom content for THIS campaign only.
    const source = campaign.inlineContent || campaign.templateContent || {};
    setEditForm({
      name: campaign.name,
      categoryKey: campaign.categoryKey,
      // An email-list campaign can only ever go by email.
      channels: campaign.audience === "external" ? ["email"] : campaign.channels || ["in_app"],
      content: {
        subject: source.subject || "",
        bodyMarkdown: source.bodyMarkdown || "",
        highlightStyle: source.highlightStyle || undefined,
        callout: source.callout || undefined,
        button: source.button || undefined,
      },
    });
    setEditing(true);
    try {
      const { data } = await api.get("/admin/notification-categories");
      setCategories(data.categories || []);
    } catch {
      // best-effort — the category just shows as its current key
    }
  }

  async function saveContent() {
    setActionError("");
    setSavingContent(true);
    try {
      const { content } = editForm;
      await api.patch(`/admin/notification-campaigns/${id}`, {
        name: editForm.name.trim(),
        categoryKey: editForm.categoryKey,
        channels: editForm.channels,
        ...(campaign.templateKey ? { templateKey: null } : {}),
        inlineContent: {
          subject: content.subject.trim(),
          bodyMarkdown: content.bodyMarkdown.trim(),
          highlightStyle: cleanHighlightStyle(content.highlightStyle),
          callout: cleanCallout(content.callout),
          button: cleanButton(content.button),
        },
      });
      setEditing(false);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't save the content.");
    } finally {
      setSavingContent(false);
    }
  }

  async function saveAudience() {
    setActionError("");
    const body =
      audienceMode === "segment"
        ? { audience: "segment", segmentQuery: segment }
        : audienceMode === "user_ids"
        ? { audience: "user_ids", userIds: userIdsText.split(",").map((s) => s.trim()).filter(Boolean) }
        : audienceMode === "external"
        ? { audience: "external", externalListKey, channels: ["email"] }
        : { audience: "all" };
    try {
      await api.patch(`/admin/notification-campaigns/${id}`, body);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't save the audience.");
    }
  }

  async function previewAudience() {
    setActionError("");
    try {
      const { data } = await api.get(`/admin/notification-campaigns/${id}/preview`);
      setPreview(data);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't preview the audience.");
    }
  }

  async function sendTest() {
    setActionError("");
    try {
      await api.post(`/admin/notification-campaigns/${id}/test-send`, { email: testEmail });
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't send the test.");
    }
  }

  async function schedule() {
    setActionError("");
    try {
      await withStepUp((token) => api.post(`/admin/notification-campaigns/${id}/schedule`, { scheduleAt }, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't schedule this campaign.");
    }
  }

  async function sendNow() {
    setActionError("");
    try {
      await withStepUp((token) => api.post(`/admin/notification-campaigns/${id}/send`, {}, { headers: { "x-step-up-token": token } }));
      setConfirmingSend(false);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't send this campaign.");
    }
  }

  async function cancel() {
    setActionError("");
    try {
      await api.post(`/admin/notification-campaigns/${id}/cancel`);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't cancel this campaign.");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-campaign-detail-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-[var(--red)]" data-testid="admin-campaign-detail-error">{error}</div>;
  }

  const isDraft = campaign.status === "draft";

  return (
    <div className="p-8" data-testid="admin-campaign-detail-screen">
      <button data-testid="admin-campaign-detail-back-btn" onClick={() => navigate("/admin/notifications")} className="flex items-center gap-1 text-sm font-bold text-[var(--text-secondary)] mb-4">
        <ChevronLeft size={16} /> Back to Notifications
      </button>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-heading font-black text-2xl">{campaign.name}</h1>
        <span className="px-2 py-1 rounded-full text-xs font-bold capitalize bg-[var(--surface-card-hover)]" data-testid="admin-campaign-detail-status">{campaign.status}</span>
      </div>

      {actionError && <p className="text-[var(--red)] mb-4" data-testid="admin-campaign-detail-action-error">{actionError}</p>}

      <Card title="Details" testId="admin-campaign-details-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-[var(--text-tertiary)]">Category</dt>
          <dd className="capitalize" data-testid="admin-campaign-detail-category">{campaign.categoryKey}</dd>
          <dt className="text-[var(--text-tertiary)]">Channels</dt>
          <dd data-testid="admin-campaign-detail-channels">{(campaign.channels || []).map((c) => CHANNEL_LABELS[c] || c).join(", ") || "—"}</dd>
          {sender?.sendsEmail && (
            <>
              <dt className="text-[var(--text-tertiary)]">Email sent from</dt>
              <dd data-testid="admin-campaign-detail-sender">
                {sender.kind === "marketing" ? "Marketing address" : "No-reply address"}
                {sender.from ? <span className="text-[var(--text-secondary)]">{` — ${sender.from}`}</span> : null}
              </dd>
            </>
          )}
          {campaign.templateKey && (
            <>
              <dt className="text-[var(--text-tertiary)]">Template</dt>
              <dd data-testid="admin-campaign-detail-template">{campaign.templateName || campaign.templateKey}</dd>
            </>
          )}
          <dt className="text-[var(--text-tertiary)]">Created</dt>
          <dd data-testid="admin-campaign-detail-created">
            {fmtDateTime(campaign.createdAt)}{campaign.createdBy ? ` by ${campaign.createdBy.name || campaign.createdBy.email}` : ""}
          </dd>
          {campaign.scheduleAt && (
            <>
              <dt className="text-[var(--text-tertiary)]">Scheduled for</dt>
              <dd data-testid="admin-campaign-detail-scheduled">{fmtDateTime(campaign.scheduleAt)}</dd>
            </>
          )}
          {campaign.sentAt && (
            <>
              <dt className="text-[var(--text-tertiary)]">Sent</dt>
              <dd data-testid="admin-campaign-detail-sent">{fmtDateTime(campaign.sentAt)}</dd>
            </>
          )}
          {campaign.error && (
            <>
              <dt className="text-[var(--text-tertiary)]">Error</dt>
              <dd className="text-[var(--red)]" data-testid="admin-campaign-detail-error-text">{campaign.error}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card title="Content" testId="admin-campaign-content-card">
        {editing && editForm ? (
          <div data-testid="admin-campaign-content-editor">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input
                data-testid="admin-campaign-edit-name-input"
                aria-label="Campaign name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Campaign name"
                className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
              <select
                data-testid="admin-campaign-edit-category-select"
                aria-label="Category"
                value={editForm.categoryKey}
                onChange={(e) => setEditForm((f) => ({ ...f, categoryKey: e.target.value }))}
                className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              >
                {!categories.some((c) => c.key === editForm.categoryKey) && <option value={editForm.categoryKey}>{editForm.categoryKey}</option>}
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex gap-4 mb-3 text-xs font-bold">
              {["in_app", "email", "popup"].map((ch) => (
                <label key={ch} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    data-testid={`admin-campaign-edit-channel-${ch}`}
                    checked={editForm.channels.includes(ch)}
                    disabled={campaign.audience === "external"}
                    onChange={(e) => setEditForm((f) => ({ ...f, channels: e.target.checked ? [...f.channels, ch] : f.channels.filter((c) => c !== ch) }))}
                  />
                  {CHANNEL_LABELS[ch]}
                </label>
              ))}
            </div>
            {campaign.audience === "external" && (
              <p className="text-[10px] text-[var(--text-tertiary)] mb-3" data-testid="admin-campaign-edit-email-only-note">
                This campaign goes to an email list, so it can only be sent by email.
              </p>
            )}
            {campaign.templateKey && (
              <p className="text-xs text-[var(--text-secondary)] mb-3" data-testid="admin-campaign-edit-template-note">
                This campaign uses the template “{campaign.templateName || campaign.templateKey}”. Saving turns it into custom content for this campaign only — the template itself isn't changed.
              </p>
            )}
            <NotificationContentFields testIdPrefix="admin-campaign-edit" value={editForm.content} onChange={(content) => setEditForm((f) => ({ ...f, content }))} />
            <div className="flex items-center justify-end gap-3">
              <button type="button" data-testid="admin-campaign-edit-cancel-btn" onClick={() => setEditing(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
              <button
                type="button"
                data-testid="admin-campaign-edit-save-btn"
                disabled={
                  savingContent ||
                  !editForm.name.trim() ||
                  !(editForm.content.subject || "").trim() ||
                  !(editForm.content.bodyMarkdown || "").trim() ||
                  editForm.channels.length === 0
                }
                onClick={saveContent}
                className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
              >
                Save content
              </button>
            </div>
          </div>
        ) : (
          <>
            <ContentPreview campaign={campaign} />
            {isDraft && (
              <button type="button" data-testid="admin-campaign-edit-content-btn" onClick={startEditing} className="mt-4 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
                Edit content
              </button>
            )}
          </>
        )}
      </Card>

      <Card title="Audience" testId="admin-campaign-detail-audience-card">
        {!isDraft && <AudienceSummary campaign={campaign} />}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs font-bold">
          {["all", "segment", "user_ids", "external"].map((mode) => (
            <label key={mode} className="flex items-center gap-1.5">
              <input type="radio" data-testid={`admin-campaign-audience-${mode}`} checked={audienceMode === mode} disabled={!isDraft} onChange={() => chooseAudienceMode(mode)} />
              {mode === "all" ? "All users" : mode === "segment" ? "Segment" : mode === "user_ids" ? "Specific users" : "Email list (not on Divve yet)"}
            </label>
          ))}
        </div>
        {audienceMode === "segment" && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="text-xs">
              Signed up after
              <input type="date" data-testid="admin-campaign-segment-signupfrom" disabled={!isDraft} value={segment.signupFrom ? String(segment.signupFrom).slice(0, 10) : ""} onChange={(e) => setSegment((s) => ({ ...s, signupFrom: e.target.value || undefined }))} className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none" />
            </label>
            <label className="text-xs">
              Signed up before
              <input type="date" data-testid="admin-campaign-segment-signupto" disabled={!isDraft} value={segment.signupTo ? String(segment.signupTo).slice(0, 10) : ""} onChange={(e) => setSegment((s) => ({ ...s, signupTo: e.target.value || undefined }))} className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none" />
            </label>
            <label className="text-xs">
              Holdings
              <select data-testid="admin-campaign-segment-hasholdings" disabled={!isDraft} value={segment.hasHoldings === undefined ? "" : String(segment.hasHoldings)} onChange={(e) => setSegment((s) => ({ ...s, hasHoldings: e.target.value === "" ? undefined : e.target.value === "true" }))} className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none">
                {HOLDINGS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs">
              Active in last N days
              <input type="number" min={1} data-testid="admin-campaign-segment-activesince" disabled={!isDraft} value={segment.activeSinceDays || ""} onChange={(e) => setSegment((s) => ({ ...s, activeSinceDays: e.target.value ? Number(e.target.value) : undefined }))} className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none" />
            </label>
            <label className="text-xs">
              Subscription status
              <select
                data-testid="admin-campaign-segment-subscriptionfilter"
                disabled={!isDraft}
                value={segment.subscriptionFilter || ""}
                onChange={(e) => setSegment((s) => ({ ...s, subscriptionFilter: e.target.value || undefined }))}
                className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none"
              >
                {SUBSCRIPTION_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="text-xs">
              Resilience report purchase
              <select
                data-testid="admin-campaign-segment-reportfilter"
                disabled={!isDraft}
                value={segment.reportFilter || ""}
                onChange={(e) => setSegment((s) => ({ ...s, reportFilter: e.target.value || undefined }))}
                className="block w-full mt-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 outline-none"
              >
                {REPORT_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {audienceMode === "user_ids" && (
          <textarea data-testid="admin-campaign-userids-input" disabled={!isDraft} value={userIdsText} onChange={(e) => setUserIdsText(e.target.value)} placeholder="Comma-separated user IDs" rows={2} className="w-full mb-3 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none resize-none" />
        )}
        {audienceMode === "external" && (
          <div className="mb-3" data-testid="admin-campaign-external-panel">
            <select
              data-testid="admin-campaign-external-list-select"
              aria-label="Email list"
              disabled={!isDraft}
              value={externalListKey}
              onChange={(e) => { setExternalListKey(e.target.value); setPreview(null); }}
              className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none mb-2"
            >
              <option value="">Select a list…</option>
              {(externalLists || []).map((l) => (
                <option key={l.name} value={l.name}>{`${l.name} (${l.subscribed} subscribed)`}</option>
              ))}
              {externalListKey && !(externalLists || []).some((l) => l.name === externalListKey) && <option value={externalListKey}>{externalListKey}</option>}
            </select>
            {externalLists && externalLists.length === 0 && (
              <p className="text-xs text-[var(--text-tertiary)] mb-2" data-testid="admin-campaign-external-no-lists">No email lists yet — import one in the “Email lists” tab first.</p>
            )}
            <p className="text-[10px] text-[var(--text-tertiary)]" data-testid="admin-campaign-external-note">
              Goes by email only, to people who haven't registered on Divve and haven't unsubscribed. Anyone on the list who already has an account is skipped. Every email has an unsubscribe link, and <code>{"{{name}}"}</code> / <code>{"{{first_name}}"}</code> use each person's own name ("there" if none).
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          {isDraft && <button type="button" data-testid="admin-campaign-save-audience-btn" onClick={saveAudience} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors">Save audience</button>}
          <button type="button" data-testid="admin-campaign-preview-audience-btn" onClick={previewAudience} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors">Preview audience</button>
        </div>
        {preview && (
          <p className="text-xs text-[var(--text-secondary)] mt-3" data-testid="admin-campaign-preview-result">
            {preview.count} recipient(s){preview.sample.length > 0 ? ` — e.g. ${preview.sample.map((s) => s.name).join(", ")}` : ""}
            {preview.skippedRegistered !== undefined && (
              <span data-testid="admin-campaign-preview-skipped">
                {" "}· skipped: {preview.skippedRegistered} already on Divve, {preview.skippedUnsubscribed} unsubscribed
              </span>
            )}
          </p>
        )}
      </Card>

      {isDraft && (
        <Card title="Test send" testId="admin-campaign-test-send-card">
          <div className="flex gap-2">
            <input data-testid="admin-campaign-test-email-input" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none" />
            <button type="button" data-testid="admin-campaign-test-send-btn" disabled={!testEmail.trim()} onClick={sendTest} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-bold disabled:opacity-40 hover:bg-[var(--surface-card-hover)] transition-colors">Send test</button>
          </div>
        </Card>
      )}

      {(isDraft || campaign.status === "scheduled") && (
        <Card title="Schedule or send" testId="admin-campaign-dispatch-card">
          {sender?.sendsEmail && !sender.ready && (
            <p className="mb-3 text-sm text-[var(--red)]" data-testid="admin-campaign-sender-warning">{sender.problem}</p>
          )}
          {campaign.status === "scheduled" ? (
            <p className="text-sm text-[var(--text-secondary)]">Scheduled for {new Date(campaign.scheduleAt).toLocaleString("en-IN")}.</p>
          ) : (
            <>
              <div className="flex gap-2 mb-3">
                <input type="datetime-local" data-testid="admin-campaign-schedule-input" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none" />
                <button type="button" data-testid="admin-campaign-schedule-btn" disabled={!scheduleAt} onClick={schedule} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-bold disabled:opacity-40 hover:bg-[var(--surface-card-hover)] transition-colors">Schedule</button>
              </div>
              {!confirmingSend ? (
                <button type="button" data-testid="admin-campaign-send-now-btn" onClick={() => setConfirmingSend(true)} className="gold-btn flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold">
                  <Send size={14} /> Send now
                </button>
              ) : (
                <div className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-3" data-testid="admin-campaign-send-confirm">
                  <p className="text-xs font-bold mb-2">
                    Send this campaign right now? This can't be undone.
                    {campaign.audience === "external" && ` It will be emailed to the deliverable contacts on “${campaign.externalListKey}” — check "Preview audience" for the exact count first.`}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" data-testid="admin-campaign-send-confirm-btn" onClick={sendNow} className="rounded-full bg-[var(--red)] text-white px-4 py-1.5 text-xs font-bold">Yes, send</button>
                    <button type="button" data-testid="admin-campaign-send-cancel-btn" onClick={() => setConfirmingSend(false)} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold">Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
          <button type="button" data-testid="admin-campaign-cancel-btn" onClick={cancel} className="mt-3 text-xs font-bold text-[var(--red)] hover:underline">Cancel campaign</button>
        </Card>
      )}

      {stats && (
        <Card title="Delivery" testId="admin-campaign-stats-card">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div><p className="text-2xl font-black" data-testid="admin-campaign-stat-targeted">{stats.targeted}</p><p className="text-xs text-[var(--text-tertiary)]">Targeted</p></div>
            <div><p className="text-2xl font-black" data-testid="admin-campaign-stat-sent">{stats.sent}</p><p className="text-xs text-[var(--text-tertiary)]">Sent</p></div>
            <div><p className="text-2xl font-black" data-testid="admin-campaign-stat-delivered">{stats.delivered}</p><p className="text-xs text-[var(--text-tertiary)]">Delivered</p></div>
            {campaign.audience === "external" ? (
              <div><p className="text-2xl font-black" data-testid="admin-campaign-stat-failed">{stats.failed}</p><p className="text-xs text-[var(--text-tertiary)]">Failed</p></div>
            ) : (
              <div><p className="text-2xl font-black" data-testid="admin-campaign-stat-opened">{stats.opened}</p><p className="text-xs text-[var(--text-tertiary)]">Opened</p></div>
            )}
          </div>
          {campaign.audience === "external" && (
            <p className="text-[10px] text-[var(--text-tertiary)] mt-3" data-testid="admin-campaign-stats-external-note">
              Opens aren't tracked for emails to people who aren't on Divve — there's no tracking pixel, by design.
            </p>
          )}
        </Card>
      )}

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
