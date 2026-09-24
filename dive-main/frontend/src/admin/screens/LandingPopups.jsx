import React, { useState, useEffect } from "react";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";
import NotificationContentFields from "../NotificationContentFields";
import { cleanButton } from "../ButtonFields";
import { cleanCallout } from "../CalloutFields";
import { cleanHighlightStyle } from "../HighlightStyleFields";

// The "Landing pop-ups" tab of Admin → Notifications: pop-ups shown to
// LOGGED-OUT visitors on the public landing page (backend
// models/LandingPopup.ts). No audience or send step — an active pop-up is
// simply live for every visitor, and each visitor's browser remembers a
// dismissal for the current session only, so it reappears in a new session.
// Activating goes through step-up (it's live for everyone the instant it's
// on); an active pop-up can't be edited or deleted until it's deactivated.

// An optional block the user emptied out is sent as an explicit `null` so the
// backend actually clears it (an omitted field means "unchanged"); one that
// was never set stays omitted.
const clearable = (current, saved) => current ?? (saved ? null : undefined);

function PopupForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [content, setContent] = useState({
    subject: initial?.title || "",
    bodyMarkdown: initial?.bodyMarkdown || "",
    highlightStyle: initial?.highlightStyle || undefined,
    callout: initial?.callout || undefined,
    button: initial?.button || undefined,
  });
  const [saving, setSaving] = useState(false);
  const canSave = name.trim() && (content.subject || "").trim() && (content.bodyMarkdown || "").trim();

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-landing-popup-form">
      <input
        data-testid="admin-landing-popup-form-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Internal name (only staff see this)"
        className="w-full mb-3 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
      />
      <NotificationContentFields
        testIdPrefix="admin-landing-popup-form"
        value={content}
        onChange={setContent}
        subjectLabel="Title"
        subjectHint="Title shown on the pop-up"
        showVariablesHint={false}
      />
      <div className="flex items-center justify-end gap-3">
        <button type="button" data-testid="admin-landing-popup-form-cancel-btn" onClick={onCancel} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-landing-popup-form-save-btn"
          disabled={saving || !canSave}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                name: name.trim(),
                title: content.subject.trim(),
                bodyMarkdown: content.bodyMarkdown.trim(),
                highlightStyle: initial ? clearable(cleanHighlightStyle(content.highlightStyle), initial.highlightStyle) : cleanHighlightStyle(content.highlightStyle),
                callout: initial ? clearable(cleanCallout(content.callout), initial.callout) : cleanCallout(content.callout),
                button: initial ? clearable(cleanButton(content.button), initial.button) : cleanButton(content.button),
              });
            } finally {
              setSaving(false);
            }
          }}
          className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          {initial ? "Save changes" : "Create (inactive)"}
        </button>
      </div>
    </div>
  );
}

