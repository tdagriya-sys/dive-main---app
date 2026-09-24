import React, { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import ConfigToolbar from "../config/ConfigToolbar";
import PublishPanel from "../config/PublishPanel";
import HistoryPanel from "../config/HistoryPanel";
import SimulationPanel from "../config/SimulationPanel";
import StepUpModal from "../config/StepUpModal";
import NumberField from "../config/NumberField";

const BASE = "/admin/scoring-config";

const ASSET_CLASSES = ["EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "CRYPTO", "PF"];

function Section({ title, children, sum }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading font-black text-base">{title}</h2>
        {sum !== undefined && (
          <span className={`text-xs font-bold ${Math.abs(sum - 1) > 0.001 ? "text-[var(--red)]" : "text-[var(--text-tertiary)]"}`}>
            {`sum: ${sum.toFixed(3)}`}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function StockCountBreakpoints({ value, onChange }) {
  function updateRow(i, key, v) {
    onChange(value.map((row, idx) => (idx === i ? (key === "count" ? [v, row[1]] : [row[0], v]) : row)));
  }
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          <NumberField testId={`admin-scoring-breakpoint-count-${i}`} label={i === 0 ? "Stock count" : undefined} value={row[0]} onChange={(v) => updateRow(i, "count", v)} />
          <NumberField testId={`admin-scoring-breakpoint-score-${i}`} label={i === 0 ? "Score" : undefined} value={row[1]} onChange={(v) => updateRow(i, "score", v)} suffix="/ 100" />
          <button
            type="button"
            data-testid={`admin-scoring-breakpoint-remove-${i}`}
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-[var(--text-tertiary)] hover:text-[var(--red)] mt-5"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="admin-scoring-breakpoint-add"
        onClick={() => onChange([...value, [0, 0]])}
        className="flex items-center gap-1 text-xs font-bold text-[var(--dive-blue)]"
      >
        <Plus size={14} /> Add breakpoint
      </button>
    </div>
  );
}

export default function ScoringModel() {
  const c = useConfigDraft(BASE);
  const sim = useSimulation(BASE);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  if (c.loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-scoring-loading">
        <Loader2 size={16} className="animate-spin" /> Loading Dive Score model…
      </div>
    );
  }
  if (c.error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-scoring-error">
        {c.error}
      </div>
    );
  }

  const p = c.payload;
  const setField = (key, value) => c.setPayload({ ...p, [key]: value });
  const setNested = (key, subKey, value) => c.setPayload({ ...p, [key]: { ...p[key], [subKey]: value } });

  const compositeWeightsSum = Object.values(p.compositeWeights).reduce((s, w) => s + Number(w || 0), 0);
  const concentrationSubWeightsSum = Object.values(p.concentrationSubWeights).reduce((s, w) => s + Number(w || 0), 0);

  return (
    <div className="p-8" data-testid="admin-scoring-screen">
      <ConfigToolbar
        title="Dive Score Model"
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
          <Section title="Composite weights" sum={compositeWeightsSum}>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(p.compositeWeights).map(([key, value]) => (
                <NumberField key={key} label={key} step={0.01} value={value} testId={`admin-scoring-weight-${key}`} onChange={(v) => setNested("compositeWeights", key, v)} />
              ))}
            </div>
          </Section>

          <Section title="Concentration sub-weights" sum={concentrationSubWeightsSum}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(p.concentrationSubWeights).map(([key, value]) => (
                <NumberField key={key} label={key} step={0.01} value={value} testId={`admin-scoring-concweight-${key}`} onChange={(v) => setNested("concentrationSubWeights", key, v)} />
              ))}
            </div>
          </Section>

          <Section title="Sub-score best/worst-at points">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(p.subScoreBestAt).map(([key, value]) => (
                <NumberField key={key} label={key} step={0.01} value={value} testId={`admin-scoring-bestat-${key}`} onChange={(v) => setNested("subScoreBestAt", key, v)} />
              ))}
            </div>
          </Section>

          <Section title="Liquidity tiers (0-100 per asset class)">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {ASSET_CLASSES.map((cls) => (
                <NumberField
                  key={cls}
                  label={cls}
                  min={0}
                  max={100}
                  value={p.liquidityTiers[cls]}
                  testId={`admin-scoring-liquidity-${cls}`}
                  onChange={(v) => setNested("liquidityTiers", cls, v)}
                />
              ))}
            </div>
          </Section>

          <Section title="Stock-count band (holding count → score)">
            <StockCountBreakpoints value={p.stockCountBreakpoints} onChange={(v) => setField("stockCountBreakpoints", v)} />
          </Section>

          <Section title="Other">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <NumberField label="Crypto within-class cap" min={0} max={100} value={p.cryptoWithinClassCap} testId="admin-scoring-cryptocap" onChange={(v) => setField("cryptoWithinClassCap", v)} />
              <NumberField label="Equity sector spread target" min={1} value={p.equitySectorSpreadTarget} testId="admin-scoring-sectorspread" onChange={(v) => setField("equitySectorSpreadTarget", v)} />
              <NumberField
                label="Correlation score (≤1 expected class)"
                value={p.singleClassCorrelationScores.whenExpectedClassesLE1}
                testId="admin-scoring-corr-le1"
                onChange={(v) => setNested("singleClassCorrelationScores", "whenExpectedClassesLE1", v)}
              />
              <NumberField
                label="Correlation score (otherwise)"
                value={p.singleClassCorrelationScores.otherwise}
                testId="admin-scoring-corr-otherwise"
                onChange={(v) => setNested("singleClassCorrelationScores", "otherwise", v)}
              />
              <NumberField
                label="Drawdown unrecovered penalty"
                min={0}
                value={p.drawdownUnrecoveredPenalty}
                testId="admin-scoring-drawdownpenalty"
                onChange={(v) => setField("drawdownUnrecoveredPenalty", v)}
              />
            </div>
          </Section>
        </>
      )}

      <StepUpModal open={c.stepUpModalOpen} onCancel={c.cancelStepUp} onSuccess={c.resolveStepUp} />
    </div>
  );
}
