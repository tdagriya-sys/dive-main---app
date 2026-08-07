import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Wallet, CalendarClock, ChevronDown, AlertTriangle, ArrowLeft } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { planLumpsum, planSip } from "../lib/plannerEngine";
import { fmtINR, SEGMENT_COLORS, IDEAL_RANGES } from "../lib/diveEngine";
import { RangeBar, AnimatedNumber } from "../components/dive/Widgets";

export default function Planner() {
  const { holdings, prefs, user, plannerState, setPlannerState } = useDive();
  const { mode } = plannerState;
  const setMode = (next) => setPlannerState({ mode: next });
  const isNewInvestor = holdings.length === 0;

  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="planner-screen">
      <div className="px-6 pt-8">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Goal planner</p>
        <h1 className="font-heading font-black text-2xl">Divve Planner</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
          {isNewInvestor
            ? "New to investing? Tell us how much you have, and we'll show how to split it across asset classes to build an ideal portfolio — no specific stocks or funds, just the categories."
            : "Planning new money on top of what you already hold — the split below accounts for your existing portfolio, so it fills what's missing rather than re-splitting everything from scratch."}
        </p>
      </div>

      {!mode && (
        <div className="px-6 mt-6 space-y-3">
          <button data-testid="planner-mode-lumpsum" onClick={() => setMode("lumpsum")}
            className="w-full flex items-center gap-3 text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <Wallet size={20} className="text-[var(--dive-blue)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm">Lumpsum</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">Invest a one-time amount right now.</p>
            </div>
          </button>
          <button data-testid="planner-mode-sip" onClick={() => setMode("sip")}
            className="w-full flex items-center gap-3 text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <CalendarClock size={20} className="text-[var(--dive-blue)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm">SIP (monthly)</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">Invest a fixed amount every month, with an annual step-up.</p>
            </div>
          </button>
        </div>
      )}

      {mode === "lumpsum" && (
        <LumpsumPlanner holdings={holdings} prefs={prefs} age={user?.age} onBack={() => setMode(null)}
          amount={plannerState.lumpsumAmount} setAmount={(v) => setPlannerState({ lumpsumAmount: v })} />
      )}
      {mode === "sip" && (
        <SipPlanner holdings={holdings} prefs={prefs} age={user?.age} onBack={() => setMode(null)}
          monthly={plannerState.sipMonthly} setMonthly={(v) => setPlannerState({ sipMonthly: v })}
          stepUp={plannerState.sipStepUp} setStepUp={(v) => setPlannerState({ sipStepUp: v })}
          years={plannerState.sipYears} setYears={(v) => setPlannerState({ sipYears: v })}
          expandedMonthly={plannerState.sipExpandedMonthly} setExpandedMonthly={(v) => setPlannerState({ sipExpandedMonthly: v })} />
      )}
    </div>
  );
}

function StepBackHeader({ title, onBack }) {
  return (
    <div className="px-6 mt-2 flex items-center gap-3 mb-2">
      <button data-testid="planner-step-back-btn" onClick={onBack} className="text-[var(--text-secondary)]"><ArrowLeft size={20} /></button>
      <h2 className="font-heading font-bold text-lg">{title}</h2>
    </div>
  );
}

function EmptyExcludedState() {
  return (
    <div className="px-6 mt-4">
      <div className="flex items-start gap-2 bg-[var(--amber)]/10 border border-[var(--amber)]/20 rounded-xl px-4 py-3" data-testid="planner-empty-excluded">
        <AlertTriangle size={16} className="text-[var(--amber)] shrink-0 mt-0.5" />
        <p className="text-xs font-semibold text-[var(--amber)] leading-relaxed">
          You've excluded every category in your profile — there's nowhere for new money to go. Adjust your excluded list in Profile to use the planner.
        </p>
      </div>
    </div>
  );
}

function CategoryRow({ cat, risk, existingAmount, finalAmount, finalPct, newInvestment }) {
  const [lo, hi] = (IDEAL_RANGES[risk] || IDEAL_RANGES.Balanced)[cat] || [0, 0];
  return (
    <div className="bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)]" data-testid={`planner-cat-${cat}`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEGMENT_COLORS[cat] || "#A1A1AA" }} />
          <span className="font-bold text-sm truncate">{cat}</span>
        </div>
        <span className="text-sm font-bold shrink-0">
          {existingAmount > 0 ? `${fmtINR(existingAmount)} → ` : ""}{fmtINR(finalAmount)}
        </span>
      </div>
      {newInvestment > 0 && (
        <p className="text-xs text-[var(--dive-blue)] font-semibold mb-2">+{fmtINR(newInvestment)} new</p>
      )}
      <RangeBar currentPct={finalPct} loPct={lo} hiPct={hi} />
    </div>
  );
}

