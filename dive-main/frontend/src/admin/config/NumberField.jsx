import React from "react";

// Small labeled number input shared by every field in the three config
// editors (Scoring/Context/Suggestion Model screens) — keeps every weight,
// tier, and range editor visually and behaviorally consistent.
export default function NumberField({ label, value, onChange, step = 1, min, max, testId, suffix }) {
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="text-xs font-bold text-[var(--text-tertiary)]">{label}</span>}
      <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2">
        <input
          type="number"
          data-testid={testId}
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full outline-none bg-transparent text-sm font-semibold text-[var(--text-primary)]"
        />
        {suffix && <span className="text-xs text-[var(--text-tertiary)] ml-1 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}
