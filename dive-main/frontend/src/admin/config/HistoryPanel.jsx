import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { diffPayloads } from "./versionDiff";

function formatDiffValue(v) {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function VersionDiffView({ versionA, versionB, loading, error, diffs }) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] p-4" data-testid="admin-config-diff-result">
      <p className="text-xs font-bold text-[var(--text-tertiary)] mb-3">{`Comparing v${versionA} → v${versionB}`}</p>
      {loading && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" data-testid="admin-config-diff-loading">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      )}
      {error && (
        <p className="text-sm text-[var(--red)]" data-testid="admin-config-diff-error">
          {error}
        </p>
      )}
      {!loading && !error && diffs && (
        <>
          {diffs.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]" data-testid="admin-config-diff-empty">
              No differences between these two versions.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                    <th className="pr-4 py-1">Field</th>
                    <th className="pr-4 py-1">{`v${versionA}`}</th>
                    <th className="pr-4 py-1">{`v${versionB}`}</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.path} className="border-t border-[var(--border)]">
                      <td className="pr-4 py-2 font-bold align-top">{d.path}</td>
                      <td className="pr-4 py-2 text-[var(--red)] align-top break-all">{formatDiffValue(d.before)}</td>
                      <td className="pr-4 py-2 text-[var(--green)] align-top break-all">{formatDiffValue(d.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Shared version-history table for all three config editors — every
// archived version can be rolled back to (creating a brand-new version from
// its payload, never reactivating the old document — see
// rollbackScoringConfig's own comment on the backend). Also lets an admin
// select any two versions and see a field-level diff between them (fetched
// on demand via `getVersion`, since the history list itself only carries
// version/status/changeNote metadata, not the full payload).
export default function HistoryPanel({ history, onRollback, rollingBack, getVersion }) {
  const [selected, setSelected] = useState([]);
  const [diffState, setDiffState] = useState(null);

  if (!history) return null;

  function toggleSelect(version) {
    setDiffState(null);
    setSelected((prev) => {
      if (prev.includes(version)) return prev.filter((v) => v !== version);
      if (prev.length >= 2) return [prev[1], version]; // keep the most recent two clicks
      return [...prev, version];
    });
  }

  async function runCompare() {
    const [versionA, versionB] = [...selected].sort((a, b) => a - b);
    setDiffState({ loading: true, error: "", diffs: null, versionA, versionB });
    try {
      const [docA, docB] = await Promise.all([getVersion(versionA), getVersion(versionB)]);
      const diffs = diffPayloads(docA.payload, docB.payload);
      setDiffState({ loading: false, error: "", diffs, versionA, versionB });
    } catch {
      setDiffState({ loading: false, error: "Couldn't load one or both versions to compare.", diffs: null, versionA, versionB });
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden" data-testid="admin-config-history">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
            <th className="px-4 py-3"></th>
            <th className="px-4 py-3">Version</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Change note</th>
            <th className="px-4 py-3">Published</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.version} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  data-testid={`admin-config-history-select-${h.version}`}
                  checked={selected.includes(h.version)}
                  onChange={() => toggleSelect(h.version)}
                />
              </td>
              <td className="px-4 py-3 font-bold">{`v${h.version}`}</td>
              <td className="px-4 py-3 capitalize">{h.status}</td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">{h.changeNote || "—"}</td>
              <td className="px-4 py-3 text-[var(--text-tertiary)]">{h.publishedAt ? new Date(h.publishedAt).toLocaleString("en-IN") : "—"}</td>
              <td className="px-4 py-3 text-right">
                {h.status === "archived" && (
                  <button
                    type="button"
                    data-testid={`admin-config-rollback-btn-${h.version}`}
                    disabled={rollingBack}
                    onClick={() => onRollback(h.version)}
                    className="flex items-center gap-2 text-xs font-bold text-[var(--dive-blue)] hover:underline disabled:opacity-40 ml-auto"
                  >
                    {rollingBack && <Loader2 size={12} className="animate-spin" />} Rollback to this
                  </button>
                )}
              </td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-config-history-empty">
                No versions published yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected.length === 2 && (
        <div className="p-4 border-t border-[var(--border)]">
          <button
            type="button"
            data-testid="admin-config-history-compare-btn"
            onClick={runCompare}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
          >
            {`Compare v${Math.min(...selected)} vs v${Math.max(...selected)}`}
          </button>
          {diffState && <VersionDiffView {...diffState} />}
        </div>
      )}
    </div>
  );
}
