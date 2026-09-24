import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";

function CategoryRow({ category, onUpdate, onDelete }) {
  const [label, setLabel] = useState(category.label);
  const [slaHours, setSlaHours] = useState(category.slaHours);
  const [defaultPriority, setDefaultPriority] = useState(category.defaultPriority);
  const dirty = label !== category.label || Number(slaHours) !== category.slaHours || defaultPriority !== category.defaultPriority;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-ticket-settings-category-row-${category.id}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[var(--text-tertiary)] font-bold">{category.key}</p>
        <button type="button" data-testid={`admin-ticket-settings-category-delete-btn-${category.id}`} onClick={() => onDelete(category.id)} className="text-[var(--text-tertiary)] hover:text-[var(--red)]">
          <Trash2 size={15} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input data-testid={`admin-ticket-settings-category-label-${category.id}`} value={label} onChange={(e) => setLabel(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <select data-testid={`admin-ticket-settings-category-priority-${category.id}`} value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <input data-testid={`admin-ticket-settings-category-sla-${category.id}`} type="number" min={1} value={slaHours} onChange={(e) => setSlaHours(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      {dirty && (
        <button
          type="button"
          data-testid={`admin-ticket-settings-category-save-btn-${category.id}`}
          onClick={() => onUpdate(category.id, { label, slaHours: Number(slaHours), defaultPriority })}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
        >
          Save
        </button>
      )}
    </div>
  );
}

function NewCategoryForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  if (!open) {
    return (
      <button type="button" data-testid="admin-ticket-settings-new-category-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New category
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4 flex items-center gap-2">
      <input data-testid="admin-ticket-settings-new-category-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      <input data-testid="admin-ticket-settings-new-category-label-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      <button
        type="button"
        data-testid="admin-ticket-settings-new-category-create-btn"
        disabled={!key.trim() || !label.trim()}
        onClick={async () => {
          await onCreate({ key: key.trim(), label: label.trim() });
          setKey("");
          setLabel("");
          setOpen(false);
        }}
        className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
      >
        Create
      </button>
    </div>
  );
}

function CannedResponseRow({ response, onDelete }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-ticket-settings-canned-row-${response.id}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-bold">{response.title}</p>
        <button type="button" data-testid={`admin-ticket-settings-canned-delete-btn-${response.id}`} onClick={() => onDelete(response.id)} className="text-[var(--text-tertiary)] hover:text-[var(--red)]">
          <Trash2 size={15} />
        </button>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{response.body}</p>
    </div>
  );
}

function NewCannedResponseForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  if (!open) {
    return (
      <button type="button" data-testid="admin-ticket-settings-new-canned-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New canned response
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4">
      <input data-testid="admin-ticket-settings-new-canned-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      <textarea data-testid="admin-ticket-settings-new-canned-body-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Response text…" rows={3} className="w-full mb-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none resize-none" />
      <button
        type="button"
        data-testid="admin-ticket-settings-new-canned-create-btn"
        disabled={!title.trim() || !body.trim()}
        onClick={async () => {
          await onCreate({ title: title.trim(), body: body.trim() });
          setTitle("");
          setBody("");
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
 * Ticket-category and canned-response admin CRUD (Phase 4 of
 * docs/ADMIN_PANEL_PLAN.md §7) — reached from Tickets.jsx's "Categories &
 * canned responses" button rather than living in the main sidebar, since
 * both are occasional configuration, not day-to-day ticket work.
 */
export default function TicketSettings() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState(null);
  const [cannedResponses, setCannedResponses] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [catRes, cannedRes] = await Promise.all([api.get("/admin/ticket-categories"), api.get("/admin/canned-responses")]);
      setCategories(catRes.data.categories);
      setCannedResponses(cannedRes.data.cannedResponses);
    } catch {
      setError("Couldn't load ticket settings. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCategory(body) {
    await api.post("/admin/ticket-categories", body);
    await load();
  }
  async function updateCategory(id, body) {
    await api.patch(`/admin/ticket-categories/${id}`, body);
    await load();
  }
  async function deleteCategory(id) {
    try {
      await api.delete(`/admin/ticket-categories/${id}`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't delete this category.");
    }
  }
  async function createCannedResponse(body) {
    await api.post("/admin/canned-responses", body);
    await load();
  }
  async function deleteCannedResponse(id) {
    await api.delete(`/admin/canned-responses/${id}`);
    await load();
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-ticket-settings-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-ticket-settings-screen">
      <button data-testid="admin-ticket-settings-back-btn" onClick={() => navigate("/admin/tickets")} className="flex items-center gap-1 text-sm font-bold text-[var(--text-secondary)] mb-4">
        <ChevronLeft size={16} /> Back to Tickets
      </button>
      <h1 className="font-heading font-black text-2xl mb-6">Categories & canned responses</h1>
      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-ticket-settings-error">{error}</p>}

      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-black text-lg">Categories</h2>
            <NewCategoryForm onCreate={createCategory} />
          </div>
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} onUpdate={updateCategory} onDelete={deleteCategory} />
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-black text-lg">Canned responses</h2>
            <NewCannedResponseForm onCreate={createCannedResponse} />
          </div>
          {cannedResponses.length === 0 && <p className="text-[var(--text-tertiary)]" data-testid="admin-ticket-settings-canned-empty">No canned responses yet.</p>}
          {cannedResponses.map((c) => (
            <CannedResponseRow key={c.id} response={c} onDelete={deleteCannedResponse} />
          ))}
        </div>
      </div>
    </div>
  );
}
