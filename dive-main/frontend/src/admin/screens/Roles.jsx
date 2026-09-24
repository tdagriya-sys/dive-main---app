import React, { useState, useEffect } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { PERMISSIONS } from "../permissions";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

// `testIdPrefix` keeps this usable both inside NewRoleForm and per-row in the
// roles list without colliding data-testids across the two contexts.
function PermissionCheckboxes({ selected, onChange, testIdPrefix }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            data-testid={`${testIdPrefix}-${p}`}
            checked={selected.includes(p)}
            onChange={(e) => onChange(e.target.checked ? [...selected, p] : selected.filter((x) => x !== p))}
          />
          {p}
        </label>
      ))}
    </div>
  );
}

function NewRoleForm({ onCreate, creating }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [permissions, setPermissions] = useState([]);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="admin-roles-new-toggle-btn"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
      >
        <Plus size={14} /> New role
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-roles-new-form">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          data-testid="admin-roles-new-key-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key (e.g. support_agent)"
          className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
        />
        <input
          data-testid="admin-roles-new-label-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Support Agent)"
          className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
        />
      </div>
      <PermissionCheckboxes selected={permissions} onChange={setPermissions} testIdPrefix="admin-roles-new-permission" />
      <div className="flex items-center justify-end gap-3 mt-4">
        <button type="button" data-testid="admin-roles-new-cancel-btn" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">
          Cancel
        </button>
        <button
          type="button"
          data-testid="admin-roles-new-create-btn"
          disabled={creating || !key.trim() || !label.trim()}
          onClick={async () => {
            await onCreate({ key: key.trim(), label: label.trim(), permissions });
            setOpen(false);
            setKey("");
            setLabel("");
            setPermissions([]);
          }}
          className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function RoleRow({ role, onUpdate, onDelete }) {
  const [permissions, setPermissions] = useState(role.permissions);
  const dirty = JSON.stringify(permissions) !== JSON.stringify(role.permissions);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-4" data-testid={`admin-roles-row-${role._id}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-heading font-black">{role.label}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{role.key}</p>
        </div>
        <button
          type="button"
          data-testid={`admin-roles-delete-btn-${role._id}`}
          onClick={() => onDelete(role._id)}
          className="text-[var(--text-tertiary)] hover:text-[var(--red)]"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <PermissionCheckboxes selected={permissions} onChange={setPermissions} testIdPrefix={`admin-roles-permission-${role._id}`} />
      {dirty && (
        <button
          type="button"
          data-testid={`admin-roles-save-btn-${role._id}`}
          onClick={() => onUpdate(role._id, { permissions })}
          className="mt-3 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
        >
          Save permissions
        </button>
      )}
    </div>
  );
}

export default function Roles() {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [stepUpRequest, setStepUpRequest] = useState(null); // { resolve, reject }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/roles");
      setRoles(data.roles);
    } catch {
      setError("Couldn't load roles. Please try again.");
    } finally {
      setLoading(false);
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

  async function createRole(body) {
    setCreating(true);
    try {
      await withStepUp((token) => api.post("/admin/roles", body, { headers: { "x-step-up-token": token } }));
      await load();
    } finally {
      setCreating(false);
    }
  }
  async function updateRole(id, body) {
    await withStepUp((token) => api.patch(`/admin/roles/${id}`, body, { headers: { "x-step-up-token": token } }));
    await load();
  }
  async function deleteRole(id) {
    try {
      await withStepUp((token) => api.delete(`/admin/roles/${id}`, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't delete this role.");
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-roles-loading">
        <Loader2 size={16} className="animate-spin" /> Loading roles…
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-roles-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Roles</h1>
        <NewRoleForm onCreate={createRole} creating={creating} />
      </div>

      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-roles-error">{error}</p>}

      {roles.length === 0 && (
        <p className="text-[var(--text-tertiary)]" data-testid="admin-roles-empty">
          No custom roles yet — employees need one to be assigned any permissions.
        </p>
      )}
      {roles.map((role) => (
        <RoleRow key={role._id} role={role} onUpdate={updateRole} onDelete={deleteRole} />
      ))}

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => {
          stepUpRequest?.reject(new Error("Step-up cancelled"));
          setStepUpRequest(null);
        }}
        onSuccess={(token) => {
          stepUpRequest?.resolve(token);
          setStepUpRequest(null);
        }}
      />
    </div>
  );
}
