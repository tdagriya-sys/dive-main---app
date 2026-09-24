import React from "react";
import { Loader2 } from "lucide-react";

// Shared header for all three config editors: version/dirty status,
// validation-error banner, Save draft / Publish… / History controls, plus an
// OPTIONAL Simulate… button (Scoring/Context Model only — pass
// onSimulateToggle to show it; omitting it, as SuggestionModel does, renders
// nothing extra, since Suggestion has no simulate endpoint to call).
export default function ConfigToolbar({
  title,
  activeEntry,
  draft,
  dirty,
  validation,
  saving,
  onSave,
  publishOpen,
  onPublishToggle,
  historyOpen,
  onToggleHistory,
  simulateOpen,
  onSimulateToggle,
}) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-3">
        <div>
          <h1 className="font-heading font-black text-2xl">{title}</h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-1" data-testid="admin-config-status-line">
            {`Active: ${activeEntry ? `v${activeEntry.version}` : "none yet"} · Draft: v${draft?.version ?? "—"}`}
            {dirty && <span className="text-[var(--dive-blue)] font-bold"> · unsaved changes</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onSimulateToggle && (
            <button
              type="button"
              data-testid="admin-config-simulate-toggle-btn"
              onClick={onSimulateToggle}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
            >
              {simulateOpen ? "Hide simulation" : "Simulate…"}
            </button>
          )}
          <button
            type="button"
            data-testid="admin-config-history-toggle-btn"
            onClick={onToggleHistory}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
          >
            {historyOpen ? "Hide history" : "History"}
          </button>
          <button
            type="button"
            data-testid="admin-config-save-btn"
            disabled={!dirty || saving}
            onClick={onSave}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-40"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Save draft
          </button>
          <button
            type="button"
            data-testid="admin-config-publish-toggle-btn"
            onClick={onPublishToggle}
            disabled={!validation.valid}
            className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
          >
            {publishOpen ? "Cancel publish" : "Publish…"}
          </button>
        </div>
      </div>
      {!validation.valid && validation.errors?.length > 0 && (
        <ul className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-4 text-sm text-[var(--red)] space-y-1 mb-6" data-testid="admin-config-validation-errors">
          {validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
