import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, TrendingUp, TrendingDown, Minus, FlaskConical, X, ArrowRight, ChevronRight } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { ScoreRing, RangeBar, AnimatedNumber } from "../components/dive/Widgets";
import { buildSuggestions, rescaleIdealRanges, personalizeSuggestions, diveScore, topExposure, missingCategories, apparentDiversification, realDiversification, totalInvested, fmtINR, effectiveHoldings } from "../lib/diveEngine";
import { contextSummaryMessage, isCategoryExpected, deferredIncreaseNote, deferredReduceNote, expectedCoreCategories } from "../lib/contextMessaging";
import { HoldingsLoadingState, HoldingsLoadErrorState, HoldingsEmptyState } from "../components/dive/HoldingsGateStates";

export default function Suggestions() {
  const { holdings, holdingsLoading, holdingsError, loadHoldings, ranges, prefs, setScreen, setAskInstrument, sims, addSim, resetSims, scoreBreakdown } = useDive();
  const [sim, setSim] = useState(null); // {cat, amount}
  const [stress, setStress] = useState(false);

  // Same reasoning as Home.jsx: a bare `return null` here is indistinguishable
  // from a crash.
  if (holdingsLoading) return <HoldingsLoadingState testId="suggestions-loading-state" />;
  if (!holdings.length && holdingsError) {
    return <HoldingsLoadErrorState onRetry={loadHoldings} testId="suggestions-load-error-state" retryTestId="suggestions-load-error-retry-btn" />;
  }
  if (!holdings.length) {
    return (
      <HoldingsEmptyState setScreen={setScreen} testId="suggestions-empty-state" ctaTestId="suggestions-empty-add-btn"
        title="No suggestions yet" body="Add your first holding and DIVVE will tell you exactly what to add next." ctaLabel="Add investments"
        secondaryLabel="Ask DIVVE about a stock or fund" secondaryTestId="suggestions-empty-ask-btn"
        onSecondary={() => { setAskInstrument(null); setScreen("ask"); }} />
    );
  }
  const h = effectiveHoldings(holdings, sims);
  // The canonical Dive Score — same number Home/Score Breakdown show. What-if
  // previews below start from THIS baseline and apply a fast-estimated delta,
  // rather than showing the lightweight concentration-only formula as if it
  // were a second, competing "Dive Score".
  const canonicalScore = scoreBreakdown?.hasHoldings ? scoreBreakdown.compositeScore : diveScore(h);
  // Layer D — Context Engine: which asset classes make sense to expect from
  // THIS user right now, given their corpus size and age (see
  // backend/src/services/contextEngine.ts). Used below to soften "add more"
  // nudges for categories that aren't realistic yet, and to show a reassuring
  // summary instead of a generic "diversify more" push.
  const context = scoreBreakdown?.context;
  const contextMessage = contextSummaryMessage(context);
  const expectedCategories = expectedCoreCategories(context);
  // IDEAL_RANGES's per-category bands were authored assuming a portfolio
  // eventually spread across most/all 9 CORE_CATEGORIES (their hi% values
  // sum to ~150%, not 100%) — fine for a user expected to hold most of them,
  // but wrong for an early-stage user Layer D restricts to a small subset
  // (e.g. 3, for a "Growing" corpus): maxing out every category they're
  // actually told to hold could fall well short of their real total. This
  // rescales just the expected categories' bands (on their MIDPOINT, not
  // their ceiling — see rescaleIdealRanges()'s own comment in diveEngine.js
  // for why) so a fully-invested user lands near each category's own middle
  // instead of pinned above every ceiling, while their ceilings still
  // comfortably cover the whole portfolio between them.
  const scaledRanges = rescaleIdealRanges(ranges, prefs.risk, expectedCategories);
  // A category flagged "increase" by the generic risk-profile ranges may
  // still not make sense YET for this user's corpus/age — defer it with
  // reassuring copy instead of pushing an unrealistic nudge. A "reduce" nudge
  // is deferred too, but ONLY when the category is the user's sole (or
  // near-sole) expected class right now — e.g. "Trim Equity to 25-35%" makes
  // no sense for a Starter-tier user whose entire expected set IS equity,
  // since the generic ideal range assumes a multi-class allocation that isn't
  // realistic yet. Once more than one class is expected, "reduce" stays a
  // live signal — rebalancing among classes already expected is fine.
  const withDeferred = buildSuggestions(h, scaledRanges, prefs.risk)
    .filter((s) => !prefs.excluded.includes(s.cat))
    .map((s) => {
      const soleExpectedCategory = expectedCategories.size <= 1 && isCategoryExpected(s.cat, context);
      const deferred = (s.action === "increase" && !isCategoryExpected(s.cat, context)) || (s.action === "reduce" && soleExpectedCategory);
      return { ...s, deferred };
    });
  // Personal preferences (risk/return/diversification priority/preferred) —
  // pure re-ranking and annotation on top of the numbers above, see
  // personalizeSuggestions() in diveEngine.js for why this never touches the
  // score/percentage math itself. "excluded" is already handled above.
  const suggestions = personalizeSuggestions(withDeferred, prefs);
  const applySim = (cat, amt) => {
    const prior = (sims.find((s) => s.segment === cat) || {}).amount || 0;
    addSim(cat, prior + amt);
  };

  const iconFor = (a) => (a === "increase" ? TrendingUp : a === "reduce" ? TrendingDown : Minus);
  // No "trim" framing anywhere — the product's aim is to grow the portfolio
  // into what it's missing, never to nudge someone toward selling something
  // they already hold. An over-exposed category becomes an FYI, not an ask.
  const labelFor = (a, cat) => (a === "increase" ? `Add to ${cat}` : a === "reduce" ? `${cat} — you're over-exposed` : `${cat} is on track`);
  const overExposedNote = (cat) =>
    `You're already carrying more than the ideal share in ${cat} — we won't suggest trimming it. The bigger lift for your score is building up categories that are still below their ideal range.`;
  // "excluded" is the only thing that ever removes a category from this list
  // — a diversification-priority cap just stops actively pushing it, same
  // treatment as an already-deferred/on-track card, never a removal.
  const diversificationCapNote = (cat, level) =>
    `We're not actively pushing you to add to ${cat} right now, based on your "${level}" diversification priority — other categories matter more at the moment. You can still add to it below if you'd like.`;

  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="suggestions-screen">
      <div className="px-6 pt-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Category-level, always quantified</p>
          <h1 className="font-heading font-black text-2xl">Suggestions for you</h1>
        </div>
        <button data-testid="sugg-search-btn" onClick={() => setScreen("ask")} className="text-[var(--text-secondary)]"><Search size={20} /></button>
      </div>

      <div className="px-6 mt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="bg-[var(--dive-blue-light)] rounded-2xl px-4 py-3 text-xs font-semibold text-[var(--dive-blue-dark)] flex-1">
            We'll never say "Reliance vs Tata". We tell you equity vs gold vs bonds — with real ₹ gaps.
          </div>
        </div>
        {contextMessage && (
          <div data-testid="sugg-context-message" className="mt-2 bg-[var(--surface-card)] border border-[var(--border)] rounded-2xl px-4 py-3 text-xs text-[var(--text-secondary)] leading-relaxed">
            {contextMessage}
          </div>
        )}
        {sims.some((s) => s.amount > 0) && (
          <button data-testid="sugg-reset-sims" onClick={resetSims}
            className="mt-2 text-xs font-bold text-[var(--dive-blue)] underline">Reset simulated changes</button>
        )}
      </div>

      <div className="px-6 mt-5">
        <button data-testid="sugg-ask-dive-card" onClick={() => { setAskInstrument(null); setScreen("ask"); }}
          className="w-full flex items-center gap-3 text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
          <div className="w-11 h-11 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
            <Search size={20} className="text-[var(--dive-blue)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm">Ask DIVVE about any stock or fund</p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Curious about something specific? Get a straight fundamental / technical / valuation read — no pushy stock tips.</p>
          </div>
          <ChevronRight size={18} className="text-[var(--text-tertiary)] shrink-0" />
        </button>
      </div>

      <div className="px-6 mt-5 space-y-4">
        {suggestions.map((s, i) => {
          // s.deferred (Context Engine) and s.diversificationCapped (user's
          // own diversification-priority preference) both mean the same
          // thing visually — "not actively pushing this right now" — so they
          // share the same soft-note treatment. Neither removes the card;
          // only an "excluded" pick (already filtered out above) does that.
          const softNote = s.deferred || s.diversificationCapped;
          const effectiveAction = softNote ? "hold" : s.action;
          const Icon = iconFor(effectiveAction);
          const cardTitle = s.deferred ? `${s.cat} — not needed yet`
            : s.diversificationCapped ? `${s.cat} — not right now`
            : labelFor(s.action, s.cat);
          return (
            <motion.div key={s.cat} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className={`bg-[var(--surface-card)] rounded-2xl p-5 border shadow-sm ${s.prioritized ? "border-[var(--dive-blue)]" : "border-[var(--border)]"}`} data-testid={`sugg-card-${s.cat}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${effectiveAction === "increase" ? "bg-[var(--dive-blue-light)]" : effectiveAction === "reduce" ? "bg-[#FEF3C7]" : "bg-[#D1FAE5]"}`}>
                  <Icon size={16} className={effectiveAction === "increase" ? "text-[var(--dive-blue)]" : effectiveAction === "reduce" ? "text-[var(--amber)]" : "text-[var(--green)]"} />
                </div>
                <span className="font-bold">{cardTitle}</span>
              </div>
              {s.prioritized && (
                <span data-testid={`sugg-prioritized-badge-${s.cat}`}
                  className="inline-block text-[10px] font-bold uppercase tracking-wide text-[var(--dive-blue-dark)] bg-[var(--dive-blue-light)] rounded-full px-2 py-0.5 mb-3">
                  Prioritized based on your preference
                </span>
              )}
              {s.deferred ? (
                <p data-testid={`sugg-deferred-note-${s.cat}`} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {s.action === "reduce" ? deferredReduceNote(s.cat, context) : deferredIncreaseNote(s.cat, context)}
                </p>
              ) : s.diversificationCapped ? (
                <p data-testid={`sugg-diversification-capped-note-${s.cat}`} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {diversificationCapNote(s.cat, prefs.diversificationPriority)}
                </p>
              ) : (
                <>
                  <RangeBar currentPct={s.currentPct} loPct={s.loPct} hiPct={s.hiPct} />
                  <div className="flex items-center justify-between text-sm mt-3">
                    <span className="text-[var(--text-secondary)]">Now: <b className="text-[var(--text-primary)]">{fmtINR(s.current)}</b> ({s.currentPct.toFixed(0)}%)</span>
                    <span className="text-[var(--text-secondary)]">Ideal: <b className="text-[var(--dive-blue)]">{fmtINR(s.loAmt)}–{fmtINR(s.hiAmt)}</b> ({Math.round(s.loPct)}–{Math.round(s.hiPct)}%)</span>
                  </div>
                  {effectiveAction === "reduce" && (
                    <p data-testid={`sugg-overexposed-note-${s.cat}`} className="text-xs text-[var(--text-secondary)] leading-relaxed mt-3">
                      {overExposedNote(s.cat)}
                    </p>
                  )}
                </>
              )}
              {/* Simulate/Ask are always available, regardless of whether this
                  category is over-exposed, on track, not needed yet, or
                  deprioritized by the diversification-priority setting — the
                  user should never be blocked from previewing "what if I add
                  more here anyway" or asking about a specific fund. */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button data-testid={`ask-link-${s.cat}`} onClick={() => { setAskInstrument(null); setScreen("ask"); }}
                  className="flex items-center gap-1.5 text-xs font-bold text-[var(--dive-blue)]">
                  <Search size={13} /> Ask about a specific fund
                </button>
                <button data-testid={`simulate-btn-${s.cat}`} onClick={() => setSim({ cat: s.cat, amount: s.gap || 10000, action: "increase", categoryAction: s.action })}
                  className="shrink-0 gold-btn rounded-full px-5 py-2.5 font-bold text-sm whitespace-nowrap">
                  Simulate adding more
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="px-6 mt-6">
        <button data-testid="stress-test-btn" onClick={() => setStress(true)}
          className="w-full md:max-w-xs md:ml-auto bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
          <FlaskConical size={18} className="text-[var(--dive-blue)]" /> Run Stress Test
        </button>
      </div>

      <AnimatePresence>
        {sim && <SimulateSheet sim={sim} setSim={setSim} baseHoldings={h} onApply={applySim} canonicalScore={canonicalScore} scoreBreakdown={scoreBreakdown} />}
        {stress && <StressSheet setStress={setStress} baseHoldings={h} canonicalScore={canonicalScore} />}
      </AnimatePresence>
    </div>
  );
}

function SimulateSheet({ sim, setSim, baseHoldings, onApply, canonicalScore, scoreBreakdown }) {
  const [amount, setAmount] = useState(sim.amount);
  const baseTop = topExposure(baseHoldings).pct;
  const extra = { segment: sim.cat, amount: sim.action === "increase" ? amount : 0 };
  const newTop = topExposure(baseHoldings, extra).pct;
  // Start from the ONE canonical Dive Score (same as Home/Score Breakdown) and
  // apply the fast concentration-only formula's ESTIMATED DELTA on top — never
  // show the lightweight formula as if it were a second, competing score.
  const baseScore = canonicalScore;
  const rawDelta = diveScore(baseHoldings, extra) - diveScore(baseHoldings);
  // rawDelta lives on the concentration-only formula's OWN 100-point scale,
  // but concentration is only one of ~10 sub-scores in the real composite
  // (DIVE_SCORE_V2_WEIGHTS.concentration = 0.17 in diveScoreService.ts) — the
  // other sub-scores (volatility/liquidity/correlation/VaR/...) don't move in
  // this quick estimate at all. Adding rawDelta to baseScore 1:1 overstates
  // the effect hugely (a portfolio-dwarfing single addition can swing rawDelta
  // by dozens of points, dragging the REAL score's anchor toward 100 even
  // though only concentration changed). Scaling by that same weight keeps the
  // estimate proportional to concentration's actual share of the real score —
  // and is self-bounding to roughly ±17 points by construction, since rawDelta
  // itself is bounded to [-100,100]. See docs/DIVE_SCORE_MODEL.md §13.
  const concentrationWeight = scoreBreakdown?.weights?.concentration ?? 0.17;
  const scaledDelta = rawDelta * concentrationWeight;
  // The concentration formula is a pure HHI measure with no concept of "this
  // category's own ideal band" — mathematically, piling more into ANY
  // non-dominant category tends to dilute overall concentration and raise the
  // score, even one that's already on track or over its own ceiling. That
  // contradicted the "you're over-exposed" / "on track" messaging shown right
  // on the card, so a category that isn't genuinely under-invested
  // (sim.categoryAction !== "increase") never gets credit for "add more" here
  // — only a flat or negative delta, matching what the card already told them.
  const isCappedCategory = sim.categoryAction === "reduce" || sim.categoryAction === "hold";
  const estimatedDelta = isCappedCategory ? Math.min(0, scaledDelta) : scaledDelta;
  const newScore = Math.max(0, Math.min(100, Math.round(baseScore + estimatedDelta)));
  const scoreWasCapped = isCappedCategory && rawDelta > 0;
  const apply = () => { if (sim.action === "increase") onApply(sim.cat, amount); setSim(null); };
  return (
    // A single full-screen layer doubles as both the dimmed backdrop AND the
    // centering container — its own onClick closes the modal, and the modal
    // itself stops that click from bubbling back up, the standard
    // click-outside-to-close pattern without needing two separate
    // overlapping full-screen divs (one purely for the dim, one purely for
    // centering) that would otherwise fight over which one owns the close-
    // on-click behavior.
    <motion.div className="absolute inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSim(null)}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="simulate-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-xl">Simulate: {sim.cat}</h2>
          <button data-testid="simulate-close-btn" onClick={() => setSim(null)}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-4">Mock-allocate an amount and watch your score react. Demo only.</p>
        <div className="text-center mb-2">
          <span className="font-heading font-black text-3xl text-[var(--dive-blue)]">{fmtINR(amount)}</span>
        </div>
        <input data-testid="simulate-slider" type="range" min="0" max="80000" step="1000" value={amount}
          onChange={(e) => setAmount(Number(e.target.value))} className="w-full accent-[var(--dive-blue)] mb-6" />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-[var(--surface-card-hover)] rounded-2xl p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">DIVVE Score</p>
            <div className="flex items-center justify-center gap-2">
              <span className="font-heading font-black text-2xl text-[var(--text-tertiary)]">{baseScore}</span>
              <ArrowRight size={16} className="text-[var(--text-tertiary)]" />
              <AnimatedNumber value={newScore} className={`font-heading font-black text-2xl ${newScore > baseScore ? "text-[var(--green)]" : newScore < baseScore ? "text-[var(--red)]" : "text-[var(--text-secondary)]"}`} />
            </div>
          </div>
          <div className="bg-[var(--surface-card-hover)] rounded-2xl p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Top exposure</p>
            <div className="flex items-center justify-center gap-2">
              <span className="font-heading font-black text-2xl text-[var(--text-tertiary)]">{baseTop.toFixed(0)}%</span>
              <ArrowRight size={16} className="text-[var(--text-tertiary)]" />
              <AnimatedNumber value={newTop} format={(v) => `${Math.round(v)}%`} className="font-heading font-black text-2xl text-[var(--dive-blue)]" />
            </div>
          </div>
        </div>
        {scoreWasCapped && (
          <p data-testid="simulate-capped-note" className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
            {sim.cat} is already {sim.categoryAction === "reduce" ? "over its ideal share" : "within its ideal share"} — adding more here won't move your DIVVE Score up, even though it can still reduce your single-company concentration below.
          </p>
        )}
        <p className="text-sm text-[var(--text-secondary)] mb-5 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 break-words">
          This would reduce your single-company exposure from <b className="text-[var(--dive-blue-dark)]">{baseTop.toFixed(0)}%</b> to <b className="text-[var(--dive-blue-dark)]">{newTop.toFixed(0)}%</b> and improve resilience to sector-specific shocks.
        </p>
        <button data-testid="simulate-apply-btn" onClick={apply}
          className="w-full gold-btn rounded-full py-4 font-bold hover:bg-[var(--dive-blue-hover)] transition-colors">
          Apply to my portfolio (Demo)
        </button>
      </motion.div>
    </motion.div>
  );
}

// These "what-if" scenarios all call the SAME diveScore() used everywhere
// else in the app (Home, X-Ray, Insights) — no parallel/duplicate formula —
// by constructing a hypothetical holdings list and re-running the real
// calculator on it, so the numbers stay honestly derived from the actual
// portfolio rather than a canned estimate.

// Scales down every holding attributed to the top company so its combined
// exposure lands at `capPct`% of the current total — a hypothetical "what if
// I trimmed this down" view, not an actual trade.
function capTopExposure(h, capPct) {
  const total = totalInvested(h);
  const top = topExposure(h);
  if (!total || top.pct <= capPct) return h;
  const scale = (capPct / 100) / (top.pct / 100);
  return h.map((holding) => {
    const isTopCompany = (holding.lookthrough || []).some((lt) => lt.company === top.name);
    return isTopCompany ? { ...holding, amount: holding.amount * scale } : holding;
  });
}

// Adds a modest hypothetical allocation (10% of current total each) to every
// core category the portfolio doesn't hold yet.
function fillMissingCategories(h) {
  const missing = missingCategories(h);
  const total = totalInvested(h) || 100000;
  const perCategoryAmount = total * 0.1;
  const additions = missing.map((cat) => ({
    id: `hypothetical-${cat}`,
    name: `Hypothetical ${cat}`,
    segment: cat,
    amount: perCategoryAmount,
    lookthrough: [{ company: `Hypothetical ${cat}`, pct: 100 }],
  }));
  return [...h, ...additions];
}

// `before` anchors on the ONE canonical Dive Score (same as Home/Score
// Breakdown); `after` applies the fast formula's estimated delta on top,
// rather than showing the lightweight formula's absolute value as a second,
// competing score.
function buildRealScenarios(h, canonicalScore) {
  const before = canonicalScore;
  const top = topExposure(h).pct;
  const missing = missingCategories(h).length;
  const baseline = diveScore(h);
  const deltaFor = (hypothetical) => Math.max(0, Math.min(100, Math.round(before + (diveScore(hypothetical) - baseline))));

  return [
    {
      id: "cap-issuer",
      name: "Cap single-issuer exposure at 30%",
      desc: `You're currently ${top.toFixed(0)}% concentrated in ${topExposure(h).name || "one holding"}.`,
      before,
      after: deltaFor(capTopExposure(h, 30)),
    },
    {
      id: "fill-categories",
      name: "Fill your missing categories",
      desc: missing > 0 ? `You're missing ${missing} core categor${missing === 1 ? "y" : "ies"}.` : "You already hold every core category.",
      before,
      after: deltaFor(fillMissingCategories(h)),
    },
    {
      id: "close-lookthrough-gap",
      name: "Close the apparent-vs-real gap",
      desc: "If none of your holdings shared an issuer with a holding in a different category.",
      before: Math.round(realDiversification(h)),
      after: Math.round(apparentDiversification(h)),
    },
  ];
}

function StressSheet({ setStress, baseHoldings, canonicalScore }) {
  const scenarios = buildRealScenarios(baseHoldings, canonicalScore);
  return (
    <>
      <motion.div className="absolute inset-0 bg-black/40 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setStress(false)} />
      <motion.div className="absolute bottom-0 inset-x-0 z-50 bg-[var(--surface-card)] rounded-t-3xl p-6 max-h-[85%] overflow-y-auto no-scrollbar"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-testid="stress-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-xl">What-if scenarios</h2>
          <button data-testid="stress-close-btn" onClick={() => setStress(false)}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-5">Computed from your real holdings — not a market forecast, just what your DIVVE Score would look like if you fixed each thing.</p>
        <div className="space-y-3">
          {scenarios.map((sc) => (
            <div key={sc.id} className="bg-[var(--surface-card-hover)] rounded-2xl p-4" data-testid={`stress-${sc.id}`}>
              <p className="font-bold text-sm">{sc.name}</p>
              <p className="text-xs text-[var(--text-secondary)] mb-3">{sc.desc}</p>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase">Now</p>
                  <span className="font-heading font-black text-xl text-[var(--red)]">{sc.before}</span>
                </div>
                <ArrowRight size={16} className="text-[var(--text-tertiary)]" />
                <div className="text-center">
                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase">If fixed</p>
                  <span className="font-heading font-black text-xl text-[var(--green)]">{sc.after}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
