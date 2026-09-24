import React, { useState, useEffect } from "react";
import { Loader2, Plus } from "lucide-react";
import { api } from "../../lib/api";

/**
 * Feature-flag admin CRUD (Phase 7 of docs/ADMIN_PANEL_PLAN.md §11 —
 * "Feature flags / gradual rollout"). No step-up on any action here — a
 * flag only ever changes what's shown to a cohort of users, it moves no
 * money and deletes nothing.
 */
function NewFlagForm({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");

  if (!open) {
    return (
      <button type="button" data-testid="admin-flags-new-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> New flag
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4 w-full">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input data-testid="admin-flags-new-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="flag_key" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <input data-testid="admin-flags-new-description-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-flags-new-create-btn"
          disabled={!key.trim()}
          onClick={async () => {
            await onCreate({ key: key.trim(), description: description.trim() || undefined });
            setKey("");
            setDescription("");
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

function FlagRow({ flag, onUpdate }) {
  const [rolloutPct, setRolloutPct] = useState(flag.rolloutPct);
  const [planKeysText, setPlanKeysText] = useState(flag.enabledForPlanKeys.join(", "));

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-3" data-testid={`admin-flags-row-${flag.id}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-bold">{flag.key}</p>
          {flag.description && <p className="text-xs text-[var(--text-tertiary)]">{flag.description}</p>}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-bold">
          <input data-testid={`admin-flags-enabled-toggle-${flag.id}`} type="checkbox" checked={flag.enabled} onChange={(e) => onUpdate(flag.id, { enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--text-tertiary)] flex items-center gap-2">
          Rollout
          <input
            data-testid={`admin-flags-rollout-input-${flag.id}`}
            type="number"
            min={0}
            max={100}
            value={rolloutPct}
            onChange={(e) => setRolloutPct(Number(e.target.value))}
            onBlur={() => onUpdate(flag.id, { rolloutPct })}
            className="w-16 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
          />
          %
        </label>
        <label className="text-xs text-[var(--text-tertiary)] flex items-center gap-2 flex-1">
          Plans
          <input
            data-testid={`admin-flags-planKeys-input-${flag.id}`}
            value={planKeysText}
            onChange={(e) => setPlanKeysText(e.target.value)}
            onBlur={() => onUpdate(flag.id, { enabledForPlanKeys: planKeysText.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="premium_monthly, premium_annual"
            className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
          />
        </label>
      </div>
      <p className="text-xs text-[var(--text-tertiary)] mt-2">Last updated by {flag.updatedBy || "—"}</p>
    </div>
  );
}

export default function FeatureFlags() {
  const [flags, setFlags] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/feature-flags");
      setFlags(data.flags);
    } catch {
      setError("Couldn't load feature flags. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createFlag(body) {
    setError("");
    try {
      await api.post("/admin/feature-flags", body);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't create this flag.");
    }
  }

  async function updateFlag(id, body) {
    setError("");
    try {
      await api.patch(`/admin/feature-flags/${id}`, body);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't update this flag.");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-flags-loading">
        <Loader2 size={16} className="animate-spin" /> Loading feature flags…
      </div>
    );
  }
  if (error && !flags) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-flags-error">
        {error}
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-flags-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Feature Flags</h1>
      </div>
      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-flags-mutation-error">{error}</p>}
      <div className="flex justify-end mb-4"><NewFlagForm onCreate={createFlag} /></div>
      {flags.map((f) => (
        <FlagRow key={f.id} flag={f} onUpdate={updateFlag} />
      ))}
      {flags.length === 0 && <p className="text-center text-[var(--text-tertiary)] py-8" data-testid="admin-flags-empty">No feature flags yet.</p>}
    </div>
  );
}
