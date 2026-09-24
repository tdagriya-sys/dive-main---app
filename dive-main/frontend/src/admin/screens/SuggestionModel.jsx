import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { useConfigDraft } from "../config/useConfigDraft";
import ConfigToolbar from "../config/ConfigToolbar";
import PublishPanel from "../config/PublishPanel";
import HistoryPanel from "../config/HistoryPanel";
import StepUpModal from "../config/StepUpModal";
import NumberField from "../config/NumberField";

const BASE = "/admin/suggestion-config";
const PROFILES = ["Conservative", "Balanced", "Aggressive"];
const TIERS = ["low", "medium", "high"];

function Section({ title, children, sum }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading font-black text-base">{title}</h2>
        {sum !== undefined && (
          <span className={`text-xs font-bold ${Math.abs(sum - 1) > 0.001 ? "text-[var(--red)]" : "text-[var(--text-tertiary)]"}`}>{`sum: ${sum.toFixed(3)}`}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function RangeCell({ range, onChange, testId }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        data-testid={`${testId}-lo`}
        value={range[0]}
        onChange={(e) => onChange([e.target.value === "" ? "" : Number(e.target.value), range[1]])}
        className="w-14 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs font-semibold outline-none"
      />
      <span className="text-[var(--text-tertiary)] text-xs">–</span>
      <input
        type="number"
        data-testid={`${testId}-hi`}
        value={range[1]}
        onChange={(e) => onChange([range[0], e.target.value === "" ? "" : Number(e.target.value)])}
        className="w-14 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs font-semibold outline-none"
      />
    </div>
  );
}

export default function SuggestionModel() {
  const c = useConfigDraft(BASE);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (c.loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-suggestion-loading">
        <Loader2 size={16} className="animate-spin" /> Loading Suggestion model…
      </div>
    );
  }
  if (c.error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-suggestion-error">
        {c.error}
      </div>
    );
  }

  const p = c.payload;
  const fastPathBlendSum = Object.values(p.fastPathBlend).reduce((s, w) => s + Number(w || 0), 0);

  function setIdealRange(profile, category, range) {
    c.setPayload({ ...p, idealRanges: { ...p.idealRanges, [profile]: { ...p.idealRanges[profile], [category]: range } } });
  }
  function setReturnTier(category, tier) {
    c.setPayload({ ...p, returnTier: { ...p.returnTier, [category]: tier } });
  }
  function setReturnBias(key, value) {
    c.setPayload({ ...p, returnBias: { ...p.returnBias, [key]: value } });
  }
  function setDiversificationCap(key, value) {
    c.setPayload({ ...p, diversificationCap: { ...p.diversificationCap, [key]: value } });
  }
  function setFastPathBlend(key, value) {
    c.setPayload({ ...p, fastPathBlend: { ...p.fastPathBlend, [key]: value } });
  }

  return (
    <div className="p-8" data-testid="admin-suggestion-screen">
      <ConfigToolbar
        title="Suggestion Model"
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

      {historyOpen ? (
        <HistoryPanel history={c.history} rollingBack={c.publishing} onRollback={(version) => c.rollback(version)} getVersion={c.getVersion} />
      ) : (
        <>
          <Section title="Ideal allocation ranges (% of portfolio) by risk profile">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                    <th className="pr-4 py-2">Category</th>
                    {PROFILES.map((profile) => (
                      <th key={profile} className="px-2 py-2">
                        {profile}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.coreCategories.map((cat) => (
                    <tr key={cat} className="border-t border-[var(--border)]">
                      <td className="pr-4 py-2 font-semibold">{cat}</td>
                      {PROFILES.map((profile) => (
                        <td key={profile} className="px-2 py-2">
                          <RangeCell
                            range={p.idealRanges[profile][cat]}
                            testId={`admin-suggestion-range-${profile}-${cat}`}
                            onChange={(range) => setIdealRange(profile, cat, range)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Return tier per category">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {p.coreCategories.map((cat) => (
                <label key={cat} className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-[var(--text-tertiary)]">{cat}</span>
                  <select
                    data-testid={`admin-suggestion-returntier-${cat}`}
                    value={p.returnTier[cat]}
                    onChange={(e) => setReturnTier(cat, e.target.value)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold outline-none"
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Return bias">
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(p.returnBias).map(([key, value]) => (
                <NumberField key={key} label={key} value={value} testId={`admin-suggestion-returnbias-${key}`} onChange={(v) => setReturnBias(key, v)} />
              ))}
            </div>
          </Section>

          <Section title="Diversification cap (max holdings per category)">
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(p.diversificationCap).map(([key, value]) => {
                const uncapped = value === null;
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[var(--text-tertiary)]">{key}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        data-testid={`admin-suggestion-divcap-${key}`}
                        disabled={uncapped}
                        value={uncapped ? "" : value}
                        onChange={(e) => setDiversificationCap(key, e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-20 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold outline-none disabled:opacity-40"
                      />
                      <label className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                        <input
                          type="checkbox"
                          data-testid={`admin-suggestion-divcap-uncapped-${key}`}
                          checked={uncapped}
                          onChange={(e) => setDiversificationCap(key, e.target.checked ? null : 1)}
                        />
                        Uncapped
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Fast-path concentration blend" sum={fastPathBlendSum}>
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(p.fastPathBlend).map(([key, value]) => (
                <NumberField key={key} label={key} step={0.01} value={value} testId={`admin-suggestion-blend-${key}`} onChange={(v) => setFastPathBlend(key, v)} />
              ))}
            </div>
          </Section>
        </>
      )}

      <StepUpModal open={c.stepUpModalOpen} onCancel={c.cancelStepUp} onSuccess={c.resolveStepUp} />
    </div>
  );
}
