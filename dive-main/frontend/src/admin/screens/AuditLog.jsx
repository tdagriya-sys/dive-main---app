import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { api } from "../../lib/api";

export default function AuditLog() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const actorId = searchParams.get("actorId") || "";
  const actorLabel = searchParams.get("actorLabel") || "";
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get("/admin/audit", { params: { page, limit: 50, actorId: actorId || undefined } });
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setError("Couldn't load the audit log. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, actorId]);

  return (
    <div className="p-8" data-testid="admin-audit-screen">
      <h1 className="font-heading font-black text-2xl mb-2">Audit Log</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-6">Every consequential staff action, append-only.</p>

      {actorId && (
        <div className="flex items-center gap-2 mb-5 text-sm" data-testid="admin-audit-actor-filter">
          <span className="text-[var(--text-secondary)]">{`Showing activity for ${actorLabel || actorId}`}</span>
          <button
            type="button"
            data-testid="admin-audit-clear-actor-btn"
            onClick={() => navigate("/admin/audit")}
            className="flex items-center gap-1 text-xs font-bold text-[var(--dive-blue)] hover:underline"
          >
            <X size={12} /> Clear filter
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-audit-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-audit-error">{error}</p>}

      {!loading && !error && result && (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-audit-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((e, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-bold">{e.action}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{e.actorLabel || "system"}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {e.resourceType}
                      {e.resourceId ? ` · ${e.resourceId}` : ""}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(e.ts).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
                {result.entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-audit-empty">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
            <span>{result.total} total</span>
            <div className="flex items-center gap-3">
              <button data-testid="admin-audit-prev-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-bold disabled:opacity-30">
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button data-testid="admin-audit-next-btn" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
