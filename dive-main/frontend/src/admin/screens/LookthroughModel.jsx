import React, { useState, useMemo } from "react";
import { Loader2, Plus, X, ChevronDown, ChevronRight, Search } from "lucide-react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import ConfigToolbar from "../config/ConfigToolbar";
import PublishPanel from "../config/PublishPanel";
import HistoryPanel from "../config/HistoryPanel";
import SimulationPanel from "../config/SimulationPanel";
import StepUpModal from "../config/StepUpModal";
import NumberField from "../config/NumberField";

const BASE = "/admin/lookthrough-config";
const ASSET_CLASSES = ["EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "CRYPTO", "PF"];

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6">
      <h2 className="font-heading font-black text-base mb-4">{title}</h2>
      {children}
    </div>
  );
}

function RemoveButton({ onClick, testId }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className="text-[var(--text-tertiary)] hover:text-[var(--red)]">
      <X size={16} />
    </button>
  );
}

function AddButton({ onClick, label, testId }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className="flex items-center gap-2 text-sm font-bold text-[var(--dive-blue)] hover:underline">
      <Plus size={14} /> {label}
    </button>
  );
}

// Shared by keywordSectorAffinity's per-group `.affinity` and
// industryAssetClassAffinity's per-industry value — both are a
// Partial<Record<AssetClass, number>>. Rendered as a fixed 12-field grid
// (same convention ScoringModel.jsx's liquidityTiers editor uses) rather
// than a dynamic add/remove list: a value of 0 is treated as "no affinity"
// (connectionBetween's own `if (affinity)` check already skips a falsy 0),
// so leaving most fields at 0 has no different effect than omitting the key
// entirely, and a fixed grid is far simpler to build and use than a dynamic
// per-entry picker.
function AffinityGrid({ affinity, onChange, testPrefix }) {
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {ASSET_CLASSES.map((cls) => (
        <NumberField
          key={cls}
          label={cls}
          step={0.01}
          min={0}
          max={1}
          value={affinity[cls] ?? 0}
          testId={`${testPrefix}-${cls}`}
          onChange={(v) => onChange({ ...affinity, [cls]: v })}
        />
      ))}
    </div>
  );
}

