import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import HighlightStyleFields, { cleanHighlightStyle } from "../HighlightStyleFields";
import CalloutFields, { cleanCallout } from "../CalloutFields";
import ButtonFields, { cleanButton } from "../ButtonFields";
import NotificationContentFields from "../NotificationContentFields";
import LandingPopups from "./LandingPopups";
import ExternalLists from "./ExternalLists";

const CHANNEL_LABELS = { in_app: "In-app", email: "Email", popup: "Pop-up card" };

const STATUS_BADGE = {
  draft: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
  scheduled: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  sending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  sent: "bg-[var(--green)]/10 text-[var(--green)]",
  cancelled: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
  failed: "bg-[var(--red)]/10 text-[var(--red)]",
};

function NewCampaignForm({ categories, templates, onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryKey, setCategoryKey] = useState(categories[0]?.key || "");
  const [channels, setChannels] = useState(["in_app"]);
  const [contentMode, setContentMode] = useState("inline"); // "inline" | "template"
  const [templateKey, setTemplateKey] = useState("");
  const [content, setContent] = useState({ subject: "", bodyMarkdown: "" });
  const [creating, setCreating] = useState(false);

  if (!open) {
    return (
      <button type="button" data-testid="admin-notifications-new-campaign-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New campaign
      </button>
    );
  }

  const canCreate = name.trim() && categoryKey && channels.length > 0 && (contentMode === "template" ? templateKey : (content.subject || "").trim() && (content.bodyMarkdown || "").trim());

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-notifications-new-campaign-form">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <input data-testid="admin-notifications-new-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none" />
        <select data-testid="admin-notifications-new-category-select" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none">
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div className="flex gap-4 mb-3 text-xs font-bold">
        {["in_app", "email", "popup"].map((ch) => (
          <label key={ch} className="flex items-center gap-1.5">
            <input type="checkbox" data-testid={`admin-notifications-new-channel-${ch}`} checked={channels.includes(ch)} onChange={(e) => setChannels(e.target.checked ? [...channels, ch] : channels.filter((c) => c !== ch))} />
            {CHANNEL_LABELS[ch]}
          </label>
        ))}
      </div>
      <div className="flex gap-4 mb-3 text-xs font-bold">
        <label className="flex items-center gap-1.5">
          <input type="radio" data-testid="admin-notifications-new-mode-inline" checked={contentMode === "inline"} onChange={() => setContentMode("inline")} /> Write inline
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" data-testid="admin-notifications-new-mode-template" checked={contentMode === "template"} onChange={() => setContentMode("template")} /> Use a template
        </label>
      </div>
      {contentMode === "template" ? (
        <select data-testid="admin-notifications-new-template-select" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className="w-full mb-3 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none">
          <option value="">Select a template…</option>
          {templates.filter((t) => t.isActive).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
      ) : (
        <NotificationContentFields testIdPrefix="admin-notifications-new" value={content} onChange={setContent} />
      )}
      <div className="flex items-center justify-end gap-3">
        <button type="button" data-testid="admin-notifications-new-cancel-btn" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-notifications-new-create-btn"
          disabled={creating || !canCreate}
          onClick={async () => {
            setCreating(true);
            try {
              await onCreate({
                name: name.trim(),
                categoryKey,
                channels,
                audience: "all",
                ...(contentMode === "template"
                  ? { templateKey }
                  : {
                      inlineContent: {
                        subject: content.subject.trim(),
                        bodyMarkdown: content.bodyMarkdown.trim(),
                        highlightStyle: cleanHighlightStyle(content.highlightStyle),
                        callout: cleanCallout(content.callout),
                        button: cleanButton(content.button),
                      },
                    }),
              });
              setOpen(false);
              setName("");
              setContent({ subject: "", bodyMarkdown: "" });
            } finally {
              setCreating(false);
            }
          }}
          className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          Create draft
        </button>
      </div>
    </div>
  );
}

