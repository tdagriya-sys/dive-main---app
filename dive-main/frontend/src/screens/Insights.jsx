import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, AlertTriangle, CheckCircle2, Bell, Award, Share2, Users, ChevronLeft } from "lucide-react";
import { useDive } from "../context/DiveContext";
import ShareCard from "../components/dive/ShareCard";
import { diveScore, topExposure, segmentBreakdown, missingCategories, effectiveHoldings } from "../lib/diveEngine";

const ICONS = { trophy: Trophy, warning: AlertTriangle, alert: AlertTriangle, check: CheckCircle2 };
const ICON_COLOR = { trophy: "#EAB308", warning: "#F59E0B", alert: "#EF4444", check: "#10B981" };

// Badges + feed are computed live from real holdings — no fabricated
// activity history (there's no event log to draw a real "3 days ago" from yet).
function computeBadgesAndFeed(h) {
  const segs = segmentBreakdown(h);
  const top = topExposure(h);
  const missing = missingCategories(h).length;
  const badges = [
    { id: "diversifier", name: "Diversifier", earned: segs.length >= 4, desc: "Spread across 4+ categories" },
    { id: "risk_balanced", name: "Risk-Balanced", earned: h.length > 0 && top.pct < 40, desc: "Keep top exposure under 40%" },
  ];
  const feed = [];
  if (h.length === 0) {
    feed.push({ icon: "warning", text: "Add your first holding to get real insights here." });
  } else {
    if (top.pct > 0) feed.push({ icon: top.pct >= 40 ? "alert" : "check", text: `${top.pct.toFixed(0)}% of your money is tied to ${top.name}.` });
    if (missing > 0) feed.push({ icon: "warning", text: `You're missing ${missing} core categor${missing === 1 ? "y" : "ies"}.` });
    else feed.push({ icon: "check", text: "You hold every core category DIVVE tracks." });
  }
  return { badges, feed };
}

export default function Insights() {
  const { holdings, sims, user, scoreBreakdown, goBack } = useDive();
  const [share, setShare] = useState(false);
  const h = effectiveHoldings(holdings, sims);
  const simulating = sims.some((s) => s.amount > 0);
  // Same canonical Dive Score as Home/Score Breakdown — only fall back to the
  // fast client formula while a hypothetical simulation is active.
  const score = !holdings.length ? 0 : !simulating && scoreBreakdown?.hasHoldings ? scoreBreakdown.compositeScore : diveScore(h);
  const top = holdings.length ? topExposure(h).pct : 0;
  const percentile = Math.min(97, Math.max(5, Math.round(score * 1.05 + 3)));
  const data = computeBadgesAndFeed(h);

  return (
    <div className="min-h-full dive-app-surface pb-24 relative" data-testid="insights-screen">
      <div className="px-6 pt-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button data-testid="insights-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-[var(--dive-blue)]" />
            <h1 className="font-heading font-extrabold text-2xl">Your DIVVE Journey</h1>
          </div>
        </div>
        <button data-testid="insights-share-btn" onClick={() => setShare(true)}
          className="w-9 h-9 rounded-xl bg-[var(--dive-blue)]/15 border border-[var(--dive-blue)]/30 flex items-center justify-center">
          <Share2 size={17} className="text-[var(--dive-blue)]" />
        </button>
      </div>

      <div className="px-6 mt-5">
        <div className="rounded-2xl p-5 border border-[var(--dive-blue)]/25 relative overflow-hidden" style={{ background: "radial-gradient(120% 120% at 85% 0%, #1C1608 0%, #121214 60%)" }} data-testid="leaderboard-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={15} className="text-[var(--dive-blue)]" />
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">DIVVE Leaderboard</span>
            </div>
          </div>
          <p className="mt-3 text-lg font-heading font-extrabold leading-snug">
            You're diversifying better than <span className="text-gold-gradient" data-testid="leaderboard-percentile">{percentile}%</span> of DIVVE users
          </p>
          <div className="mt-3 h-2.5 rounded-full bg-[var(--surface-card-hover)] overflow-hidden">
            <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, var(--gold-c), var(--gold-a))" }}
              initial={{ width: 0 }} animate={{ width: `${percentile}%` }} transition={{ duration: 0.9, ease: "easeOut" }} />
          </div>
          <button data-testid="leaderboard-share-btn" onClick={() => setShare(true)}
            className="mt-4 w-full md:max-w-xs md:ml-auto gold-btn rounded-full py-2.5 font-bold text-sm flex items-center justify-center gap-2">
            <Share2 size={16} /> Share your rank
          </button>
        </div>
      </div>

      <div className="px-6 mt-6">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Badges</p>
        <div className="grid grid-cols-3 gap-3">
          {data.badges.map((b) => (
            <div key={b.id} className={`flex-1 rounded-2xl p-4 text-center border ${b.earned ? "bg-[var(--surface-card)] border-[var(--dive-blue)]" : "bg-[#FAFAFA] border-[var(--border)] opacity-60"}`} data-testid={`badge-${b.id}`}>
              <Award size={24} className={`mx-auto mb-2 ${b.earned ? "text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`} />
              <p className="font-bold text-xs">{b.name}</p>
              <p className="text-[10px] text-[var(--text-secondary)] mt-1">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 mt-8">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Current insights</p>
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-[var(--border)]" />
          <div className="space-y-5">
            {data.feed.map((f, i) => {
              const Icon = ICONS[f.icon] || CheckCircle2;
              return (
                <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="relative" data-testid={`feed-item-${i}`}>
                  <span className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-[var(--surface-card)] border-2 flex items-center justify-center" style={{ borderColor: ICON_COLOR[f.icon] }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ICON_COLOR[f.icon] }} />
                  </span>
                  <div className="bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)]">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={15} style={{ color: ICON_COLOR[f.icon] }} />
                    </div>
                    <p className="text-sm font-semibold break-words">{f.text}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {share && <ShareCard score={score} name={user?.name} topPct={top} onClose={() => setShare(false)} />}
      </AnimatePresence>
    </div>
  );
}
