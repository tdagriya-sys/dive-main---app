import React, { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api";

/**
 * Free-text input backed by /api/instruments/search. Selecting a suggestion
 * sets instrumentId (so the backend can resolve the canonical instrument name);
 * typing without selecting still submits as free text (name only, no instrumentId) —
 * the brief calls for choosing from a real list, but never blocks entry if an
 * instrument genuinely isn't in the master collection yet.
 */
export default function InstrumentAutocomplete({
  assetClass,
  value,
  onChange,
  testId,
  hideLabel,
  wrapperClassName,
  inputClassName,
}) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => setQuery(value?.name || ""), [value?.name]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/instruments/search", { params: { assetClass, q: query } });
        setResults(data.instruments || []);
      } catch (e) {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, assetClass]);

  return (
    <div className={wrapperClassName ?? "relative mb-4"}>
      {!hideLabel && (
        <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Instrument name</label>
      )}
      <input
        data-testid={testId}
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange({ instrumentId: undefined, name: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing to search…"
        className={
          inputClassName ??
          "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]"
        }
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-xl shadow-lg max-h-56 overflow-y-auto no-scrollbar" data-testid={`${testId}-results`}>
          {results.map((r) => (
            <button
              key={r._id}
              type="button"
              data-testid={`${testId}-option-${r.symbol}`}
              onMouseDown={() => { setQuery(r.name); onChange({ instrumentId: r._id, name: r.name }); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 hover:bg-[var(--surface-card-hover)] text-sm font-semibold border-b border-[var(--border-light)] last:border-0"
            >
              {r.name} <span className="text-[var(--text-tertiary)] font-normal">· {r.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