function TemplateRow({ template, onUpdate, onDelete }) {
  const [subject, setSubject] = useState(template.subject);
  const [bodyMarkdown, setBodyMarkdown] = useState(template.bodyMarkdown);
  const [channels, setChannels] = useState(template.channels || ["in_app"]);
  const [highlightStyle, setHighlightStyle] = useState(template.highlightStyle || undefined);
  const [callout, setCallout] = useState(template.callout || undefined);
  const [button, setButton] = useState(template.button || undefined);
  const dirty =
    subject !== template.subject ||
    bodyMarkdown !== template.bodyMarkdown ||
    JSON.stringify(channels) !== JSON.stringify(template.channels || ["in_app"]) ||
    JSON.stringify(cleanHighlightStyle(highlightStyle) || null) !== JSON.stringify(template.highlightStyle || null) ||
    JSON.stringify(cleanCallout(callout) || null) !== JSON.stringify(template.callout || null) ||
    JSON.stringify(cleanButton(button) || null) !== JSON.stringify(template.button || null);
  // An optional block the user emptied out is sent as an explicit `null` so
  // the backend actually clears it (an omitted field means "unchanged");
  // one that was never set stays omitted.
  const clearable = (current, saved) => current ?? (saved ? null : undefined);
  const preview = bodyMarkdown.replace(/\{\{\s*name\s*\}\}/gi, "Ada Example").replace(/\{\{\s*email\s*\}\}/gi, "ada@example.com");

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-notifications-template-row-${template.id}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-bold">{template.name}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{template.key} · {template.categoryKey}</p>
        </div>
        <button type="button" data-testid={`admin-notifications-template-delete-btn-${template.id}`} onClick={() => onDelete(template.id)} className="text-[var(--text-tertiary)] hover:text-[var(--red)]"><Trash2 size={15} /></button>
      </div>
      <CalloutFields testIdPrefix={`admin-notifications-template-callout-${template.id}`} value={callout} onChange={setCallout} />
      <input data-testid={`admin-notifications-template-subject-${template.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      <textarea data-testid={`admin-notifications-template-body-${template.id}`} value={bodyMarkdown} onChange={(e) => setBodyMarkdown(e.target.value)} rows={2} className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none resize-none" />
      <p className="text-xs text-[var(--text-tertiary)] italic mb-2" data-testid={`admin-notifications-template-preview-${template.id}`}>Preview: {preview}</p>
      <div className="flex gap-4 mb-2 text-xs font-bold">
        {["in_app", "email", "popup"].map((ch) => (
          <label key={ch} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              data-testid={`admin-notifications-template-channel-${ch}-${template.id}`}
              checked={channels.includes(ch)}
              onChange={(e) => setChannels(e.target.checked ? [...channels, ch] : channels.filter((c) => c !== ch))}
            />
            {CHANNEL_LABELS[ch]}
          </label>
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Highlight style — applies to every ==highlighted== span above. ==Highlights==, images, and the callout only show on email/pop-up; the bell (in-app) shows plain text with bold only.</p>
      <div className="mb-2">
        <HighlightStyleFields testIdPrefix={`admin-notifications-template-highlight-${template.id}`} value={highlightStyle} onChange={setHighlightStyle} />
      </div>
      <ButtonFields testIdPrefix={`admin-notifications-template-button-${template.id}`} value={button} onChange={setButton} />
      {dirty && (
        <button
          type="button"
          data-testid={`admin-notifications-template-save-btn-${template.id}`}
          onClick={() =>
            onUpdate(template.id, {
              subject,
              bodyMarkdown,
              channels,
              highlightStyle: clearable(cleanHighlightStyle(highlightStyle), template.highlightStyle),
              callout: clearable(cleanCallout(callout), template.callout),
              button: clearable(cleanButton(button), template.button),
            })
          }
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
        >
          Save
        </button>
      )}
    </div>
  );
}

function NewTemplateForm({ categories, onCreate }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [categoryKey, setCategoryKey] = useState(categories[0]?.key || "");
  const [subject, setSubject] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [channels, setChannels] = useState(["in_app"]);
  const [callout, setCallout] = useState(undefined);
  const [button, setButton] = useState(undefined);

  if (!open) {
    return (
      <button type="button" data-testid="admin-notifications-new-template-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New template
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4">
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input data-testid="admin-notifications-newtpl-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <input data-testid="admin-notifications-newtpl-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <select data-testid="admin-notifications-newtpl-category-select" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <CalloutFields testIdPrefix="admin-notifications-newtpl-callout" value={callout} onChange={setCallout} />
      <input data-testid="admin-notifications-newtpl-subject-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      <textarea data-testid="admin-notifications-newtpl-body-input" value={bodyMarkdown} onChange={(e) => setBodyMarkdown(e.target.value)} placeholder="Body markdown… (**bold**, ==highlighted==, ![alt](image-url), [words](link))" rows={2} className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none resize-none" />
      <div className="flex gap-4 mb-2 text-xs font-bold">
        {["in_app", "email", "popup"].map((ch) => (
          <label key={ch} className="flex items-center gap-1.5">
            <input type="checkbox" data-testid={`admin-notifications-newtpl-channel-${ch}`} checked={channels.includes(ch)} onChange={(e) => setChannels(e.target.checked ? [...channels, ch] : channels.filter((c) => c !== ch))} />
            {CHANNEL_LABELS[ch]}
          </label>
        ))}
      </div>
      <ButtonFields testIdPrefix="admin-notifications-newtpl-button" value={button} onChange={setButton} />
      <button
        type="button"
        data-testid="admin-notifications-newtpl-create-btn"
        disabled={!key.trim() || !name.trim() || !subject.trim() || !bodyMarkdown.trim()}
        onClick={async () => {
          await onCreate({ key: key.trim(), name: name.trim(), categoryKey, subject: subject.trim(), bodyMarkdown: bodyMarkdown.trim(), channels, callout: cleanCallout(callout), button: cleanButton(button) });
          setKey("");
          setName("");
          setSubject("");
          setBodyMarkdown("");
          setCallout(undefined);
          setButton(undefined);
          setOpen(false);
        }}
        className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
      >
        Create
      </button>
    </div>
  );
}

/**
 * Notification campaigns + templates (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5/§7). Campaign rows route to NotificationCampaignDetail.jsx (the
 * segment builder, schedule/send/cancel actions, and delivery dashboard —
 * same list->detail convention as Users/Tickets). Category management is
 * folded into the Templates tab rather than a fourth nav item, since
 * they're both gated by the same `notifications.manage_templates`
 * permission and edited far less often than campaigns.
 */
export default function Notifications() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("campaigns");
  const [campaigns, setCampaigns] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [campaignsRes, templatesRes, categoriesRes] = await Promise.all([
        api.get("/admin/notification-campaigns"),
        api.get("/admin/notification-templates"),
        api.get("/admin/notification-categories"),
      ]);
      setCampaigns(campaignsRes.data.campaigns);
      setTemplates(templatesRes.data.templates);
      setCategories(categoriesRes.data.categories);
    } catch {
      setError("Couldn't load notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCampaign(body) {
    const { data } = await api.post("/admin/notification-campaigns", body);
    navigate(`/admin/notifications/campaigns/${data.campaign.id}`);
  }
  async function createTemplate(body) {
    await api.post("/admin/notification-templates", body);
    await load();
  }
  async function updateTemplate(id, body) {
    await api.patch(`/admin/notification-templates/${id}`, body);
    await load();
  }
  async function deleteTemplate(id) {
    try {
      await api.delete(`/admin/notification-templates/${id}`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't delete this template.");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-notifications-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-notifications-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Notifications</h1>
        <div className="flex gap-2">
          <button data-testid="admin-notifications-tab-campaigns" onClick={() => setTab("campaigns")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "campaigns" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Campaigns</button>
          <button data-testid="admin-notifications-tab-templates" onClick={() => setTab("templates")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "templates" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Templates</button>
          <button data-testid="admin-notifications-tab-lists" onClick={() => setTab("lists")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "lists" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Email lists</button>
          <button data-testid="admin-notifications-tab-landing" onClick={() => setTab("landing")} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "landing" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>Landing pop-ups</button>
        </div>
      </div>

      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-notifications-error">{error}</p>}

      {tab === "campaigns" && (
        <>
          <div className="flex justify-end mb-4"><NewCampaignForm categories={categories} templates={templates} onCreate={createCampaign} /></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-notifications-campaigns-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} data-testid={`admin-notifications-campaign-row-${c.id}`} onClick={() => navigate(`/admin/notifications/campaigns/${c.id}`)} className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--surface-card-hover)] transition-colors">
                    <td className="px-4 py-3 font-bold">{c.name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] capitalize">{c.categoryKey}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] capitalize">{c.audience}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[c.status] || ""}`}>{c.status}</span></td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{c.stats ? `${c.stats.sent}/${c.stats.targeted}` : "—"}</td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-notifications-campaigns-empty">No campaigns yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "templates" && (
        <>
          <div className="flex justify-end mb-4"><NewTemplateForm categories={categories} onCreate={createTemplate} /></div>
          {templates.length === 0 && <p className="text-[var(--text-tertiary)]" data-testid="admin-notifications-templates-empty">No templates yet.</p>}
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} onUpdate={updateTemplate} onDelete={deleteTemplate} />
          ))}
        </>
      )}

      {tab === "lists" && <ExternalLists />}

      {tab === "landing" && <LandingPopups />}
    </div>
  );
}