function KeywordAffinityCard({ entry, index, onChange, onRemove }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-xs font-bold text-[var(--text-tertiary)]">Keywords (comma-separated, matched case-insensitively)</span>
          <input
            data-testid={`admin-lookthrough-keyword-keywords-${index}`}
            value={entry.keywords.join(", ")}
            onChange={(e) => onChange({ ...entry, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none"
          />
        </label>
        <RemoveButton onClick={onRemove} testId={`admin-lookthrough-keyword-remove-${index}`} />
      </div>
      <AffinityGrid affinity={entry.affinity} onChange={(a) => onChange({ ...entry, affinity: a })} testPrefix={`admin-lookthrough-keyword-affinity-${index}`} />
    </div>
  );
}

function KeywordAffinitySection({ list, onChange }) {
  return (
    <>
      {list.map((entry, i) => (
        <KeywordAffinityCard
          key={i}
          entry={entry}
          index={i}
          onChange={(updated) => onChange(list.map((e, j) => (j === i ? updated : e)))}
          onRemove={() => onChange(list.filter((_, j) => j !== i))}
        />
      ))}
      <AddButton label="Add keyword group" testId="admin-lookthrough-keyword-add" onClick={() => onChange([...list, { keywords: [], affinity: {} }])} />
    </>
  );
}

function RecordCard({ keyLabel, keyValue, onKeyChange, onRemove, removeTestId, keyTestId, children }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-xs font-bold text-[var(--text-tertiary)]">{keyLabel}</span>
          <input value={keyValue} onChange={(e) => onKeyChange(e.target.value)} data-testid={keyTestId} className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none" />
        </label>
        <RemoveButton onClick={onRemove} testId={removeTestId} />
      </div>
      {children}
    </div>
  );
}

// Record<string, X> editor shared by industryAssetClassAffinity,
// mfSegmentToNseIndustry, and mutualFundTopHoldings — converts to an
// index-stable entries array for rendering/editing, reconstructing the
// record (via Object.fromEntries) on every change. Renaming a key mid-edit
// is allowed to transiently collide/empty; only the final reconstructed
// object is what's saved or validated.
function useRecordEntries(record, onChange) {
  const entries = Object.entries(record);
  function updateAt(i, key, value) {
    const next = [...entries];
    next[i] = [key, value];
    onChange(Object.fromEntries(next));
  }
  function removeAt(i) {
    onChange(Object.fromEntries(entries.filter((_, j) => j !== i)));
  }
  function add(key, value) {
    onChange({ ...record, [key]: value });
  }
  return { entries, updateAt, removeAt, add };
}

function IndustryAffinitySection({ record, onChange }) {
  const { entries, updateAt, removeAt, add } = useRecordEntries(record, onChange);
  return (
    <>
      {entries.map(([industry, affinity], i) => (
        <RecordCard
          key={i}
          keyLabel="NSE Industry"
          keyValue={industry}
          onKeyChange={(k) => updateAt(i, k, affinity)}
          onRemove={() => removeAt(i)}
          keyTestId={`admin-lookthrough-industry-key-${i}`}
          removeTestId={`admin-lookthrough-industry-remove-${i}`}
        >
          <AffinityGrid affinity={affinity} onChange={(a) => updateAt(i, industry, a)} testPrefix={`admin-lookthrough-industry-affinity-${i}`} />
        </RecordCard>
      ))}
      <AddButton label="Add industry" testId="admin-lookthrough-industry-add" onClick={() => add(`New industry ${entries.length + 1}`, {})} />
    </>
  );
}

function MfSegmentSection({ record, onChange }) {
  const { entries, updateAt, removeAt, add } = useRecordEntries(record, onChange);
  return (
    <>
      {entries.map(([segment, industries], i) => (
        <RecordCard
          key={i}
          keyLabel="MF segment / theme"
          keyValue={segment}
          onKeyChange={(k) => updateAt(i, k, industries)}
          onRemove={() => removeAt(i)}
          keyTestId={`admin-lookthrough-mfsegment-key-${i}`}
          removeTestId={`admin-lookthrough-mfsegment-remove-${i}`}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-[var(--text-tertiary)]">Matching NSE industries (comma-separated)</span>
            <input
              data-testid={`admin-lookthrough-mfsegment-industries-${i}`}
              value={industries.join(", ")}
              onChange={(e) => updateAt(i, segment, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none"
            />
          </label>
        </RecordCard>
      ))}
      <AddButton label="Add MF segment mapping" testId="admin-lookthrough-mfsegment-add" onClick={() => add(`New segment ${entries.length + 1}`, [])} />
    </>
  );
}

function FundHoldingsCard({ fundKey, holdings, onKeyChange, onHoldingsChange, onRemove, index }) {
  function updateHolding(i, updated) {
    onHoldingsChange(holdings.map((h, j) => (j === i ? updated : h)));
  }
  function removeHolding(i) {
    onHoldingsChange(holdings.filter((_, j) => j !== i));
  }
  return (
    <RecordCard
      keyLabel="Fund key (matched via normalizeFundKey against the holding name)"
      keyValue={fundKey}
      onKeyChange={onKeyChange}
      onRemove={onRemove}
      keyTestId={`admin-lookthrough-fund-key-${index}`}
      removeTestId={`admin-lookthrough-fund-remove-${index}`}
    >
      <div className="space-y-2">
        {holdings.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              data-testid={`admin-lookthrough-fund-${index}-company-${i}`}
              value={h.company}
              onChange={(e) => updateHolding(i, { ...h, company: e.target.value })}
              placeholder="Company"
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none"
            />
            <NumberField step={0.1} min={0} max={100} value={h.weightPct} testId={`admin-lookthrough-fund-${index}-weight-${i}`} onChange={(v) => updateHolding(i, { ...h, weightPct: v })} suffix="%" />
            <RemoveButton onClick={() => removeHolding(i)} testId={`admin-lookthrough-fund-${index}-remove-holding-${i}`} />
          </div>
        ))}
        <AddButton label="Add holding" testId={`admin-lookthrough-fund-${index}-add-holding`} onClick={() => onHoldingsChange([...holdings, { company: "", weightPct: 0 }])} />
      </div>
    </RecordCard>
  );
}

// Same normalization instructionUploadService.ts::normalizeFundKey / lookthroughService.ts use for
// the fund key itself, minus the fund-naming-noise-word stripping — here it's just for matching
// whatever an admin types in the search box against keys/company names, so any punctuation or
// casing difference doesn't matter.
function normalizeForSearch(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// With 8000+ funds possible (bulk CSV upload — see instrumentUploadService.ts), rendering every
// entry as an always-expanded editable card is unusable. Below this count everything still just
// renders (collapsed) so a small hand-curated list stays a one-glance browse; at or above it, a
// search query is required so the DOM never has to hold thousands of rows at once.
const BROWSE_WITHOUT_SEARCH_LIMIT = 25;
const MAX_SEARCH_RESULTS = 50;

function FundHoldingsRow({ fundKey, holdings, onKeyChange, onHoldingsChange, onRemove, index, expanded, onToggle }) {
  if (!expanded) {
    const preview = holdings.length ? holdings.slice(0, 2).map((h) => `${h.company || "(unnamed)"} (${h.weightPct}%)`).join(", ") : "no holdings yet";
    return (
      <button
        type="button"
        data-testid={`admin-lookthrough-fund-row-${index}`}
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-3 mb-2 text-left hover:bg-[var(--surface-card-hover)]"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight size={14} className="shrink-0 text-[var(--text-tertiary)]" />
          <span className="font-bold text-sm truncate">{fundKey || "(empty key)"}</span>
        </span>
        <span className="text-xs text-[var(--text-tertiary)] truncate">
          {holdings.length} holding{holdings.length === 1 ? "" : "s"} — {preview}
          {holdings.length > 2 ? "…" : ""}
        </span>
      </button>
    );
  }
  return (
    <div className="mb-2">
      <button
        type="button"
        data-testid={`admin-lookthrough-fund-collapse-${index}`}
        onClick={onToggle}
        className="flex items-center gap-2 text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-1"
      >
        <ChevronDown size={14} /> Collapse
      </button>
      <FundHoldingsCard fundKey={fundKey} holdings={holdings} onKeyChange={onKeyChange} onHoldingsChange={onHoldingsChange} onRemove={onRemove} index={index} />
    </div>
  );
}

function FundHoldingsSection({ record, onChange }) {
  const { entries, updateAt, removeAt, add } = useRecordEntries(record, onChange);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const normalizedQuery = normalizeForSearch(search);
  const needsSearch = entries.length > BROWSE_WITHOUT_SEARCH_LIMIT;

  const matches = useMemo(() => {
    const withIndex = entries.map((entry, i) => ({ entry, i }));
    if (!normalizedQuery) return needsSearch ? [] : withIndex;
    return withIndex.filter(({ entry: [fundKey, holdings] }) => {
      if (normalizeForSearch(fundKey).includes(normalizedQuery)) return true;
      return holdings.some((h) => normalizeForSearch(h.company).includes(normalizedQuery));
    });
  }, [entries, normalizedQuery, needsSearch]);

  const shown = matches.slice(0, MAX_SEARCH_RESULTS);

  function toggle(i) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 max-w-md">
        <Search size={14} className="text-[var(--text-tertiary)] shrink-0" />
        <input
          data-testid="admin-lookthrough-fund-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${entries.length} fund${entries.length === 1 ? "" : "s"} by key or holding…`}
          className="flex-1 outline-none bg-transparent text-sm"
        />
      </div>

      {needsSearch && !normalizedQuery && (
        <p className="text-xs text-[var(--text-tertiary)] mb-3" data-testid="admin-lookthrough-fund-search-hint">
          {entries.length} funds — type at least one character to search (too many to browse at once).
        </p>
      )}

      {shown.map(({ entry: [fundKey, holdings], i }) => (
        <FundHoldingsRow
          key={i}
          index={i}
          fundKey={fundKey}
          holdings={holdings}
          expanded={expanded.has(i)}
          onToggle={() => toggle(i)}
          onKeyChange={(k) => updateAt(i, k, holdings)}
          onHoldingsChange={(h) => updateAt(i, fundKey, h)}
          onRemove={() => removeAt(i)}
        />
      ))}

      {matches.length > MAX_SEARCH_RESULTS && (
        <p className="text-xs text-[var(--text-tertiary)] mb-3" data-testid="admin-lookthrough-fund-more-hint">
          Showing {MAX_SEARCH_RESULTS} of {matches.length} matches — refine your search to narrow this down.
        </p>
      )}
      {normalizedQuery && matches.length === 0 && (
        <p className="text-xs text-[var(--text-tertiary)] mb-3" data-testid="admin-lookthrough-fund-no-matches">
          No fund matches "{search}".
        </p>
      )}

      <AddButton label="Add fund" testId="admin-lookthrough-fund-add" onClick={() => add(`newfund${entries.length + 1}`, [])} />
    </>
  );
}

export default function LookthroughModel() {
  const c = useConfigDraft(BASE);
  const sim = useSimulation(BASE);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  if (c.loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-lookthrough-loading">
        <Loader2 size={16} className="animate-spin" /> Loading Look-Through model…
      </div>
    );
  }
  if (c.error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-lookthrough-error">
        {c.error}
      </div>
    );
  }

  const p = c.payload;

  return (
    <div className="p-8" data-testid="admin-lookthrough-screen">
      <ConfigToolbar
        title="Look-Through Model"
        activeEntry={c.activeEntry}
        draft={c.draft}
        dirty={c.dirty}
        validation={c.validation}
        saving={c.saving}
        onSave={c.saveDraft}
        publishOpen={publishOpen}
        onPublishToggle={() => setPublishOpen((v) => !v)}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        simulateOpen={simulateOpen}
        onSimulateToggle={() => {
          if (simulateOpen) sim.clearResult();
          setSimulateOpen((v) => !v);
        }}
      />

      <PublishPanel
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        publishing={c.publishing}
        disabled={!c.validation.valid}
        onConfirm={async (changeNote) => {
          await c.publish(changeNote);
          setPublishOpen(false);
        }}
      />

      <SimulationPanel
        open={simulateOpen}
        onCancel={() => {
          sim.clearResult();
          setSimulateOpen(false);
        }}
        onRun={(sampleSize) => sim.runSimulation(c.payload, sampleSize)}
        running={sim.running}
        result={sim.result}
        error={sim.error}
      />

      {historyOpen ? (
        <HistoryPanel history={c.history} rollingBack={c.publishing} onRollback={(version) => c.rollback(version)} getVersion={c.getVersion} />
      ) : (
        <>
          <Section title="Tier strengths (0-1)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NumberField
                label="Exact issuer match"
                step={0.01}
                min={0}
                max={1}
                value={p.exactIssuerStrength}
                testId="admin-lookthrough-strength-exactissuer"
                onChange={(v) => c.setPayload({ ...p, exactIssuerStrength: v })}
              />
              <NumberField
                label="Same sector, same class"
                step={0.01}
                min={0}
                max={1}
                value={p.sameSectorStrength}
                testId="admin-lookthrough-strength-samesector"
                onChange={(v) => c.setPayload({ ...p, sameSectorStrength: v })}
              />
              <NumberField
                label="Sectoral MF ↔ equity"
                step={0.01}
                min={0}
                max={1}
                value={p.sectoralMfAffinityStrength}
                testId="admin-lookthrough-strength-sectoralmf"
                onChange={(v) => c.setPayload({ ...p, sectoralMfAffinityStrength: v })}
              />
            </div>
          </Section>

          <Section title="Keyword sector affinity (e.g. jewelry retailer ↔ gold)">
            <KeywordAffinitySection list={p.keywordSectorAffinity} onChange={(list) => c.setPayload({ ...p, keywordSectorAffinity: list })} />
          </Section>

          <Section title="Broad NSE industry ↔ asset class affinity (e.g. Realty ↔ REIT)">
            <IndustryAffinitySection record={p.industryAssetClassAffinity} onChange={(rec) => c.setPayload({ ...p, industryAssetClassAffinity: rec })} />
          </Section>

          <Section title="Sectoral mutual fund segment → matching NSE industries">
            <MfSegmentSection record={p.mfSegmentToNseIndustry} onChange={(rec) => c.setPayload({ ...p, mfSegmentToNseIndustry: rec })} />
          </Section>

          <Section title="Curated mutual fund top holdings">
            <FundHoldingsSection record={p.mutualFundTopHoldings} onChange={(rec) => c.setPayload({ ...p, mutualFundTopHoldings: rec })} />
          </Section>
        </>
      )}

      <StepUpModal open={c.stepUpModalOpen} onCancel={c.cancelStepUp} onSuccess={c.resolveStepUp} />
    </div>
  );
}
