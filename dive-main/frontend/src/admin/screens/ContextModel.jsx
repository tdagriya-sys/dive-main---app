import React, { useState } from "react";
import { Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import ConfigToolbar from "../config/ConfigToolbar";
import PublishPanel from "../config/PublishPanel";
import HistoryPanel from "../config/HistoryPanel";
import SimulationPanel from "../config/SimulationPanel";
import StepUpModal from "../config/StepUpModal";
import NumberField from "../config/NumberField";

const BASE = "/admin/context-config";

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6">
      <h2 className="font-heading font-black text-base mb-4">{title}</h2>
      {children}
    </div>
  );
}

function CorpusTierCard({ tier, index, onChange }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="font-bold text-sm mb-3">{tier.label}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <NumberField label="Max amount (₹)" value={tier.maxAmount} testId={`admin-context-tier-maxamount-${index}`} onChange={(v) => onChange({ ...tier, maxAmount: v })} />
        <NumberField label="Expected class count" min={1} max={12} value={tier.expectedClassCount} testId={`admin-context-tier-classcount-${index}`} onChange={(v) => onChange({ ...tier, expectedClassCount: v })} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-[var(--text-tertiary)]">Reasoning</span>
        <textarea
          data-testid={`admin-context-tier-reasoning-${index}`}
          value={tier.reasoning}
          onChange={(e) => onChange({ ...tier, reasoning: e.target.value })}
          rows={2}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none"
        />
      </label>
    </div>
  );
}

function PersonaBracketCard({ bracket, index, onChange }) {
  const noUpperBound = bracket.maxAge === null;
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="font-bold text-sm mb-3">{bracket.label}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <NumberField label="Min age" min={0} value={bracket.minAge} testId={`admin-context-persona-minage-${index}`} onChange={(v) => onChange({ ...bracket, minAge: v })} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-[var(--text-tertiary)]">Max age</span>
          {noUpperBound ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-tertiary)]">No upper bound</div>
          ) : (
            <input
              type="number"
              data-testid={`admin-context-persona-maxage-${index}`}
              value={bracket.maxAge}
              onChange={(e) => onChange({ ...bracket, maxAge: e.target.value === "" ? "" : Number(e.target.value) })}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold outline-none"
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <NumberField label="Volatility worst-at" step={0.01} value={bracket.volatilityWorstAt} testId={`admin-context-persona-volworstat-${index}`} onChange={(v) => onChange({ ...bracket, volatilityWorstAt: v })} />
        <NumberField label="Drawdown worst-at" step={0.01} value={bracket.drawdownWorstAt} testId={`admin-context-persona-ddworstat-${index}`} onChange={(v) => onChange({ ...bracket, drawdownWorstAt: v })} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-[var(--text-tertiary)]">Reasoning</span>
        <textarea
          data-testid={`admin-context-persona-reasoning-${index}`}
          value={bracket.reasoning}
          onChange={(e) => onChange({ ...bracket, reasoning: e.target.value })}
          rows={2}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none"
        />
      </label>
    </div>
  );
}

function DefaultClassOrder({ order, onChange }) {
  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  return (
    <ol className="space-y-2">
      {order.map((cls, i) => (
        <li key={cls} className="flex items-center justify-between rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold">
          <span>{`${i + 1}. ${cls}`}</span>
          <div className="flex items-center gap-2">
            <button type="button" data-testid={`admin-context-order-up-${cls}`} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              data-testid={`admin-context-order-down-${cls}`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
              className="disabled:opacity-30 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <ArrowDown size={14} />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ContextModel() {
  const c = useConfigDraft(BASE);
  const sim = useSimulation(BASE);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  if (c.loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-context-loading">
        <Loader2 size={16} className="animate-spin" /> Loading Context model…
      </div>
    );
  }
  if (c.error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-context-error">
        {c.error}
      </div>
    );
  }

  const p = c.payload;

  function updateTier(index, updatedTier) {
    c.setPayload({ ...p, corpusTiers: p.corpusTiers.map((t, i) => (i === index ? updatedTier : t)) });
  }
  function updateBracket(index, updatedBracket) {
    c.setPayload({ ...p, personaBrackets: p.personaBrackets.map((b, i) => (i === index ? updatedBracket : b)) });
  }

  return (
    <div className="p-8" data-testid="admin-context-screen">
      <ConfigToolbar
        title="Context Model"
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
          <Section title="Corpus tiers">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {p.corpusTiers.map((tier, i) => (
                <CorpusTierCard key={tier.id} tier={tier} index={i} onChange={(t) => updateTier(i, t)} />
              ))}
            </div>
          </Section>

          <Section title="Persona brackets">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {p.personaBrackets.map((bracket, i) => (
                <PersonaBracketCard key={bracket.id} bracket={bracket} index={i} onChange={(b) => updateBracket(i, b)} />
              ))}
            </div>
          </Section>

          <Section title="Default class order (priority when a corpus size limits how many classes are expected)">
            <DefaultClassOrder order={p.defaultClassOrder} onChange={(order) => c.setPayload({ ...p, defaultClassOrder: order })} />
          </Section>
        </>
      )}

      <StepUpModal open={c.stepUpModalOpen} onCancel={c.cancelStepUp} onSuccess={c.resolveStepUp} />
    </div>
  );
}
