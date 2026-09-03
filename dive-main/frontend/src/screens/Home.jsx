import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronRight, X, Sparkles, Link2, Compass } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { ScoreRing, AnimatedNumber } from "../components/dive/Widgets";
import { HoldingsLoadingState, HoldingsLoadErrorState, HoldingsEmptyState } from "../components/dive/HoldingsGateStates";
import {
  diveScore, topExposure, totalInvested, apparentDiversification,
  realDiversification, segmentBreakdown, fmtINR, effectiveHoldings, CORE_CATEGORIES,
} from "../lib/diveEngine";
import { isCategoryExpected, contextSummaryMessage } from "../lib/contextMessaging";
import { usePortalEnter } from "../lib/usePortalEnter";
import { DownloadReportButton } from "../lib/useDownloadReport";

export default function Home() {
  const { holdings, holdingsLoading, holdingsError, loadHoldings, user, setScreen, sims, resetSims, scoreBreakdown, loadScoreBreakdown, walkthroughOpen } = useDive();
  const simulating = sims.some((s) => s.amount > 0);
  // Shown once per browser session (sessionStorage — clears when the tab
  // closes, unlike localStorage), not once ever — so it doesn't nag a
  // returning user days later, but also doesn't reappear on every Home visit
  // within the same sitting. Keyed per-user, not just a flat flag: this app's
  // own DiveContext.js already calls out the shared/kiosk-browser case (one
  // person logs out, a different person logs in on the same tab) — a flat
  // key would wrongly skip the popup for a genuinely-new person's first-ever
  // Home visit just because someone else already saw it in this tab. Reads
  // and writes happen together in the lazy initializer (not a separate
  // effect) so "seen" is recorded at the exact moment it's decided to show,
  // regardless of how the user leaves — dismiss, navigate away, anything.
  const [showGetStarted, setShowGetStarted] = useState(() => {
    const key = user?.id ? `divve_get_started_shown:${user.id}` : null;
    if (!key) return true;
    try {
      if (sessionStorage.getItem(key) === "true") return false;
      sessionStorage.setItem(key, "true");
      return true;
    } catch (e) {
      // Private-browsing/storage-disabled contexts can throw — fail open
      // (show it) rather than silently breaking the nudge entirely.
      return true;
    }
  });

  useEffect(() => {
    if (!scoreBreakdown && holdings.length) loadScoreBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.length]);

  // A blank `return null` looks identical to a crash — every one of these
  // needs its own visible state, not just the happy path.
  if (holdingsLoading) return <HoldingsLoadingState testId="home-loading-state" />;
  // A failed load must not look like a genuinely empty portfolio — those are
  // different states with different fixes (retry vs. go add a holding).
  if (!holdings.length && holdingsError) {
    return <HoldingsLoadErrorState onRetry={loadHoldings} testId="home-load-error-state" retryTestId="home-load-error-retry-btn" />;
  }
  if (!holdings.length) {
    return (
      <>
        <HoldingsEmptyState setScreen={setScreen} testId="home-empty-state" ctaTestId="home-empty-add-btn"
          title="No investments yet" body="Add your first holding and DIVVE will score your portfolio." ctaLabel="Add investments" />
        {/* Suppressed while the guided walkthrough (DiveShell.jsx) is open —
            a first-time, zero-holdings user would otherwise get both
            full-screen-ish overlays at once. The walkthrough finishing or
            being skipped is what reveals this, not any explicit hand-off
            logic — see DiveShell.jsx's own onDone comment. */}
        <AnimatePresence>
          {showGetStarted && !walkthroughOpen && <GetStartedPopup setScreen={setScreen} onClose={() => setShowGetStarted(false)} />}
        </AnimatePresence>
      </>
    );
  }
  const h = effectiveHoldings(holdings, sims);
  const segs = segmentBreakdown(h);
  const missingCore = CORE_CATEGORIES.filter((c) => !segs.some((s) => s.name === c));
  // Layer D — Context Engine: only nudge toward a missing category if it's
  // actually expected for this user's corpus size and life stage right now
  // (see backend/src/services/contextEngine.ts). A missing category that
  // isn't expected yet gets reassurance instead of a generic "you're
  // missing X" warning.
  const context = scoreBreakdown?.context;
  const missingExpectedCore = missingCore.filter((c) => isCategoryExpected(c, context));

  // The ONE canonical Dive Score comes from the backend (the same number the
  // Score Breakdown screen shows). While a hypothetical "simulate this
  // change" is active — a state the backend has no way to price — fall back
  // to the same-methodology fast client estimate instead, clearly labeled.
  const useServerScore = !simulating && !!scoreBreakdown?.hasHoldings;
  const score = useServerScore ? scoreBreakdown.compositeScore : diveScore(h);
  const app = useServerScore ? scoreBreakdown.apparentDiversificationPct : apparentDiversification(h);
  const real = useServerScore ? scoreBreakdown.realDiversificationPct : realDiversification(h);
  const top = topExposure(h);
  const total = totalInvested(h);

  let missingCategoryInsight;
  if (missingCore.length === 0) {
    missingCategoryInsight = { type: "good", icon: CheckCircle2, text: "You've got holdings across all core categories" };
  } else if (missingExpectedCore.length > 0) {
    missingCategoryInsight = { type: "danger", icon: AlertTriangle, text: `You haven't added any ${missingExpectedCore[0]} yet — a whole category you're missing` };
  } else {
    // Missing categories exist, but none are expected yet for this user's
    // corpus/age — reassure instead of nudging toward something premature.
    missingCategoryInsight = { type: "good", icon: CheckCircle2, text: contextSummaryMessage(context) || "Your current mix is a fine starting point for your stage" };
  }

  const insights = [
    top.pct > 0 && { type: "danger", icon: AlertTriangle, text: `${top.pct.toFixed(0)}% of your money is tied to ${top.name}` },
    missingCategoryInsight,
  ].filter(Boolean);

  return (
    <div className="min-h-full dive-app-surface pb-24 lg:pb-10" data-testid="home-screen">
      <div className="px-6 pt-8 lg:px-8">
        {/* Search/Your Journey (formerly the bell here)/profile are now the
            global AppHeader (components/AppHeader.jsx) — reachable from
            every screen, not just Home, so they're no longer duplicated here. */}
        <p className="text-sm text-[var(--text-secondary)]">Welcome back</p>
        <h1 className="font-heading font-black text-2xl">Hi {user?.name?.split(" ")[0] || "there"} 👋</h1>
      </div>

      {simulating && (
        <div className="px-6 mt-4 lg:px-8">
          <div className="flex items-center justify-between bg-[var(--dive-blue-light)] rounded-xl px-4 py-2.5" data-testid="home-sim-banner">
            <span className="text-xs font-bold text-[var(--dive-blue-dark)]">Estimated with your simulated changes</span>
            <button data-testid="home-reset-sims" onClick={resetSims} className="text-xs font-bold text-[var(--dive-blue-dark)] underline">Reset</button>
          </div>
        </div>
      )}

      {/* Below md, this stays exactly the original single stacked column —
          the lg:grid only activates once the sidebar (DiveShell.jsx) has
          already freed up real width to use. Score card on the left,
          Insights + the 3 action buttons on the right, instead of every
          section fighting for the same narrow mobile-width column.
          Deliberately no lg:max-w/mx-auto here — a first pass capped this at
          lg:max-w-5xl centered, which just moved the "dead space on both
          sides" problem from the page level down to the screen level. This
          fills whatever width the sidebar layout actually gives it. */}
      {/* lg:items-start deliberately dropped — grid's default align-items
          (stretch) makes both columns exactly the right column's height, so
          the score card (lg:flex-1 inside a lg:flex lg:flex-col column, see
          just below) can fill that entire height: its top naturally lines
          up with the top of "Insights" on the right (both are just the
          first thing in their column), and its bottom lands exactly on
          "Add more investments"'s bottom, since the column is now exactly
          that tall. */}
      <div className="lg:grid lg:grid-cols-5 lg:gap-6 lg:px-8 lg:mt-8">
        <div className="px-6 mt-6 lg:px-0 lg:mt-0 lg:col-span-2 lg:flex lg:flex-col">
          {/* Not a button anymore, deliberately — the "See the full
              breakdown →" link into ScoreBreakdown.jsx used to sit here.
              Score Breakdown is being held back from direct site access for
              now (we already offer the same resilience data as the paid PDF
              report below); this is a display-only card until that
              screen/route comes back post-subscription-plans. ScoreBreakdown.jsx
              itself is untouched — only this one entry point is removed.
              No spacer above this anymore — the column's top now lines up
              directly with the top of the "Insights" WORD on the right
              (both are simply the first thing in their column, and the grid
              row's default stretch — see the comment above — keeps both
              columns exactly the same height). lg:flex-1 makes the card's
              own box fill that entire column height, so its BOTTOM lands
              exactly on "Add more investments"'s bottom on the right.
              Content stays centered vertically (lg:justify-center) so the
              extra room this taller box now has reads as intentional
              breathing space, not a stray gap — the stat boxes below are
              also a bit taller (p-5, not p-4) for the same reason: more of
              that room is deliberately filled, not left empty. */}
          <motion.div data-testid="home-score-ring-card"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            className="w-full lg:flex-1 bg-[var(--surface-card)] rounded-3xl p-6 shadow-sm border border-[var(--border)] flex flex-col items-center lg:justify-center">
            <ScoreRing score={score} size={160} />
            <div className="grid grid-cols-2 gap-3 w-full mt-8">
              <div className="rounded-2xl bg-[var(--red)]/10 border border-[var(--red)]/20 p-5 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--red)]">Apparent div.</p>
                <AnimatedNumber value={app} format={(v) => `${Math.round(v)}%`} className="font-heading font-black text-2xl text-[var(--red)]" />
              </div>
              <div className="rounded-2xl bg-[var(--green)]/10 border border-[var(--green)]/20 p-5 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--green)]">Real div.</p>
                <AnimatedNumber value={real} format={(v) => `${Math.round(v)}%`} className="font-heading font-black text-2xl text-[var(--green)]" />
              </div>
            </div>
            <div className="flex justify-between w-full mt-6 text-sm">
              <span className="text-[var(--text-secondary)]">Total invested</span>
              <span className="font-bold">{fmtINR(total)}</span>
            </div>
            <div className="flex justify-between w-full mt-2 text-sm">
              <span className="text-[var(--text-secondary)]">Segments</span>
              <span className="font-bold">{segs.length}</span>
            </div>
          </motion.div>
        </div>

        <div className="lg:col-span-3">
          <div className="px-6 mt-8 lg:px-0 lg:mt-0">
            <h2 className="font-heading font-bold text-lg mb-3">Insights</h2>
            <div className="space-y-3">
              {insights.map((ins, i) => (
                <motion.button key={i} data-testid={`insight-card-${i}`} onClick={() => setScreen("xray")}
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                  className="w-full flex items-center gap-3 text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${ins.type === "danger" ? "bg-[#FEE2E2]" : "bg-[#D1FAE5]"}`}>
                    <ins.icon size={18} className={ins.type === "danger" ? "text-[var(--red)]" : "text-[var(--green)]"} />
                  </div>
                  <span className="text-sm font-semibold flex-1 break-words">{ins.text}</span>
                  <ChevronRight size={18} className="text-[var(--text-tertiary)]" />
                </motion.button>
              ))}
            </div>
          </div>

          <div className="px-6 mt-6 lg:px-0">
            <button data-testid="home-see-xray-btn" onClick={() => setScreen("xray")}
              className="w-full gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 shadow-lg shadow-[var(--dive-blue)]/25 hover:bg-[var(--dive-blue-hover)] transition-colors">
              See the Full X-Ray <ChevronRight size={18} />
            </button>
            <button data-testid="home-manage-holdings-btn" onClick={() => setScreen("myHoldings")}
              className="w-full mt-3 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
              Manage holdings
            </button>
            <button data-testid="home-add-more-btn" onClick={() => setScreen("chooseMethod")}
              className="w-full mt-3 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
              Add more investments
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 mt-10 lg:px-8 flex flex-col items-center">
        <DownloadReportButton testId="home-download-report-btn" />
      </div>
    </div>
  );
}

// First-run nudge shown on Home whenever the portfolio is genuinely empty —
// a fresh signup, or a login/session-restore that found no saved holdings
// (see DiveContext.js's session-restore effect and login()) now land here
// instead of being dropped straight into the fetch-method chooser with no
// dashboard in sight. Same floating centered-modal pattern already
// established by Suggestions.jsx's WhatIfSheet/MarketStressSheet, for visual
// consistency across the app. Purely a navigational nudge — no numbers of
// any kind, so there's nothing here that could ever be a fabricated figure.
function GetStartedPopup({ setScreen, onClose }) {
  // See lib/usePortalEnter.js — framer-motion's own initial/animate/exit
  // auto-trigger is unreliable for anything portaled to document.body, this
  // one included (confirmed directly via computed style: stuck at
  // `opacity: 0` on a genuinely fresh account, well after mount).
  const { entered, handleClose } = usePortalEnter(onClose);

  // Portaled to document.body, outside DiveShell's own `overflow-y-auto`
  // content column — `position: fixed` alone doesn't escape a scrollable
  // ancestor's own internal scrolling for content still nested inside it
  // (see DiveShell.jsx's content-column comment for the fuller explanation,
  // and Suggestions.jsx's WhatIfSheet/MarketStressSheet, which hit the exact
  // same bug and got the same fix). `md:left-56` restates the sidebar
  // exclusion explicitly (matching DiveShell's own `md:w-56`) since
  // portaling loses the "free" scoping the old `relative` ancestor gave it.
  return createPortal(
    <motion.div className="fixed inset-0 md:left-56 z-40 bg-black/40 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }} onClick={handleClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[var(--surface-card)] rounded-3xl p-8 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="get-started-popup">
        <div className="flex items-start justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
            <Sparkles size={24} className="text-[var(--dive-blue)]" />
          </div>
          <button data-testid="get-started-close-btn" onClick={handleClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <h2 className="font-heading font-black text-2xl mb-2.5">Let's see your real diversification</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-6">Add what you already hold, or tell us how much you have — either way, DIVVE scores it in under a minute.</p>
        <div className="space-y-3.5">
          <button data-testid="get-started-fetch-btn" onClick={() => setScreen("chooseMethod")}
            className="w-full flex items-center gap-4 text-left bg-[var(--surface-card-hover)] rounded-2xl p-5 border border-[var(--border)] hover:shadow-md transition-all">
            <div className="w-12 h-12 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <Link2 size={22} className="text-[var(--dive-blue)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-base">Fetch my investments</p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">Connect, scan, upload, or add manually — pick whatever's easiest.</p>
            </div>
            <ChevronRight size={20} className="text-[var(--text-tertiary)] shrink-0" />
          </button>
          <button data-testid="get-started-planner-btn" onClick={() => setScreen("planner")}
            className="w-full flex items-center gap-4 text-left bg-[var(--surface-card-hover)] rounded-2xl p-5 border border-[var(--border)] hover:shadow-md transition-all">
            <div className="w-12 h-12 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <Compass size={22} className="text-[var(--dive-blue)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-base">Start my investment journey</p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">New to investing? We'll map out exactly how to split your money.</p>
            </div>
            <ChevronRight size={20} className="text-[var(--text-tertiary)] shrink-0" />
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
