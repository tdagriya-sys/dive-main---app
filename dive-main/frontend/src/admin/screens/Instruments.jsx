import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";

export default function Instruments() {
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/instruments", { params: { q: q || undefined, assetClass: assetClass || undefined, page } });
      setResult(data);
    } catch {
      setError("Couldn't load instruments. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [q, assetClass, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const { data } = await api.post("/admin/instruments/refresh");
      setRefreshMessage(data.message || "Refresh complete.");
      load();
    } catch {
      setRefreshMessage("Refresh failed. Check the System screen for integration status.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="p-8" data-testid="admin-instruments-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Instruments</h1>
        <button
          data-testid="admin-instruments-refresh-btn"
          onClick={triggerRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      {refreshMessage && <p className="text-sm text-[var(--text-secondary)] mb-4" data-testid="admin-instruments-refresh-message">{refreshMessage}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2.5 max-w-sm flex-1">
          <Search size={16} className="text-[var(--text-tertiary)] mr-2 shrink-0" />
          <input
            data-testid="admin-instruments-search-input"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search name, symbol, or issuer"
            className="flex-1 outline-none bg-transparent text-sm font-semibold text-[var(--text-primary)]"
          />
        </div>
        <select
          data-testid="admin-instruments-assetclass-select"
          value={assetClass}
          onChange={(e) => {
            setPage(1);
            setAssetClass(e.target.value);
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2.5 text-sm font-semibold text-[var(--text-primary)]"
        >
          <option value="">All asset classes</option>
          {["EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "CRYPTO", "PF"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-instruments-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-instruments-error">{error}</p>}

      {!loading && !error && result && (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-instruments-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Refreshed</th>
                </tr>
              </thead>
              <tbody>
                {result.instruments.map((i) => (
                  <tr key={i._id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-bold">{i.name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.symbol}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.assetClass}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.source}</td>
                    <td className="px-4 py-3">{i.isActive ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{i.lastRefreshedAt ? new Date(i.lastRefreshedAt).toLocaleDateString("en-IN") : "—"}</td>
                  </tr>
                ))}
                {result.instruments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-instruments-empty">
                      No instruments match this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
            <span>{result.total} total</span>
            <div className="flex items-center gap-3">
              <button data-testid="admin-instruments-prev-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-bold disabled:opacity-30">
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button data-testid="admin-instruments-next-btn" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
