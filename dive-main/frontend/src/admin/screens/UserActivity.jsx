import React, { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Download, Search, RotateCcw } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

const GROUPS = [
  { value: "", label: "All groups" },
  { value: "security", label: "Security" },
  { value: "account", label: "Account" },
  { value: "portfolio", label: "Portfolio" },
  { value: "billing", label: "Billing" },
  { value: "support", label: "Support" },
];
const GROUP_LABEL = Object.fromEntries(GROUPS.filter((g) => g.value).map((g) => [g.value, g.label]));

const EMPTY_FILTERS = { user: "", group: "", type: "", from: "", to: "" };

// Only the filters that are actually set go on the URL of the request.
function toParams(f) {
  const p = {};
  for (const k of ["user", "group", "type", "from", "to"]) if (f[k]) p[k] = f[k];
  return p;
}

// Mirrors DataRequests.jsx's triggerJsonDownload — the export is authenticated
// (step-up), which a plain <a href> can't do.
function triggerCsvDownload(text, filename) {
  const url = window.URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * What USERS did in the app — logins and failed logins, password changes,
 * holdings, payments, support tickets. Deliberately a separate screen from the
 * Audit Log, which stays the append-only trail of STAFF actions. Raw events are
 * kept about 180 days. Viewing needs users.view; the CSV export needs
 * users.export plus a step-up re-authentication, and is itself written to the
 * Audit Log.
 */
export default function UserActivity() {
  const [searchParams] = useSearchParams();
  const initial = useMemo(
    () => ({ ...EMPTY_FILTERS, user: searchParams.get("user") || "", group: searchParams.get("group") || "", type: searchParams.get("type") || "" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [form, setForm] = useState(initial); // what's typed in the filter bar
  const [applied, setApplied] = useState(initial); // what the table is showing
  const [page, setPage] = useState(1);
  const [types, setTypes] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [stepUpRequest, setStepUpRequest] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/admin/user-activity/types")
      .then(({ data }) => !cancelled && setTypes(data.types || []))
      .catch(() => {
        /* best-effort — the type filter just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const { data } = await api.get("/admin/user-activity", { params: { ...toParams(applied), page, limit: 50 } });
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || "Couldn't load user activity. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied, page]);

  const visibleTypes = types.filter((t) => !form.group || t.group === form.group);

  function change(key, value) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Picking a group that doesn't contain the chosen event type clears the type.
      if (key === "group" && next.type && value && types.find((t) => t.type === next.type)?.group !== value) next.type = "";
      return next;
    });
  }
  function apply(e) {
    e?.preventDefault();
    setNotice("");
    setPage(1);
    setApplied(form);
  }
  function reset() {
    setNotice("");
    setPage(1);
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
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

  async function exportCsv() {
    setError("");
    setNotice("");
    setExporting(true);
    try {
      const res = await withStepUp((token) => api.get("/admin/user-activity/export", { params: toParams(applied), headers: token ? { "x-step-up-token": token } : undefined }));
      triggerCsvDownload(res.data, `user-activity-${new Date().toISOString().slice(0, 10)}.csv`);
      const count = res.headers?.["x-export-row-count"];
      const truncated = res.headers?.["x-export-truncated"] === "true";
      const limit = res.headers?.["x-export-row-limit"];
      setNotice(
        `Exported ${count ?? "the"} row${count === "1" ? "" : "s"}${truncated ? ` — only the newest ${limit ?? "10,000"}; narrow the filters to get the rest` : ""}. This export was recorded in the Audit Log.`
      );
    } catch (err) {
      if (err?.message !== "Step-up cancelled") setError(err?.response?.data?.message || "Couldn't export. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const inputCls = "rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none";

  return (
    <div className="p-8" data-testid="admin-activity-screen">
      <h1 className="font-heading font-black text-2xl mb-2">User Activity</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-1">
        What users did in the app — logins and failed logins, password changes, holdings, payments and support tickets. Kept for about 180 days.
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">
        This is separate from the <Link to="/admin/audit" className="font-bold text-[var(--dive-blue)] hover:underline">Audit Log</Link>, which records staff actions only.
      </p>

      <form onSubmit={apply} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 mb-4" data-testid="admin-activity-filters">
        <div className="grid grid-cols-5 gap-3 mb-3">
          <input data-testid="admin-activity-user-input" aria-label="User" value={form.user} onChange={(e) => change("user", e.target.value)} placeholder="User — email or id" className={`${inputCls} col-span-2`} />
          <select data-testid="admin-activity-group-select" aria-label="Group" value={form.group} onChange={(e) => change("group", e.target.value)} className={inputCls}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          <select data-testid="admin-activity-type-select" aria-label="Event type" value={form.type} onChange={(e) => change("type", e.target.value)} className={`${inputCls} col-span-2`}>
            <option value="">All events</option>
            {visibleTypes.map((t) => (
              <option key={t.type} value={t.type}>{`${t.label}`}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs font-bold text-[var(--text-tertiary)]">
            From
            <input data-testid="admin-activity-from-input" type="date" value={form.from} onChange={(e) => change("from", e.target.value)} className={`${inputCls} block mt-1`} />
          </label>
          <label className="text-xs font-bold text-[var(--text-tertiary)]">
            To
            <input data-testid="admin-activity-to-input" type="date" value={form.to} onChange={(e) => change("to", e.target.value)} className={`${inputCls} block mt-1`} />
          </label>
          <button type="submit" data-testid="admin-activity-apply-btn" className="gold-btn flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold">
            <Search size={14} /> Apply
          </button>
          <button type="button" data-testid="admin-activity-reset-btn" onClick={reset} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
            <RotateCcw size={14} /> Reset
          </button>
          <button
            type="button"
            data-testid="admin-activity-export-btn"
            disabled={exporting}
            onClick={exportCsv}
            className="ml-auto flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold disabled:opacity-40 hover:bg-[var(--surface-card-hover)] transition-colors"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export CSV
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)] mt-2">Dates are in IST. Export asks you to re-enter your password and covers the filters above (up to 10,000 rows).</p>
      </form>

      {notice && <p className="text-sm text-[var(--green)] mb-3" data-testid="admin-activity-notice">{notice}</p>}
      {error && <p className="text-[var(--red)] mb-3" data-testid="admin-activity-error">{error}</p>}
      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-activity-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && result && (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-activity-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">When (IST)</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] last:border-0 align-top" data-testid={`admin-activity-row-${e.id}`}>
                    <td className="px-4 py-3 text-[var(--text-tertiary)] whitespace-nowrap">{new Date(e.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold">{e.label}</span>
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${e.group === "security" ? "bg-[var(--red)]/10 text-[var(--red)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}
                        data-testid={`admin-activity-group-${e.id}`}
                      >
                        {GROUP_LABEL[e.group] || "Other"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {e.userId && e.userEmail ? (
                        <Link to={`/admin/users/${e.userId}`} className="font-bold text-[var(--dive-blue)] hover:underline" data-testid={`admin-activity-user-${e.id}`}>
                          {e.userEmail}
                        </Link>
                      ) : e.userId ? (
                        <span className="text-[var(--text-tertiary)]" data-testid={`admin-activity-user-${e.id}`}>Deleted account</span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]" data-testid={`admin-activity-user-${e.id}`}>No account</span>
                      )}
                      {e.userName && <div className="text-xs text-[var(--text-tertiary)]">{e.userName}</div>}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{e.summary || "—"}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{e.ip || "—"}</td>
                  </tr>
                ))}
                {result.events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-activity-empty">
                      No activity matches these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
            <span data-testid="admin-activity-total">{`${result.total} event${result.total === 1 ? "" : "s"}`}</span>
            <div className="flex items-center gap-3">
              <button data-testid="admin-activity-prev-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-bold disabled:opacity-30">
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button data-testid="admin-activity-next-btn" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        </>
      )}

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
