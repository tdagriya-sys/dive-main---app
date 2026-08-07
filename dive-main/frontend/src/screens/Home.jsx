import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Bell, Settings, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { ScoreRing, AnimatedNumber } from "../components/dive/Widgets";
import {
  diveScore, topExposure, totalInvested, apparentDiversification,
  realDiversification, segmentBreakdown, fmtINR, effectiveHoldings, CORE_CATEGORIES,
} from "../lib/diveEngine";
import { isCategoryExpected, contextSummaryMessage } from "../lib/contextMessaging";

export default function Home() {
  const { holdings, holdingsLoading, user, setScreen, sims, resetSims, scoreBreakdown, loadScoreBreakdown } = useDive();
  const simulating = sims.some((s) => s.amount > 0);

  useEffect(() => {
    if (!scoreBreakdown && holdings.length) loadScoreBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.length]);

  if (holdingsLoading) return null;
  if (!holdings.length) return <EmptyHome setScreen={setScreen} />;
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
    <div className="min-h-full dive-app-surface pb-24" data-testid="home-screen">
      <div className="px-6 pt-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">Welcome back</p>
          <h1 className="font-heading font-black text-2xl">Hi {user?.name?.split(" ")[0] || "there"} 👋</h1>
        </div>
        <div className="flex items-center gap-3 text-[var(--text-secondary)]">
          <button data-testid="home-search-btn" onClick={() => setScreen("ask")}><Search size={20} /></button>
          <button data-testid="home-notif-btn" onClick={() => setScreen("insights")}><Bell size={20} /></button>
          <button data-testid="home-settings-btn" onClick={() => setScreen("profile")}><Settings size={20} /></button>
        </div>
      </div>

      {simulating && (
        <div className="px-6 mt-4">
          <div className="flex items-center justify-between bg-[var(--dive-blue-light)] rounded-xl px-4 py-2.5" data-testid="home-sim-banner">
            <span className="text-xs font-bold text-[var(--dive-blue-dark)]">Estimated with your simulated changes</span>
            <button data-testid="home-reset-sims" onClick={resetSims} className="text-xs font-bold text-[var(--dive-blue-dark)] underline">Reset</button>
          </div>
        </div>
      )}

      <div className="px-6 mt-6">
        <motion.button data-testid="home-score-ring-btn" onClick={() => setScreen("scoreBreakdown")}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="w-full text-left bg-[var(--surface-card)] rounded-3xl p-6 shadow-sm border border-[var(--border)] flex flex-col items-center hover:shadow-md transition-shadow">
          <ScoreRing score={score} size={160} />
          <p className="text-xs font-bold text-[var(--dive-blue)] mt-3">See the full breakdown →</p>
          <div className="grid grid-cols-2 gap-3 w-full mt-6">
            <div className="rounded-2xl bg-[var(--red)]/10 border border-[var(--red)]/20 p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--red)]">Apparent div.</p>
              <AnimatedNumber value={app} format={(v) => `${Math.round(v)}%`} className="font-heading font-black text-2xl text-[var(--red)]" />
            </div>
            <div className="rounded-2xl bg-[var(--green)]/10 border border-[var(--green)]/20 p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--green)]">Real div.</p>
              <AnimatedNumber value={real} format={(v) => `${Math.round(v)}%`} className="font-heading font-black text-2xl text-[var(--green)]" />
            </div>
          </div>
          <div className="flex justify-between w-full mt-4 text-sm">
            <span className="text-[var(--text-secondary)]">Total invested</span>
            <span className="font-bold">{fmtINR(total)}</span>
          </div>
          <div className="flex justify-between w-full mt-1 text-sm">
            <span className="text-[var(--text-secondary)]">Segments</span>
            <span className="font-bold">{segs.length}</span>
          </div>
        </motion.button>
      </div>

      <div className="px-6 mt-8">
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

      <div className="px-6 mt-6">
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
  );
}

function EmptyHome({ setScreen }) {
  return (
    <div className="flex flex-col h-full px-7 items-center justify-center text-center dive-app-surface" data-testid="home-empty-state">
      <h1 className="font-heading font-black text-2xl mb-3">No investments yet</h1>
      <p className="text-[var(--text-secondary)] mb-8">Add your first holding and DIVVE will score your portfolio.</p>
      <button data-testid="home-empty-add-btn" onClick={() => setScreen("chooseMethod")}
        className="w-full gold-btn rounded-full py-4 font-bold hover:bg-[var(--dive-blue-hover)] transition-colors">
        Add investments
      </button>
    </div>
  );
}
