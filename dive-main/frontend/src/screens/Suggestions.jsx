import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, TrendingUp, TrendingDown, Minus, FlaskConical, X, ArrowRight, ChevronRight, Landmark, Zap } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { ScoreRing, RangeBar, AnimatedNumber } from "../components/dive/Widgets";
import { buildSuggestions, rescaleIdealRanges, personalizeSuggestions, diveScore, topExposure, missingCategories, apparentDiversification, realDiversification, totalInvested, fmtINR, effectiveHoldings, segmentBreakdown } from "../lib/diveEngine";
import { contextSummaryMessage, isCategoryExpected, deferredIncreaseNote, deferredReduceNote, expectedCoreCategories } from "../lib/contextMessaging";
import { HoldingsLoadingState, HoldingsLoadErrorState, HoldingsEmptyState } from "../components/dive/HoldingsGateStates";
import { usePortalEnter } from "../lib/usePortalEnter";

// One tax fact per CORE_CATEGORIES entry (diveEngine.js) — the rate/threshold
// numbers below, and the specific instruments each category maps to
// (ASSET_CLASS_LABELS in diveEngine.js), were verified against multiple
// sources as of Aug 2026 rather than assumed from general knowledge, since
// this is exactly the kind of figure that goes stale silently:
//   - Equity/equity-oriented MF/ETF/REIT-InvIT capital gains: 20% STCG
//     (≤12 months) and 12.5% LTCG above a ₹1.25L/year exemption (equity/MF/
//     ETF) took effect 23 Jul 2024 (Budget 2024, ex-Sec 111A/112A) and are
//     unchanged by Budget 2025/2026. REIT/InvIT units get the same STCG/LTCG
//     RATES but not the ₹1.25L exemption — that's Sec 112, not 112A, per
//     PrimeInvestor's and Tax Garden's REIT/InvIT-specific breakdowns, not
//     the generic equity one.
//   - "Mutual Funds" here is diveEngine's generic MUTUAL_FUND bucket (equity
//     AND debt orientation both land here — there's no per-holding
//     equity/debt split surfaced to this engine), so the note has to cover
//     both branches rather than assume one.
//   - Debt-oriented MFs bought on/after 1 Apr 2023 lost LTCG treatment
//     entirely in the 2023 Budget — taxed at slab regardless of holding
//     period (cleartax.in/s/tax-on-debt-funds, bajajfinserv.in).
//   - FD TDS thresholds (₹50,000 general / ₹1,00,000 senior citizen, up from
//     ₹40,000/₹50,000) took effect 1 Apr 2025 (Budget 2025, Sec 194A) — the
//     interest itself was and remains fully taxable regardless; TDS is only
//     a withholding mechanic, never mentioned as if it were the exemption.
//   - Gold/Silver here also covers gold ETFs and gold mutual funds (per
//     diveEngine.js's own categorizeInstrument comment — "ETF" the CORE
//     CATEGORY excludes gold ETFs specifically), each with its own LTCG
//     holding-period threshold (12 months listed ETFs vs 24 months physical/
//     fund units) per Budget 2024's gold/silver simplification.
//   - Sovereign Gold Bonds' "held to maturity = fully tax-free" rule was
//     narrowed by the Income-tax Act, 2025/Budget 2026 (effective 1 Apr
//     2026) to ONLY the original subscriber holding since issue — a
//     secondary-market buyer no longer gets it. Getting this wrong would
//     overstate a real tax benefit, so it's phrased as conditional, not
//     absolute.
//   - Bonds' Section 10(15) full interest exemption applies only to specific
//     legacy PSU tax-free bond issues (NHAI/IRFC/PFC/REC/HUDCO, none issued
//     fresh since FY 2015-16) — regular corporate bonds/NCDs/G-Secs in the
//     same category don't get it, hence "specific ... bonds", not a blanket
//     category-wide claim.
//   - Insurance here is diveEngine's ULIP_INSURANCE bucket specifically (not
//     term/traditional insurance), so the note is scoped to ULIP's own
//     Sec 10(10D) ₹2.5L/year premium cap (Budget 2021) rather than the
//     ₹5L/year non-ULIP cap (Budget 2023), which is a different, unrelated
//     threshold for a policy type this category doesn't represent. The cap
//     is a cliff, not a marginal exemption — cross ₹2.5L (aggregated across
//     ALL of a person's ULIPs, not per-policy) in even one policy year and
//     that policy's Sec 10(10D) exemption is lost entirely, not just on the
//     excess; what then gets taxed is the GAIN (proceeds minus premiums),
//     treated like an equity-oriented fund — 20% STCG (≤12 months) or 12.5%
//     LTCG above its own ₹1.25L/year exemption (cleartax.in/s/unit-linked-
//     insurance-plan-taxation-rules, kotaklife.com/ulip-plans/ulip-taxation).
//   - Crypto's flat 30% (Sec 115BBH), no loss set-off, and 1% TDS
//     (₹10,000/₹50,000 threshold, Sec 194S) are unchanged since their 2022
//     introduction.
//   - PF (Provident Fund — diveEngine's PPF/EPF/VPF bucket): PPF's 80C/
//     interest/maturity exemption is fully uncapped and unconditional (aside
//     from the old-vs-new-tax-regime split, which applies to the 80C leg
//     ONLY, not the interest/maturity legs). EPF/VPF's interest-taxability
//     rule is a genuine, separate MARGINAL carve-out — only the interest on
//     an employee's OWN contribution above ₹2.5L/year (₹5L with no employer
//     contribution) is taxed, not the whole account — deliberately worded to
//     contrast with ULIP's all-or-nothing cliff above, not read the same
//     way. The rarer ₹7.5L/year employer-contribution perquisite rule (Sec
//     17(2)(vii)/(viia)) is also marginal (only the excess + its growth).
//     Rates/mechanics verified against EPFO/Ministry of Finance-sourced
//     reporting (cleartax.in/s/epf-interest-taxation-exceeding-2-5-lakh,
//     businesstoday.in coverage of the 239th CBT meeting) as of Aug 2026.
//
// Section numbers cited are the long-standing Income-tax Act, 1961 ones —
// still how virtually every source (and the user's own request) refers to
// them day-to-day — with a single shared disclaimer below (not repeated on
// every card) noting the Income-tax Act, 2025 recodified them without
// changing the rates/thresholds themselves.
const TAX_NOTES = {
  Equity: "Sell within 12 months and gains are taxed at 20% (STCG, Sec 111A). Hold longer and the first ₹1.25 lakh of gains each year is tax-free — anything above that is a flat 12.5% (LTCG, Sec 112A), with no indexation benefit.",
  "Mutual Funds": "Equity-oriented funds (≥65% in equity) are taxed exactly like stocks — 20% STCG within 12 months, or 12.5% LTCG above a ₹1.25 lakh/year exemption. Debt-oriented funds bought after 1 Apr 2023 get no long-term concession at all — every gain is taxed at your income slab rate.",
  Bonds: "Interest is added to your income and taxed at your slab rate. Capital gains on listed bonds held over 12 months are taxed at a flat 12.5% (no indexation). Exception: specific government-backed bonds (NHAI, IRFC, PFC, REC, HUDCO) pay interest that's fully tax-exempt under Section 10(15).",
  "Gold/Silver": "Physical gold, gold funds, and gold ETFs are taxed at 12.5% LTCG (24 months for physical/funds, 12 for ETFs) — under that, it's your slab rate. Sovereign Gold Bonds redeem fully tax-free only for the original buyer holding to maturity; the 2.5%/year interest along the way is still taxable.",
  "REIT/InvIT": "Capital gains work like equity — 20% STCG within 12 months, or 12.5% LTCG beyond that — but without the ₹1.25 lakh exemption equity shares get. The interest and rental portion of every payout is taxed at your slab rate; the dividend/capital-return portion is often tax-free, depending on how the trust is structured.",
  "FD/RD": "Interest is fully taxable at your income slab rate, with no exemption. Banks deduct 10% TDS once your interest from them crosses ₹50,000 in a year (₹1,00,000 if you're a senior citizen) — that's a withholding rule, not a tax break.",
  ETF: "Index and equity ETFs are taxed exactly like stocks: 20% STCG if sold within 12 months, or a flat 12.5% LTCG on gains above ₹1.25 lakh a year if held longer.",
  Insurance: "ULIP maturity proceeds are tax-free under Section 10(10D) — but only if your total annual premium across all your ULIPs stays at ₹2.5 lakh or less. Cross that in even one policy year and the exemption is lost entirely, not just on the excess: the gain (proceeds minus premiums paid) is then taxed like an equity fund instead — 20% if held ≤12 months, or 12.5% above a ₹1.25 lakh/year exemption if held longer. The death benefit stays 100% tax-free regardless of premium.",
  Crypto: "Every gain is taxed at a flat 30% (Section 115BBH) no matter how long you held it, and losses can't be set off against any other gains. A 1% TDS is also deducted on most sell transactions above ₹10,000–₹50,000 a year.",
  PF: "Contributions up to ₹1.5 lakh/year are deductible under Section 80C — but only under the old tax regime; the new regime (the default since FY2023-24) allows no 80C deduction at all. PPF interest and maturity proceeds are fully tax-free, with no cap or condition. EPF/VPF interest is tax-free too, unless your own contribution exceeds ₹2.5 lakh in a year (₹5 lakh if your employer contributes nothing) — cross that and only the interest earned on the excess becomes taxable at your slab rate, not the whole account (a marginal rule, not an all-or-nothing cliff like ULIP's). A rarer rule for high earners: if your employer's combined EPF + NPS + superannuation contributions exceed ₹7.5 lakh/year, the excess and its growth are taxed as a perquisite.",
};

