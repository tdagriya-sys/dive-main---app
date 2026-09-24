import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { api } from "../../lib/api";

const STATUS_BADGE = {
  active: "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]",
  suspended: "bg-[var(--red)]/10 text-[var(--red)]",
  deleted: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

export default function UsersList() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/admin/users", { params: { q: q || undefined, page } });
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setError("Couldn't load users. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250); // debounced — mirrors this app's existing debounce convention (DiveContext's planner autosave)
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, page]);

  return (
    <div className="p-8" data-testid="admin-users-screen">
      <h1 className="font-heading font-black text-2xl mb-6">Users</h1>
      <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2.5 mb-5 max-w-sm">
        <Search size={16} className="text-[var(--text-tertiary)] mr-2 shrink-0" />
        <input
          data-testid="admin-users-search-input"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Search name, email, or mobile"
          className="flex-1 outline-none bg-transparent text-sm font-semibold text-[var(--text-primary)]"
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-users-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-users-error">{error}</p>}

      {!loading && !error && result && (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-users-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Age</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((u) => (
                  <tr
                    key={u.id}
                    data-testid={`admin-users-row-${u.id}`}
                    onClick={() => navigate(`/admin/users/${u.id}`)}
                    className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--surface-card-hover)] transition-colors"
                  >
                    <td className="px-4 py-3 font-bold">{u.name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{u.email}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{u.mobile}</td>
                    <td className="px-4 py-3">{u.age}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[u.status] || ""}`}>{u.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{new Date(u.createdAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
                {result.users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-users-empty">
                      No users match this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
            <span data-testid="admin-users-total">{result.total} total</span>
            <div className="flex items-center gap-3">
              <button
                data-testid="admin-users-prev-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="font-bold disabled:opacity-30"
              >
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button
                data-testid="admin-users-next-btn"
                disabled={page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="font-bold disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
