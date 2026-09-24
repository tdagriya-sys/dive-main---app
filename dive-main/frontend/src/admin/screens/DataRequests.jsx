import React, { useState, useEffect } from "react";
import { Loader2, Download, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

const STATUS_BADGE = {
  pending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  fulfilled: "bg-[var(--green)]/10 text-[var(--green)]",
  rejected: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

// Lets staff log a request that arrived outside the app (e.g. by email) so
// it enters this same queue — otherwise a "delete" request had no way to
// ever become fulfillable (see backend/src/services/dataRequestService.ts::
// createAdminLoggedRequest's own comment).
function LogRequestForm({ onLog }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [type, setType] = useState("export");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button type="button" data-testid="admin-datarequests-log-toggle-btn" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        <Plus size={14} /> Log a request
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4 w-full">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">For a request that arrived outside the app (e.g. by email).</p>
      {error && <p className="text-xs text-[var(--red)] mb-2" data-testid="admin-datarequests-log-error">{error}</p>}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input data-testid="admin-datarequests-log-email-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none" />
        <select data-testid="admin-datarequests-log-type-select" value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none">
          <option value="export">Export</option>
          <option value="delete">Delete</option>
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold text-[var(--text-tertiary)]">Cancel</button>
        <button
          type="button"
          data-testid="admin-datarequests-log-submit-btn"
          disabled={!email.trim() || busy}
          onClick={async () => {
            setError("");
            setBusy(true);
            try {
              await onLog({ email: email.trim(), type });
              setEmail("");
              setType("export");
              setOpen(false);
            } catch (err) {
              setError(err?.response?.data?.message || "Couldn't log this request.");
            } finally {
              setBusy(false);
            }
          }}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          Log request
        </button>
      </div>
    </div>
  );
}

// Mirrors useDownloadReport.js's triggerBlobDownload — the export endpoint
// streams a real file, which a plain <a href> can't authenticate.
function triggerJsonDownload(data, filename) {
  const url = window.URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * DPDP data-subject request queue, staff side (Phase 7 of
 * docs/ADMIN_PANEL_PLAN.md §4.6/§5.3/§11). Fulfilling an export or a
 * deletion each require step-up — a bulk PII export and an irreversible
 * deletion are each exactly as consequential as a refund or a role change.
 */
export default function DataRequests() {
  const [requests, setRequests] = useState(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stepUpRequest, setStepUpRequest] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/data-requests", { params: statusFilter ? { status: statusFilter } : {} });
      setRequests(data.requests);
    } catch {
      setError("Couldn't load data requests. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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

  async function fulfilExport(req) {
    setError("");
    setBusyId(req.id);
    try {
      const { data } = await withStepUp((token) => api.post(`/admin/data-requests/${req.id}/fulfil-export`, {}, { headers: { "x-step-up-token": token } }));
      triggerJsonDownload(data, `divve-data-export-${req.id}.json`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't fulfil this export request.");
    } finally {
      setBusyId(null);
    }
  }

  async function fulfilDelete(req) {
    setError("");
    setBusyId(req.id);
    try {
      await withStepUp((token) => api.post(`/admin/data-requests/${req.id}/fulfil-delete`, {}, { headers: { "x-step-up-token": token } }));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't fulfil this deletion request.");
    } finally {
      setBusyId(null);
    }
  }

  async function logRequest({ email, type }) {
    await api.post("/admin/data-requests", { email, type });
    await load();
  }

  async function reject(req) {
    const reason = window.prompt("Reason for rejecting this request?");
    if (!reason) return;
    setError("");
    setBusyId(req.id);
    try {
      await api.post(`/admin/data-requests/${req.id}/reject`, { reason });
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't reject this request.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-datarequests-loading">
        <Loader2 size={16} className="animate-spin" /> Loading data requests…
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-datarequests-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading font-black text-2xl">Data Requests</h1>
        <select data-testid="admin-datarequests-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm outline-none">
          <option value="pending">Pending</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <div className="flex justify-end mb-4"><LogRequestForm onLog={logRequest} /></div>
      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-datarequests-error">{error}</p>}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
        <table className="w-full text-sm" data-testid="admin-datarequests-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0" data-testid={`admin-datarequests-row-${r.id}`}>
                <td className="px-4 py-3">{r.userEmailSnapshot}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{r.type}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(r.requestedAt).toLocaleDateString("en-IN")}</td>
                <td className="px-4 py-3 text-right space-x-3">
                  {r.status === "pending" && r.type === "export" && (
                    <button type="button" data-testid={`admin-datarequests-fulfil-export-btn-${r.id}`} disabled={busyId === r.id} onClick={() => fulfilExport(r)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline disabled:opacity-40 inline-flex items-center gap-1">
                      <Download size={12} /> Fulfil
                    </button>
                  )}
                  {r.status === "pending" && r.type === "delete" && (
                    <button type="button" data-testid={`admin-datarequests-fulfil-delete-btn-${r.id}`} disabled={busyId === r.id} onClick={() => fulfilDelete(r)} className="text-xs font-bold text-[var(--red)] hover:underline disabled:opacity-40">
                      Fulfil (delete)
                    </button>
                  )}
                  {r.status === "pending" && (
                    <button type="button" data-testid={`admin-datarequests-reject-btn-${r.id}`} disabled={busyId === r.id} onClick={() => reject(r)} className="text-xs font-bold text-[var(--text-tertiary)] hover:underline disabled:opacity-40">
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-datarequests-empty">
                  No {statusFilter || ""} data requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
