import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, Lightbulb, Loader2 } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { Donut, Legend, QualityBadge } from "../components/dive/Widgets";
import { segmentBreakdown, companyExposure, topExposure, fmtINR, effectiveHoldings } from "../lib/diveEngine";
import { api } from "../lib/api";
import { HoldingsLoadingState, HoldingsLoadErrorState, HoldingsEmptyState } from "../components/dive/HoldingsGateStates";

export default function XRay() {
  const { holdings, holdingsLoading, holdingsError, loadHoldings, setScreen, sims } = useDive();
  const [deep, setDeep] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [openSegment, setOpenSegment] = useState(null);
  const [openHolding, setOpenHolding] = useState(null);
  // holdingId -> "loading" | "error" | {label, detail, tier}. Only ever
  // populated for real (non-simulated) Mutual Funds holdings — see
  // toggleHolding below. Fetched lazily per holding, not for the whole list,
  // so opening X-Ray never waits on a live AMFI lookup.
  const [liveQuality, setLiveQuality] = useState({});

  function toggleHolding(hold) {
    const next = openHolding === hold.id ? null : hold.id;
    setOpenHolding(next);
    if (next && hold.segment === "Mutual Funds" && !hold.simulated && !liveQuality[next]) {
      setLiveQuality((q) => ({ ...q, [next]: "loading" }));
      api.get(`/holdings/${next}/live-quality`)
        .then((r) => setLiveQuality((q) => ({ ...q, [next]: r.data.quality })))
        .catch(() => setLiveQuality((q) => ({ ...q, [next]: "error" })));
    }
  }

  // Same reasoning as Home.jsx: a bare `return null` here is indistinguishable
  // from a crash, including for a logged-out visitor exploring the demo
  // phone-frame (falls through to the genuinely-empty case below).
  if (holdingsLoading) return <HoldingsLoadingState testId="xray-loading-state" />;
  if (!holdings.length && holdingsError) {
    return <HoldingsLoadErrorState onRetry={loadHoldings} testId="xray-load-error-state" retryTestId="xray-load-error-retry-btn" />;
  }
  if (!holdings.length) {
    return (
      <HoldingsEmptyState setScreen={setScreen} testId="xray-empty-state" ctaTestId="xray-empty-add-btn"
        title="Nothing to X-Ray yet" body="Add your first holding and DIVVE will trace exactly where your money is really exposed." ctaLabel="Add investments" />
    );
  }
  const h = effectiveHoldings(holdings, sims);
  const segs = segmentBreakdown(h);
  const comps = companyExposure(h);
  const top = topExposure(h);
  const view = deep ? comps : segs;
  // Grouped for Drill Down: segment -> its own holdings, largest first. Keeps
  // the initial view to one card per segment (name, count, total) instead of
  // a flat list of every holding — a portfolio with 20+ stocks, several funds
  // and a dozen crypto coins would otherwise force a very long scroll just to
  // reach, say, the Bonds section.
  const bySegment = segs.map((seg) => ({
    ...seg,
    holdings: h.filter((x) => x.segment === seg.name).sort((a, b) => b.amount - a.amount),
  }));

  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="xray-screen">
      <div className="px-6 pt-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">The X-Ray</p>
          <h1 className="font-heading font-black text-2xl">Your Real Exposure</h1>
        </div>
        <button data-testid="xray-search-btn" onClick={() => setScreen("ask")} className="text-[var(--text-secondary)]"><Search size={20} /></button>
      </div>

      <div className="px-6 mt-6">
        <div className="bg-[var(--surface-card)] rounded-3xl p-6 border border-[var(--border)] shadow-sm flex flex-col items-center">
          <AnimatePresence mode="wait">
            <motion.div key={deep ? "deep" : "surface"} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.5 }}>
              <Donut data={view} size={200} stroke={18}
                centerTop={<span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{deep ? "True exposure" : "By segment"}</span>}
                centerBottom={deep
                  ? <>
                      <span className="font-heading font-black text-2xl text-[var(--red)] leading-none">{top.pct.toFixed(0)}%</span>
                      <span className="text-[11px] text-[var(--text-secondary)] font-semibold leading-tight line-clamp-2">{top.name}</span>
                    </>
                  : <span className="font-heading font-black text-lg leading-tight">Looks<br />diverse</span>} />
            </motion.div>
          </AnimatePresence>

          <p className="text-center text-sm text-[var(--text-secondary)] mt-4 mb-4 break-words">
            {deep ? `You thought you spread across ${segs.length} categories. You're actually ${top.pct.toFixed(0)}% in one company.`
              : "Looks nicely diversified across segments. But tap to look deeper…"}
          </p>
          <button data-testid="xray-look-deeper-btn" onClick={() => setDeep(!deep)}
            className={`w-full rounded-full py-3.5 font-bold flex items-center justify-center gap-2 transition-colors ${deep ? "bg-[var(--surface-card)] border border-[var(--border)]" : "gold-btn shadow-lg shadow-[var(--dive-blue)]/25 hover:bg-[var(--dive-blue-hover)]"}`}>
            {deep ? "Back to surface view" : "Look Deeper"} <ChevronDown size={18} className={deep ? "rotate-180" : ""} />
          </button>
        </div>
      </div>

      {/* Always visible regardless of surface/deep view — now that the user
          has seen their real exposure, the obvious next step is to act on it. */}
      <div className="px-6 mt-3">
        <button data-testid="xray-go-to-suggestions-btn" onClick={() => setScreen("suggestions")}
          className="w-full rounded-full py-3.5 font-bold flex items-center justify-center gap-2 bg-[var(--dive-blue-light)] text-[var(--dive-blue-dark)] hover:brightness-105 transition-all">
          <Lightbulb size={18} /> See Suggestions For You
        </button>
      </div>

      <div className="px-6 mt-6">
        <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          <button data-testid="exposure-legend-toggle" onClick={() => setCompanyOpen(!companyOpen)}
            className="w-full flex items-center justify-between p-5 text-left">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-lg">{deep ? "Real exposure by company" : "Exposure by segment"}</h2>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                {view.length} {deep ? (view.length === 1 ? "company" : "companies") : (view.length === 1 ? "segment" : "segments")} · tap to see the breakdown
              </p>
            </div>
            <ChevronDown size={18} className={`text-[var(--text-tertiary)] shrink-0 transition-transform ${companyOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {companyOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="px-5 pb-5 border-t border-[var(--border-light)] pt-4">
                  <Legend data={view} valueFn={(d) => `${d.pct.toFixed(0)}% · ${fmtINR(d.amount)}`} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="px-6 mt-6">
        <h2 className="font-heading font-bold text-lg mb-1">Drill down</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-3">Segment → Instrument → Underlying company → Rating</p>
        <div className="space-y-3">
          {bySegment.map((seg) => (
            <div key={seg.name} className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
              <button data-testid={`drill-segment-${seg.name}`} onClick={() => setOpenSegment(openSegment === seg.name ? null : seg.name)}
                className="w-full flex items-center justify-between p-4 text-left">
                <div className="min-w-0 flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{seg.name}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {seg.holdings.length} holding{seg.holdings.length === 1 ? "" : "s"} · {fmtINR(seg.amount)}
                    </p>
                  </div>
                </div>
                <ChevronDown size={18} className={`text-[var(--text-tertiary)] shrink-0 transition-transform ${openSegment === seg.name ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {openSegment === seg.name && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 border-t border-[var(--border-light)] pt-3 space-y-2">
                      {seg.holdings.map((hold) => (
                        <div key={hold.id} className="bg-[var(--surface-card-hover)] rounded-xl overflow-hidden">
                          <button data-testid={`drill-${hold.id}`} onClick={() => toggleHolding(hold)}
                            className="w-full flex items-center justify-between p-3 text-left">
                            <p className="font-bold text-sm truncate min-w-0">{hold.name}</p>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-bold">{fmtINR(hold.amount)}</span>
                              <ChevronDown size={14} className={`text-[var(--text-tertiary)] transition-transform ${openHolding === hold.id ? "rotate-180" : ""}`} />
                            </div>
                          </button>
                          <AnimatePresence>
                            {openHolding === hold.id && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="px-3 pb-3 border-t border-[var(--border-light)] pt-3">
                                  {(() => {
                                    const lq = liveQuality[hold.id];
                                    const isLoading = lq === "loading";
                                    const effective = lq && lq !== "loading" && lq !== "error" ? lq : hold.quality;
                                    return (
                                      <>
                                        <div className="flex items-center justify-between mb-3 gap-3">
                                          <span className="text-xs text-[var(--text-secondary)] shrink-0">Quality & risk</span>
                                          {isLoading
                                            ? <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]"><Loader2 size={12} className="animate-spin" /> Checking live AMFI data…</span>
                                            : <QualityBadge label={effective.label} tier={effective.tier} />}
                                        </div>
                                        {!isLoading && (
                                          <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed break-words">
                                            {effective.detail}
                                            {lq === "error" && " (Couldn't reach live AMFI data right now — showing what we know.)"}
                                          </p>
                                        )}
                                      </>
                                    );
                                  })()}
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Looks through to</p>
                                  <div className="space-y-1.5">
                                    {hold.lookthrough.map((lt) => (
                                      <div key={lt.company} className="flex items-center justify-between text-sm">
                                        <span className="text-[var(--text-secondary)]">{lt.company}</span>
                                        <span className="font-bold">{lt.pct}%</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