export default function LandingPopups() {
  const [popups, setPopups] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | popup id
  const [confirming, setConfirming] = useState(null); // { id, kind: "activate" | "delete" }
  const [stepUpRequest, setStepUpRequest] = useState(null);

  async function load() {
    try {
      const { data } = await api.get("/admin/landing-popups");
      setPopups(data.popups);
    } catch {
      setError("Couldn't load landing pop-ups. Please try again.");
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function run(action, failureMessage) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || failureMessage);
    }
  }

  const create = async (body) => {
    await api.post("/admin/landing-popups", body);
    setEditing(null);
    await load();
  };
  const update = async (id, body) => {
    await api.patch(`/admin/landing-popups/${id}`, body);
    setEditing(null);
    await load();
  };

  if (!popups && !error) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-landing-popups-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div data-testid="admin-landing-popups">
      <p className="text-xs text-[var(--text-secondary)] mb-4 max-w-2xl">
        Pop-ups shown to logged-out visitors on the public landing page. Every visitor sees each active pop-up once per browser session — it comes back when a new session starts.
        Making one live needs your password again; to change a live one, deactivate it first.
      </p>
      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-landing-popups-error">{error}</p>}

      <div className="flex justify-end mb-4">
        {editing !== "new" && (
          <button type="button" data-testid="admin-landing-popups-new-btn" onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
            <Plus size={14} /> New landing pop-up
          </button>
        )}
      </div>

      {editing === "new" && <PopupForm onSave={create} onCancel={() => setEditing(null)} />}

      {popups?.length === 0 && editing !== "new" && <p className="text-[var(--text-tertiary)]" data-testid="admin-landing-popups-empty">No landing pop-ups yet.</p>}

      {popups?.map((p) =>
        editing === p.id ? (
          <PopupForm key={p.id} initial={p} onSave={(body) => update(p.id, body)} onCancel={() => setEditing(null)} />
        ) : (
          <div key={p.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-landing-popup-row-${p.id}`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-bold">{p.name}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{p.title}</p>
              </div>
              <span
                data-testid={`admin-landing-popup-status-${p.id}`}
                className={`px-2 py-1 rounded-full text-xs font-bold ${p.isActive ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}
              >
                {p.isActive ? "Active (live)" : "Inactive"}
              </span>
            </div>

            <div className="rounded-xl bg-[var(--surface-card-hover)] p-4 mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Preview</p>
              <p className="font-heading font-black text-base mb-2" data-testid={`admin-landing-popup-preview-title-${p.id}`}>{p.title}</p>
              <div
                className="text-sm text-[var(--text-secondary)] leading-relaxed"
                data-testid={`admin-landing-popup-preview-body-${p.id}`}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: p.bodyHtml }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {p.isActive ? (
                <button type="button" data-testid={`admin-landing-popup-deactivate-btn-${p.id}`} onClick={() => run(() => api.post(`/admin/landing-popups/${p.id}/deactivate`, {}), "Couldn't deactivate this pop-up.")} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
                  Deactivate
                </button>
              ) : confirming?.id === p.id && confirming.kind === "activate" ? (
                <div className="flex items-center gap-2 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2" data-testid={`admin-landing-popup-activate-confirm-${p.id}`}>
                  <span className="text-xs font-bold">Make this live for every visitor right now?</span>
                  <button
                    type="button"
                    data-testid={`admin-landing-popup-activate-confirm-btn-${p.id}`}
                    onClick={() => {
                      setConfirming(null);
                      run(() => withStepUp((token) => api.post(`/admin/landing-popups/${p.id}/activate`, {}, { headers: { "x-step-up-token": token } })), "Couldn't activate this pop-up.");
                    }}
                    className="rounded-full bg-[var(--red)] text-white px-3 py-1 text-xs font-bold"
                  >
                    Yes, go live
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="text-xs font-bold text-[var(--text-tertiary)]">Cancel</button>
                </div>
              ) : (
                <button type="button" data-testid={`admin-landing-popup-activate-btn-${p.id}`} onClick={() => setConfirming({ id: p.id, kind: "activate" })} className="gold-btn rounded-full px-3 py-1 text-xs font-bold">
                  Activate
                </button>
              )}

              {!p.isActive && (
                <>
                  <button type="button" data-testid={`admin-landing-popup-edit-btn-${p.id}`} onClick={() => setEditing(p.id)} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
                    <Pencil size={12} /> Edit
                  </button>
                  {confirming?.id === p.id && confirming.kind === "delete" ? (
                    <span className="flex items-center gap-2">
                      <button type="button" data-testid={`admin-landing-popup-delete-confirm-btn-${p.id}`} onClick={() => { setConfirming(null); run(() => api.delete(`/admin/landing-popups/${p.id}`), "Couldn't delete this pop-up."); }} className="rounded-full bg-[var(--red)] text-white px-3 py-1 text-xs font-bold">Yes, delete</button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-xs font-bold text-[var(--text-tertiary)]">Cancel</button>
                    </span>
                  ) : (
                    <button type="button" data-testid={`admin-landing-popup-delete-btn-${p.id}`} onClick={() => setConfirming({ id: p.id, kind: "delete" })} className="text-[var(--text-tertiary)] hover:text-[var(--red)]" aria-label="Delete pop-up">
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      )}

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
