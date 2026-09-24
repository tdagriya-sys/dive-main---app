import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

const STATUS_BADGE = {
  active: "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]",
  suspended: "bg-[var(--red)]/10 text-[var(--red)]",
  pending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  expired: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
  revoked: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

function InviteForm({ roles, onInvite, inviting }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [staffRole, setStaffRole] = useState("admin");
  const [roleId, setRoleId] = useState("");
  const [devInviteLink, setDevInviteLink] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        data-testid="admin-employees-invite-toggle-btn"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
      >
        <Plus size={14} /> Invite
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-employees-invite-form">
      <div className="grid grid-cols-3 gap-3 mb-3">
        <input
          data-testid="admin-employees-invite-email-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
        />
        <select
          data-testid="admin-employees-invite-role-select"
          value={staffRole}
          onChange={(e) => setStaffRole(e.target.value)}
          className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
        >
          <option value="admin">Admin</option>
          <option value="employee">Employee</option>
          <option value="superadmin">Superadmin</option>
        </select>
        {staffRole === "employee" && (
          <select
            data-testid="admin-employees-invite-roleid-select"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
          >
            <option value="">Select a role…</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {devInviteLink && (
        <p className="text-xs text-[var(--text-tertiary)] mb-3 break-all" data-testid="admin-employees-invite-devlink">
          Dev mode — invite link: {devInviteLink}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <button type="button" data-testid="admin-employees-invite-cancel-btn" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">
          Cancel
        </button>
        <button
          type="button"
          data-testid="admin-employees-invite-send-btn"
          disabled={inviting || !email.trim() || (staffRole === "employee" && !roleId)}
          onClick={async () => {
            const result = await onInvite({ email: email.trim(), staffRole, ...(staffRole === "employee" ? { roleId } : {}) });
            if (result?.devInviteLink) setDevInviteLink(result.devInviteLink);
            setEmail("");
          }}
          className="gold-btn flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          {inviting && <Loader2 size={14} className="animate-spin" />} Send invite
        </button>
      </div>
    </div>
  );
}

export default function Employees() {
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [stepUpRequest, setStepUpRequest] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [employeesRes, rolesRes] = await Promise.all([api.get("/admin/employees"), api.get("/admin/roles")]);
      setData(employeesRes.data);
      setRoles(rolesRes.data.roles);
    } catch {
      setError("Couldn't load employees. Please try again.");
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

  async function invite(body) {
    setInviting(true);
    try {
      const res = await withStepUp((token) => api.post("/admin/employees/invite", body, { headers: { "x-step-up-token": token } }));
      await load();
      return res.data;
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id) {
    await withStepUp((token) => api.post(`/admin/employees/invites/${id}/revoke`, {}, { headers: { "x-step-up-token": token } }));
    await load();
  }

  async function setStatus(id, status) {
    await withStepUp((token) => api.patch(`/admin/employees/${id}`, { status }, { headers: { "x-step-up-token": token } }));
    await load();
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-employees-loading">
        <Loader2 size={16} className="animate-spin" /> Loading employees…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-employees-error">
        {error}
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-employees-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Employees</h1>
        <InviteForm roles={roles} onInvite={invite} inviting={inviting} />
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden mb-8">
        <table className="w-full text-sm" data-testid="admin-employees-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">2FA</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {data.staff.map((s) => (
              <tr key={s.id} className="border-b border-[var(--border)] last:border-0" data-testid={`admin-employees-row-${s.id}`}>
                <td className="px-4 py-3 font-bold">{s.name}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{s.email}</td>
                <td className="px-4 py-3 capitalize text-[var(--text-secondary)]">{s.staffRole === "employee" ? s.roleLabel || "—" : s.staffRole}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[s.status] || ""}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-[var(--text-tertiary)]">{s.totpEnabled ? "Enrolled" : "Not enrolled"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      to={`/admin/audit?actorId=${s.id}&actorLabel=${encodeURIComponent(s.email)}`}
                      data-testid={`admin-employees-activity-link-${s.id}`}
                      className="text-xs font-bold text-[var(--dive-blue)] hover:underline"
                    >
                      Activity
                    </Link>
                    {s.staffRole !== "superadmin" && (
                      <button
                        type="button"
                        data-testid={`admin-employees-status-btn-${s.id}`}
                        onClick={() => setStatus(s.id, s.status === "active" ? "suspended" : "active")}
                        className="text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        {s.status === "active" ? "Suspend" : "Reactivate"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data.staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-employees-empty">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="font-heading font-black text-lg mb-4">Pending invites</h2>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
        <table className="w-full text-sm" data-testid="admin-employees-invites-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {data.invites.map((inv) => (
              <tr key={inv.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 text-[var(--text-secondary)]">{inv.email}</td>
                <td className="px-4 py-3 capitalize text-[var(--text-secondary)]">{inv.staffRole}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[inv.status] || ""}`}>{inv.status}</span>
                </td>
                <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(inv.expiresAt).toLocaleDateString("en-IN")}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    data-testid={`admin-employees-revoke-btn-${inv.id}`}
                    onClick={() => revokeInvite(inv.id)}
                    className="text-xs font-bold text-[var(--red)] hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {data.invites.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-employees-invites-empty">
                  No pending invites.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