function LumpsumPlanner({ holdings, prefs, age, onBack, amount, setAmount }) {
  const risk = prefs.risk;
  const result = useMemo(
    () => planLumpsum({ holdings, newAmount: amount, prefs, risk, age }),
    [holdings, amount, prefs, risk, age]
  );

  return (
    <div data-testid="planner-lumpsum-view">
      <StepBackHeader title="Lumpsum plan" onBack={onBack} />
      <div className="px-6">
        <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)] mb-4">
          <p className="text-xs text-[var(--text-secondary)] mb-2">How much do you want to invest?</p>
          <div className="text-center mb-2">
            <AnimatedNumber value={amount} format={(v) => fmtINR(v)} className="font-heading font-black text-3xl text-[var(--dive-blue)]" />
          </div>
          <input type="range" min="1000" max="2000000" step="1000" value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full accent-[var(--dive-blue)]" data-testid="planner-lumpsum-amount-slider" />
          <div className="flex justify-between text-xs text-[var(--text-tertiary)] mt-1">
            <span>₹1,000</span>
            <span>₹20,00,000</span>
          </div>
          <div className="mt-3">
            <p className="text-xs text-[var(--text-secondary)] mb-1">Or enter an exact amount</p>
            <input type="number" data-testid="planner-lumpsum-amount-input" value={amount} min={1000} step={1000}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-sm font-semibold" />
          </div>
        </div>

        {result.error === "ALL_EXCLUDED" ? (
          <EmptyExcludedState />
        ) : (
          <div className="space-y-3">
            {result.rows.map((row) => (
              <CategoryRow key={row.cat} cat={row.cat} risk={risk} existingAmount={row.existingAmount}
                finalAmount={row.finalAmount} finalPct={row.finalPct} newInvestment={row.newInvestment} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SipPlanner({ holdings, prefs, age, onBack, monthly, setMonthly, stepUp, setStepUp, years, setYears, expandedMonthly, setExpandedMonthly }) {
  const risk = prefs.risk;

  const result = useMemo(
    () => planSip({ holdings, monthlyAmount: monthly, annualStepUpPct: stepUp, years, prefs, risk, age }),
    [holdings, monthly, stepUp, years, prefs, risk, age]
  );

  return (
    <div data-testid="planner-sip-view">
      <StepBackHeader title="SIP plan" onBack={onBack} />
      <div className="px-6">
        <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)] mb-4 space-y-4">
          <div>
            <p className="text-xs text-[var(--text-secondary)] mb-1">Monthly investment</p>
            <input type="number" data-testid="planner-sip-monthly-input" value={monthly} min={500} step={500}
              onChange={(e) => setMonthly(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-sm font-semibold" />
          </div>
          <div>
            <p className="text-xs text-[var(--text-secondary)] mb-1">Annual step-up (%)</p>
            <input type="number" data-testid="planner-sip-stepup-input" value={stepUp} min={0} max={50} step={1}
              onChange={(e) => setStepUp(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-sm font-semibold" />
          </div>
          <div>
            <p className="text-xs text-[var(--text-secondary)] mb-1">Plan duration (years)</p>
            <input type="number" data-testid="planner-sip-years-input" value={years} min={1} max={40} step={1}
              onChange={(e) => setYears(Math.max(1, Number(e.target.value)))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-sm font-semibold" />
          </div>
        </div>

        <div className="bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-xs font-semibold text-[var(--dive-blue-dark)] mb-4 leading-relaxed">
          This plan tracks your contributions only — no investment growth is assumed — and assumes your risk profile and preferences stay the same throughout. Demo/planning tool, not a guarantee.
        </div>

        {result.error === "ALL_EXCLUDED" ? (
          <EmptyExcludedState />
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">When each category starts</p>
            <div className="space-y-2 mb-5">
              {result.milestones.map((m, i) => (
                <div key={m.category} data-testid={`planner-milestone-${i}`} className="flex items-center gap-3 bg-[var(--surface-card)] rounded-xl p-3 border border-[var(--border)]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEGMENT_COLORS[m.category] || "#A1A1AA" }} />
                  <p className="text-sm font-semibold flex-1">
                    Month {m.month}: {m.month === 1 ? "start" : "add"} <b>{m.category}</b>
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Yearly split</p>
              <button data-testid="planner-expand-monthly-btn" onClick={() => setExpandedMonthly((v) => !v)}
                className="flex items-center gap-1 text-xs font-bold text-[var(--dive-blue)]">
                {expandedMonthly ? "Show yearly" : "Show monthly"} <ChevronDown size={14} className={expandedMonthly ? "rotate-180" : ""} />
              </button>
            </div>

            <div className="space-y-2">
              {(expandedMonthly ? result.monthlyRows : result.yearlyRows).map((row) => {
                const label = expandedMonthly ? `Month ${row.month}` : `Year ${row.year}`;
                const key = expandedMonthly ? `m-${row.month}` : `y-${row.year}`;
                return (
                  <div key={key} className="bg-[var(--surface-card)] rounded-xl p-3 border border-[var(--border)]" data-testid={`planner-row-${key}`}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-bold">{label}</span>
                      <span className="text-[var(--text-secondary)]">{fmtINR(row.contribution)} invested · total so far {fmtINR(row.cumulativeTotal)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {Object.entries(row.split).filter(([, amt]) => amt > 0).map(([cat, amt]) => (
                        <span key={cat} className="text-xs text-[var(--text-secondary)]">
                          <span className="font-semibold" style={{ color: SEGMENT_COLORS[cat] }}>{cat}</span>: {fmtINR(amt)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
