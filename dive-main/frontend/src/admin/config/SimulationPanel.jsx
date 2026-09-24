import React, { useState } from "react";
import { Loader2 } from "lucide-react";

// Scoring/Context Model screens only. Shows a sample-size input + Run button,
// then the aggregate before/after impact across the sampled real users —
// never anything tied to a specific user (see simulationService.ts's own
// comment on why the backend result has no per-user identifiers at all).
export default function SimulationPanel({ open, onCancel, onRun, running, result, error }) {
  const [sampleSize, setSampleSize] = useState(20);
  if (!open) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-config-simulation-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold">Simulate this draft against real users</p>
        <button type="button" data-testid="admin-config-simulation-cancel-btn" onClick={onCancel} className="text-sm font-bold text-[var(--text-tertiary)]">
          Close
        </button>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-bold text-[var(--text-tertiary)]">Sample size</span>
          <input
            type="number"
            min={1}
            max={100}
            data-testid="admin-config-simulation-samplesize-input"
            value={sampleSize}
            onChange={(e) => setSampleSize(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-20 rounded-xl border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm font-semibold outline-none"
          />
        </label>
        <button
          type="button"
          data-testid="admin-config-simulation-run-btn"
          disabled={running}
          onClick={() => onRun(sampleSize)}
          className="gold-btn flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold disabled:opacity-40"
        >
          {running && <Loader2 size={14} className="animate-spin" />} Run
        </button>
      </div>

      {error && (
        <p className="text-sm text-[var(--red)]" data-testid="admin-config-simulation-error">
          {error}
        </p>
      )}

      {result && !error && (
        <div data-testid="admin-config-simulation-result">
          {result.sampleSize === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]" data-testid="admin-config-simulation-empty">
              No real users with holdings were found to simulate against.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">Sampled users</p>
                  <p className="font-heading font-black text-lg">{result.sampleSize}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">Avg. score before</p>
                  <p className="font-heading font-black text-lg">{result.avgBaselineScore}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">Avg. score after</p>
                  <p className="font-heading font-black text-lg">{result.avgCandidateScore}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-[var(--text-tertiary)]">Avg. change</p>
                  <p className={`font-heading font-black text-lg ${result.avgDelta > 0 ? "text-[var(--green)]" : result.avgDelta < 0 ? "text-[var(--red)]" : ""}`}>
                    {result.avgDelta > 0 ? "+" : ""}
                    {result.avgDelta}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--text-tertiary)]" data-testid="admin-config-simulation-breakdown">
                {`${result.improvedCount} improved · ${result.worsenedCount} worsened · ${result.unchangedCount} unchanged (range ${result.minDelta} to ${result.maxDelta})`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