// Which TAX_NOTES entries get the green "tax benefit" card border vs stay
// unhighlighted as a plain tax liability — a judgment call on each note's
// actual content, not every category that merely MENTIONS an exemption.
// Equity/Mutual Funds/ETF/REIT-InvIT all reference the standard ₹1.25L LTCG
// exemption, but that's boilerplate available to nearly any capital asset,
// not a distinctive feature of the category — those stay liability-framed.
// These four each have a genuine, standout tax-free outcome that's the
// headline of their own note: ULIP maturity under Sec 10(10D) (Insurance),
// specific tax-free PSU bonds under Sec 10(15) (Bonds), Sovereign Gold
// Bond tax-free redemption at maturity (Gold/Silver), and PPF's fully
// uncapped EEE status plus EPF/VPF's EEE status outside a narrow high-earner
// edge case (PF) — confirmed with the user as arguably the strongest
// tax-free feature of any category here.
const TAX_BENEFIT_CATEGORIES = new Set(["Insurance", "Bonds", "Gold/Silver", "PF"]);

export default function Suggestions() {
  const { holdings, holdingsLoading, holdingsError, loadHoldings, ranges, prefs, setScreen, setAskInstrument, sims, addSim, resetSims, scoreBreakdown } = useDive();
  const [sim, setSim] = useState(null); // {cat, amount}
  const [whatIf, setWhatIf] = useState(false);
  const [marketStress, setMarketStress] = useState(false);

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
    <div className="min-h-full dive-app-surface pb-10" data-testid="suggestions-screen">
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
        {/* Shared once, not repeated on every card's tax strip below — see
            TAX_NOTES' own header comment for how each figure was verified. */}
        <p data-testid="sugg-tax-disclaimer" className="mt-2 text-[10px] text-[var(--text-tertiary)] leading-relaxed">
          Tax notes below reflect Budget 2024–2026 rules for resident individuals. Section references follow the long-standing Income-tax Act, 1961 numbering; the Income-tax Act, 2025 (effective 1 Apr 2026) recodified these under new section numbers without changing the rates or thresholds. Not tax advice — confirm specifics with a tax professional before acting.
        </p>
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
              className={`bg-[var(--surface-card)] rounded-2xl p-5 border shadow-sm ${
                // The tax-benefit highlight lives on the tax note strip
                // itself now (below), not the whole card — s.prioritized
                // (the user's own explicit "preferred category" setting) is
                // the only thing that still colors the outer card border.
                s.prioritized ? "border-[var(--dive-blue)]" : "border-[var(--border)]"
              }`} data-testid={`sugg-card-${s.cat}`}>
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
              {/* Tax profile is a fact about the category itself, not about
                  whether Divve is actively pushing it right now — shown
                  regardless of deferred/capped/on-track/over-exposed state.
                  See TAX_NOTES above for sourcing on every number here.
                  TAX_BENEFIT_CATEGORIES gets a green border on just THIS
                  strip (not the whole card, unlike the earlier design) — the
                  highlight is scoped to the specific fact it's about. */}
              {TAX_NOTES[s.cat] && (
                <div data-testid={`sugg-tax-note-${s.cat}`}
                  className={`mt-3 bg-[var(--surface-card-hover)] rounded-xl px-3 py-2.5 flex items-start gap-2 border ${
                    TAX_BENEFIT_CATEGORIES.has(s.cat) ? "border-[var(--green)]" : "border-transparent"
                  }`}>
                  <Landmark size={14} className="text-[var(--text-tertiary)] shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    <span className="font-bold text-[var(--text-primary)]">Tax: </span>{TAX_NOTES[s.cat]}
                  </p>
                </div>
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

      {/* Two distinct features, deliberately not one button: "What If" (left)
          replays hypothetical PORTFOLIO FIXES (cap top-issuer, fill missing
          categories, close the lookthrough gap) — unrelated to markets moving.
          "Run Stress Test" (right) is the genuine MARKET-SHOCK test — see
          MarketStressSheet below. They used to be one misleadingly-labeled
          "Run Stress Test" button covering only the first concept. */}
      <div className="px-6 mt-6 flex gap-3">
        <button data-testid="what-if-btn" onClick={() => setWhatIf(true)}
          className="flex-1 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
          <FlaskConical size={18} className="text-[var(--dive-blue)]" /> What If
        </button>
        <button data-testid="stress-test-btn" onClick={() => setMarketStress(true)}
          className="flex-1 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
          <Zap size={18} className="text-[var(--dive-blue)]" /> Run Stress Test
        </button>
      </div>

      <AnimatePresence>
        {sim && <SimulateSheet sim={sim} setSim={setSim} baseHoldings={h} onApply={applySim} canonicalScore={canonicalScore} scoreBreakdown={scoreBreakdown} />}
        {whatIf && <WhatIfSheet setWhatIf={setWhatIf} baseHoldings={h} canonicalScore={canonicalScore} scoreBreakdown={scoreBreakdown} />}
        {marketStress && <MarketStressSheet setMarketStress={setMarketStress} baseHoldings={h} scoreBreakdown={scoreBreakdown} />}
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
  // See lib/usePortalEnter.js — framer-motion's own initial/animate/exit
  // auto-trigger is unreliable for anything portaled to document.body.
  const { entered, handleClose } = usePortalEnter(() => setSim(null));
  return createPortal(
    // Portaled straight to document.body, OUTSIDE DiveShell's own
    // `overflow-y-auto` content column — `position: fixed` alone isn't
    // enough to escape a scrollable ancestor's OWN internal scrolling if the
    // element is still nested inside it as regular content (a transformed
    // ancestor changes which box `fixed` positions against, it doesn't grant
    // immunity from that box's scrolling — see DiveShell.jsx's comment on
    // its content column for the fuller explanation). Rendering here instead
    // means "fixed" finally means what it's supposed to: pinned to the true
    // browser viewport, unaffected by how far the underlying screen is
    // scrolled — the actual bug this fixes (open this after scrolling deep
    // into a long Suggestions list and it used to render off the top of the
    // visible viewport instead of centered in view).
    //
    // `md:left-56` (matching the sidebar's own `md:w-56` in DiveShell.jsx)
    // is the tradeoff that comes with portaling to document.body: it's no
    // longer naturally scoped to just this content column the way it was
    // when nested inside DiveShell's `relative` wrapper (which excluded the
    // sidebar "for free"), so this restates that exclusion explicitly —
    // without it, the backdrop/centering would span the sidebar's width too,
    // and the card would center in the FULL window instead of just the
    // content area, the same bug already fixed once for GetStartedPopup.
    //
    // A single full-screen layer doubles as both the dimmed backdrop AND the
    // centering container — its own onClick closes the modal, and the modal
    // itself stops that click from bubbling back up, the standard
    // click-outside-to-close pattern without needing two separate
    // overlapping full-screen divs (one purely for the dim, one purely for
    // centering) that would otherwise fight over which one owns the close-
    // on-click behavior.
    <motion.div className="fixed inset-0 md:left-56 z-40 bg-black/40 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }} onClick={handleClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="simulate-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-xl">Simulate: {sim.cat}</h2>
          <button data-testid="simulate-close-btn" onClick={handleClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
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
    </motion.div>,
    document.body
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
function buildRealScenarios(h, canonicalScore, scoreBreakdown) {
  const before = canonicalScore;

  // Apparent/Real Diversification % for the "close the gap" card below MUST
  // anchor on the same canonical scoreBreakdown values Home.jsx/AskDive.jsx/
  // ScoreBreakdown.jsx already show — same "single source of truth" principle
  // this function already applies to `before` above. The LOCAL apparentDiversification()/
  // realDiversification() calls only detect overlap via a crude holding-NAME
  // match (see crossSegmentOverlaps' own comment); the backend's real
  // lookthrough/connectedness engine (lookthroughService.ts) catches
  // cross-class overlaps that heuristic misses, which is exactly why a user
  // could see Home's real REAL DIV. tile read below Apparent while this
  // card, using the local formula, wrongly showed no gap at all.
  const hasCanonicalDiv = !!scoreBreakdown?.hasHoldings;
  const canonicalApp = hasCanonicalDiv ? scoreBreakdown.apparentDiversificationPct : Math.round(apparentDiversification(h));
  const canonicalReal = hasCanonicalDiv ? scoreBreakdown.realDiversificationPct : Math.round(realDiversification(h));
  const top = topExposure(h).pct;
  const missing = missingCategories(h).length;
  const baseline = diveScore(h);
  const deltaFor = (hypothetical) => Math.max(0, Math.min(100, Math.round(before + (diveScore(hypothetical) - baseline))));

  // "Closing the gap" only changes whether cross-class issuer overlap exists —
  // it doesn't touch WHAT you hold or how it's split across asset classes. So
  // unlike the two estimates above (which re-run the frontend's own simplified
  // diveScore() on a hypothetical holdings list), this delta is exact, not
  // approximate: the backend's own documented concentration formula
  // (DIVE_SCORE_MODEL.md §6.4) is
  //   concentrationScore = apparent*0.50 + real*0.15 + name*0.20 + withinClass*0.15
  // and closing the gap sets real -> apparent (overlapShare -> 0), leaving
  // every other term untouched — so the concentration sub-score's exact swing
  // is just realDiversificationPct's own weight (0.15) applied to a gap we
  // already know exactly (canonicalApp - canonicalReal, both real backend
  // numbers). Scaled into the composite the same way SimulateSheet already
  // scales its own concentration-only estimate, by concentration's real share
  // of the composite (scoreBreakdown.weights.concentration).
  const REAL_DIV_WEIGHT_IN_CONCENTRATION = 0.15;
  const concentrationWeight = scoreBreakdown?.weights?.concentration ?? 0.17;
  const gapConcentrationDelta = (canonicalApp - canonicalReal) * REAL_DIV_WEIGHT_IN_CONCENTRATION;
  const gapScoreDelta = gapConcentrationDelta * concentrationWeight;

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
      desc: `Real diversification is ${canonicalReal}% versus an apparent ${canonicalApp}% right now.`,
      before,
      after: Math.max(0, Math.min(100, Math.round(before + gapScoreDelta))),
    },
  ];
}

// Pure restyle of the former StressSheet — content/math (buildRealScenarios,
// capTopExposure, fillMissingCategories above) is UNCHANGED, only the wrapper
// chrome moved from a full-width bottom sheet to the same floating centered-
// modal pattern SimulateSheet already uses, for visual consistency between
// the two "sheet" experiences on this screen.
function WhatIfSheet({ setWhatIf, baseHoldings, canonicalScore, scoreBreakdown }) {
  const scenarios = buildRealScenarios(baseHoldings, canonicalScore, scoreBreakdown);
  // Portaled to document.body — see SimulateSheet's comment above for why:
  // `fixed` nested inside DiveShell's own scrolling content column still
  // scrolled along with it, so this rendered off-screen if opened after
  // scrolling partway down a long Suggestions list. See lib/usePortalEnter.js
  // for why the animation is driven by `entered`, not framer-motion's own
  // initial/animate/exit auto-trigger.
  const { entered, handleClose } = usePortalEnter(() => setWhatIf(false));
  return createPortal(
    <motion.div className="fixed inset-0 md:left-56 z-40 bg-black/40 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }} onClick={handleClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="what-if-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-xl">What-if scenarios</h2>
          <button data-testid="what-if-close-btn" onClick={handleClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-5">Computed from your real holdings — not a market forecast, just what your DIVVE Score would look like if you fixed each thing.</p>
        <div className="space-y-3">
          {scenarios.map((sc) => (
            <div key={sc.id} className="bg-[var(--surface-card-hover)] rounded-2xl p-4" data-testid={`what-if-${sc.id}`}>
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
    </motion.div>,
    document.body
  );
}

// =============================================================
// Market Stress Test — a GENUINE market-shock estimate, distinct from
// WhatIfSheet above (which replays hypothetical portfolio FIXES, not market
// moves). Every number here is either real backend data (scoreBreakdown's
// sub-scores) or a cited, reasoned estimate — never fabricated, per
// docs/DIVE_SCORE_MODEL.md §5's project-wide rule. See §11-adjacent new
// subsection in that doc for the full citations behind every row below.
// =============================================================

// "Resilience" here = the 5 sub-scores that actually respond to a market-
// VALUE shock (volatility/drawdown/var/beta/correlation) — deliberately
// excluding: liquidity (exit-ability, doesn't move on a price shock),
// concentration (already the direct input to the Sector Crash scenario
// below — including it too would double-penalize a concentrated portfolio),
// diversificationRatio (backward-looking correlation-smoothing measure, not
// shock-responsive), and contextFit/stockCountFit (life-stage/breadth fit,
// not shock-responsive). Weights are read from scoreBreakdown.weights at
// runtime (not hardcoded) — same "single source of truth" principle
// SimulateSheet already applies to its own concentrationWeight — so this
// stays correct automatically if DIVE_SCORE_V2_WEIGHTS is ever rebalanced.
const RESILIENCE_DIMS = ["volatility", "drawdown", "var", "beta", "correlation"];
const RESILIENCE_WEIGHTS_FALLBACK = { volatility: 0.12, drawdown: 0.12, var: 0.08, beta: 0.08, correlation: 0.08 };

function resilienceScore(scoreBreakdown) {
  const weights = scoreBreakdown?.weights || RESILIENCE_WEIGHTS_FALLBACK;
  const subScores = scoreBreakdown?.subScores;
  if (!subScores) return 0;
  const dimWeightSum = RESILIENCE_DIMS.reduce((s, d) => s + (weights[d] ?? RESILIENCE_WEIGHTS_FALLBACK[d]), 0);
  const weighted = RESILIENCE_DIMS.reduce(
    (s, d) => s + ((weights[d] ?? RESILIENCE_WEIGHTS_FALLBACK[d]) / dimWeightSum) * (subScores[d]?.score ?? 0),
    0
  );
  return Math.max(0, Math.min(100, Math.round(weighted)));
}

// Per-category sensitivity (0-1 = fraction of that category's portfolio
// weight "at risk" in the scenario; negative = a genuine benefit, e.g.
// gold's safe-haven role). Keyed to the 10 CORE_CATEGORIES labels
// segmentBreakdown() already returns, not the 12-way backend enum — avoids
// a second classification axis this file doesn't otherwise track. Merged
// categories (Gold/Silver, REIT/InvIT) use the plain arithmetic mean of
// their two constituents — a market-share-weighted blend would need an
// unverifiable ratio this codebase has no cited source for.
//
// Magnitudes are anchored to the already-cited betas in SYNTHETIC_PARAMS
// (backend/src/services/priceHistoryService.ts), not asserted from scratch:
//   - Geopolitical Tension: Equity anchored to India's recurring
//     oil-import-driven geopolitical corrections (1991 Gulf War, 2022
//     Ukraine war, 2023-24 Middle East flare-ups). Mutual Funds/ETF scaled
//     by SYNTHETIC_PARAMS' own beta ratios (0.75/0.9 vs Equity's 1.0).
//     Gold/Silver negative, per the World Gold Council-cited safe-haven
//     property SYNTHETIC_PARAMS.GOLD already documents. Crypto highest,
//     citing the SAME Corbet/Meegan/Larkin/Lucey/Yarovaya 2018 and Baur &
//     Dimpfl 2021 sources SYNTHETIC_PARAMS.CRYPTO cites for "occasional
//     stress spikes" — this IS that stress case, not the calm-period low
//     correlation SYNTHETIC_PARAMS' own beta (0.3) describes. FD/PF at 0:
//     neither is marked-to-market, so a shock doesn't change their current
//     value (same principle as SYNTHETIC_PARAMS.FD/PF's beta: 0).
//   - Rate Hike: a different channel (duration/valuation, not equity-beta).
//     Bonds highest via the textbook duration/price-yield relationship.
//     REIT/InvIT next (yield-competing, financing-cost-sensitive). Gold/
//     Silver flips POSITIVE here (real-rate/opportunity-cost channel,
//     opposite driver from Geopolitical). Crypto high, citing its real 2022
//     hiking-cycle drawdown. FD/PF at 0 for the SAME reason as above — an
//     existing FD/PF's current value doesn't move on a rate change; only
//     NEW deposits/contributions earn more going forward, a forward-looking
//     effect this scenario isn't modeling. (PF's slightly higher long-run
//     *volatility* in SYNTHETIC_PARAMS reflects a different, multi-year
//     phenomenon — periodic government rate revisions — not an acute shock,
//     so it doesn't conflict with 0 here.)
const MARKET_STRESS_SENSITIVITY = {
  geopolitical: {
    Equity: 0.35, "Mutual Funds": 0.26, ETF: 0.32, Bonds: 0.08,
    "Gold/Silver": -0.09, "REIT/InvIT": 0.17, Insurance: 0.12,
    "FD/RD": 0, PF: 0, Crypto: 0.45,
  },
  rateHike: {
    Equity: 0.25, "Mutual Funds": 0.19, ETF: 0.22, Bonds: 0.55,
    "Gold/Silver": 0.17, "REIT/InvIT": 0.43, Insurance: 0.20,
    "FD/RD": 0, PF: 0, Crypto: 0.50,
  },
};

// Sector Crash reuses the SAME lookthrough data topExposure() already
// computes (shown elsewhere on this screen, in SimulateSheet's "Top
// exposure" card) — but restricted to categories where a real single-
// business collapse is a coherent risk. Bonds/Gold-Silver/FD/PF/Insurance
// are deliberately excluded: their lookthrough uses generic non-company
// placeholders ("Gold", "Govt / Bank", "EPFO / Govt" — see SIM_TEMPLATES in
// diveEngine.js) that don't represent real business/credit risk the way an
// equity issuer does. Gold doesn't have a "sector" that can crash; a locked
// FD/PF's value isn't exposed to any company's collapse. A portfolio
// dominated by one of these excluded categories correctly resolves to ~0
// Sector Crash sensitivity here — not a fall — the financially honest
// answer, unrelated to whatever Geopolitical Tension shows for the same
// portfolio (different risk vectors).
const SECTOR_CRASH_CATEGORIES = new Set(["Equity", "Mutual Funds", "ETF", "REIT/InvIT", "Crypto"]);
// 60% of the top single company's real portfolio share — moderate-severe:
// real Indian single-stock/sector collapses span roughly 50-90%
// peak-to-trough (Yes Bank ~-85% single-day 2020, Adani Group ~-50 to -60%
// over days in Jan 2023, Satyam fraud ~-78% single-day 2009, IL&FS/DHFL debt
// sector collapse >90%). 0.6 sits in the moderate-severe part of that range
// — below the most extreme idiosyncratic fraud/governance-collapse cases
// (not what a named, repeatable "Sector Crash" scenario should represent),
// above a routine correction.
const SECTOR_CRASH_SEVERITY = 0.6;

function crashableTopExposure(h) {
  const crashable = h.filter((holding) => SECTOR_CRASH_CATEGORIES.has(holding.segment));
  const top = topExposure(crashable); // identifies the top company among ONLY crashable-category holdings
  if (!top.name || top.name === "-") return { name: null, pct: 0 };
  // Re-measure that company's TRUE share of the FULL portfolio (not just the
  // crashable subset) — same aggregation capTopExposure() above already
  // uses — so a small equity sleeve inside a mostly-gold/FD portfolio isn't
  // reported as if it were the dominant holding.
  const total = totalInvested(h);
  const companyAmount = h.reduce((sum, holding) => {
    const share = (holding.lookthrough || []).find((lt) => lt.company === top.name);
    return sum + (share ? holding.amount * (share.pct / 100) : 0);
  }, 0);
  return { name: top.name, pct: total ? (companyAmount / total) * 100 : 0 };
}

// Every sensitivity value above is bounded to roughly [-0.12, 0.6] in
// magnitude, and segmentBreakdown()'s weights always sum to 1.0, so a single
// shared maxSwing (rather than three separately-tuned per-scenario
// constants, which would mean re-deciding "how severe is this scenario"
// twice) already produces a well-differentiated, self-bounded point swing —
// roughly [-12, +55] points for any realistic holdings mix — without extra
// tuning. Mirrors the "self-bounding by construction" property SimulateSheet
// documents for its own concentration-delta estimate.
const MARKET_STRESS_MAX_SWING = 100;

function buildMarketStressScenarios(h, scoreBreakdown) {
  const before = resilienceScore(scoreBreakdown);
  const breakdown = segmentBreakdown(h);
  const weightedSensitivity = (table) =>
    breakdown.reduce((sum, seg) => sum + (seg.pct / 100) * (table[seg.name] ?? 0), 0);
  const afterFor = (weighted) => Math.max(0, Math.min(100, Math.round(before - weighted * MARKET_STRESS_MAX_SWING)));

  return [
    { id: "geopolitical", label: "Geopolitical", before, after: afterFor(weightedSensitivity(MARKET_STRESS_SENSITIVITY.geopolitical)) },
    { id: "rate-hike", label: "Rate Hike", before, after: afterFor(weightedSensitivity(MARKET_STRESS_SENSITIVITY.rateHike)) },
    { id: "sector-crash", label: "Sector Crash", before, after: afterFor((crashableTopExposure(h).pct / 100) * SECTOR_CRASH_SEVERITY) },
  ];
}

function MarketStressSheet({ setMarketStress, baseHoldings, scoreBreakdown }) {
  const ready = !!scoreBreakdown?.hasHoldings;
  const scenarios = ready ? buildMarketStressScenarios(baseHoldings, scoreBreakdown) : [];
  // Portaled to document.body — see SimulateSheet's comment above for why,
  // and lib/usePortalEnter.js for why the animation is driven by `entered`.
  const { entered, handleClose } = usePortalEnter(() => setMarketStress(false));
  return createPortal(
    <motion.div className="fixed inset-0 md:left-56 z-40 bg-black/40 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }} onClick={handleClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="market-stress-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-black text-xl">Stress test</h2>
          <button data-testid="market-stress-close-btn" onClick={handleClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        {ready ? (
          <>
            <p className="text-sm text-[var(--text-secondary)] mb-5">Estimated from your real holdings and resilience data — not a market forecast, just how your resilience score would likely move under each scenario.</p>
            <div className="grid grid-cols-3 gap-2">
              {scenarios.map((sc) => {
                // Conditional coloring, not hardcoded red — a Gold/Silver-
                // heavy portfolio can genuinely show after > before under
                // Geopolitical Tension (real safe-haven benefit, not a bug),
                // same conditional pattern SimulateSheet already uses for
                // its own score delta.
                const color = sc.after > sc.before ? "text-[var(--green)]" : sc.after < sc.before ? "text-[var(--red)]" : "text-[var(--text-secondary)]";
                return (
                  <div key={sc.id} className="bg-[var(--surface-card-hover)] rounded-2xl p-3 text-center" data-testid={`market-stress-${sc.id}`}>
                    <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-2">{sc.label}</p>
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span data-testid={`market-stress-${sc.id}-before`} className="font-heading font-black text-lg text-[var(--text-tertiary)]">{sc.before}</span>
                      <ArrowRight size={12} className="text-[var(--text-tertiary)] shrink-0" />
                      <AnimatedNumber data-testid={`market-stress-${sc.id}-after`} value={sc.after} className={`font-heading font-black text-lg ${color}`} />
                    </div>
                    <p className="text-[9px] text-[var(--text-tertiary)] mt-1">resilience score</p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p data-testid="market-stress-not-ready" className="text-sm text-[var(--text-secondary)]">Your resilience data isn't ready yet — add a holding first, or check back once your DIVVE Score has finished computing.</p>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}
