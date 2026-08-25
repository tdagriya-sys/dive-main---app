import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, Lightbulb, Loader2 } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { Donut, Legend, QualityBadge } from "../components/dive/Widgets";
import { segmentBreakdown, companyExposure, topExposure, crossSegmentOverlaps, missingCategories, fmtINR, effectiveHoldings } from "../lib/diveEngine";
import { api } from "../lib/api";
import { HoldingsLoadingState, HoldingsLoadErrorState, HoldingsEmptyState } from "../components/dive/HoldingsGateStates";

// Bug report: the surface (segment-level) view always said "Looks nicely
// diversified" verbatim, even with 100% of the portfolio in one segment —
// the copy was a hardcoded string, never actually derived from the segment
// breakdown it sat right next to. This builds a real diagnosis instead:
// concentration (one segment dominating, or the only segment there is) takes
// priority since it's the most severe and most visible-at-a-glance issue;
// cross-segment issuer overlap (the same company showing up in, say, both
// Equity and Bonds — invisible at the segment level, exactly what "Look
// Deeper" exists to reveal) is always called out by name when present, even
// on top of an otherwise-fine segment spread; missing core categories are
// mentioned only when nothing more urgent is going on. Only genuinely
// well-spread, non-overlapping portfolios get the reassuring message.
function buildSurfaceInsight({ segs, overlaps, missing }) {
  const top = segs[0];
  if (!top) return { centerPct: null, centerLabel: null, centerTone: null, message: "" };

  const singleSegment = segs.length <= 1;
  const heavilyConcentrated = !singleSegment && top.pct >= 60;
  const someConcentration = !singleSegment && !heavilyConcentrated && top.pct >= 40;
  const concentrated = singleSegment || heavilyConcentrated || someConcentration;

  const sentences = [];
  if (singleSegment) {
    sentences.push(`${top.name} is 100% of your portfolio — there's nothing else here to soften a bad quarter for it.`);
  } else if (heavilyConcentrated) {
    sentences.push(`${top.pct.toFixed(0)}% of your money is in ${top.name} alone — that's carrying almost all your risk.`);
  } else if (someConcentration) {
    sentences.push(`Spread across ${segs.length} segments, but ${top.name} still makes up ${top.pct.toFixed(0)}% of it.`);
  }

  if (overlaps.length > 0) {
    const o = overlaps[0];
    // Deliberately NOT "they'll move together" — that's only true when the
    // same holding sits behind both segments (e.g. a stock held directly
    // and via a fund). This overlap can just as easily be an equity + a
    // bond of the same issuer, which do NOT move together (different
    // drivers: earnings/sentiment vs. coupon/rates) — what they share is a
    // single point of failure, not correlated day-to-day returns. Framed
    // around concentration/fault-risk instead, which holds true either way.
    sentences.push(`${o.name} shows up in both your ${o.segments.join(" and ")} — that's one company's fortunes riding on two of your holdings, not two separate bets.`);
  }

  if (!concentrated && overlaps.length === 0) {
    sentences.push(
      missing.length > 0
        ? `Nicely spread across ${segs.length} segments — though you're not in ${missing.slice(0, 2).join(" or ")} yet.`
        : `Nicely spread across ${segs.length} segments — no single one dominates. Tap to look deeper for hidden overlap.`
    );
  }

  return {
    centerPct: concentrated ? top.pct : null,
    centerLabel: concentrated ? top.name : null,
    centerToneClass: singleSegment || heavilyConcentrated ? "text-[var(--red)]" : someConcentration ? "text-[var(--amber)]" : "",
    message: sentences.join(" "),
  };
}

// The "True exposure" (deep/company-level) view had the mirror-image problem
// to buildSurfaceInsight above: the NUMBERS were always real (topExposure()
// computed live from actual look-through data), but the copy and color were
// a single fixed "gotcha" template painted red regardless of what that
// number actually was — a genuinely low 12% top-company exposure got the
// exact same alarmist framing as a real 70% concentration. Tiered the same
// way surface view is: only the tier that's actually warranted gets the red
// "you thought vs. you're actually" reveal; a real reassurance for a
// genuinely well-spread top holding, not the same alarm every time.
function buildDeepInsight({ segs, comps, top }) {
  if (!top || top.pct <= 0) {
    return { toneClass: "", message: "" };
  }
  const heavilyConcentrated = top.pct >= 50;
  const someConcentration = !heavilyConcentrated && top.pct >= 25;

  if (heavilyConcentrated) {
    return {
      toneClass: "text-[var(--red)]",
      message: `You thought you spread across ${segs.length} categories. You're actually ${top.pct.toFixed(0)}% exposed to ${top.name} alone.`,
    };
  }
  if (someConcentration) {
    return {
      toneClass: "text-[var(--amber)]",
      message: `${top.name} is your single largest real exposure at ${top.pct.toFixed(0)}% — not a crisis, but worth watching.`,
    };
  }
  return {
    toneClass: "",
    message: `Genuinely spread across ${comps.length} real companies — even ${top.name}, your largest single exposure, is only ${top.pct.toFixed(0)}%.`,
  };
}

export default function XRay() {
  const { holdings, holdingsLoading, holdingsError, loadHoldings, setScreen, sims, scoreBreakdown } = useDive();
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
  // from a crash.
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
  const overlaps = crossSegmentOverlaps(h);
  const missing = missingCategories(h);
  const surfaceInsight = buildSurfaceInsight({ segs, overlaps, missing });
  const deepInsight = buildDeepInsight({ segs, comps, top });
  // The deep donut/topExposure() above groups purely by literal holding name
  // (adaptHolding() gives every real holding a flat lookthrough of "100% to
  // itself" — see diveEngine.js) — it can never see a mutual fund's actual
  // disclosed top holdings, sector affinity, or industry affinity the way
  // the backend's real lookthroughService.ts (DIVE_SCORE_MODEL.md §7) can.
  // scoreBreakdown.connections is that same real, richer detection already
  // trusted for realDiversificationPct and rendered on Score Breakdown's "Why
  // real is below apparent" — surfaced here too so this screen's numbers
  // don't silently under-represent overlap the canonical score already
  // caught. Simulating (sims active) invalidates it — connections describe
  // the real SAVED portfolio, not a hypothetical one — so it's suppressed
  // rather than shown stale.
  const simulating = sims.some((s) => s.amount > 0);
  const realOverlaps = !simulating && scoreBreakdown?.hasHoldings ? scoreBreakdown.connections || [] : [];
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
                      <span className={`font-heading font-black text-2xl leading-none ${deepInsight.toneClass}`} data-testid="xray-deep-top-pct">
                        {top.pct.toFixed(0)}%
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)] font-semibold leading-tight line-clamp-2">{top.name}</span>
                    </>
                  : surfaceInsight.centerPct !== null
                  ? <>
                      <span className={`font-heading font-black text-2xl leading-none ${surfaceInsight.centerToneClass}`} data-testid="xray-surface-concentration-pct">
                        {surfaceInsight.centerPct.toFixed(0)}%
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)] font-semibold leading-tight line-clamp-2">{surfaceInsight.centerLabel}</span>
                    </>
                  : <span className="font-heading font-black text-lg leading-tight">Looks<br />diverse</span>} />
            </motion.div>
          </AnimatePresence>

          <p className="text-center text-sm text-[var(--text-secondary)] mt-4 mb-4 break-words" data-testid="xray-insight-message">
            {deep ? deepInsight.message : surfaceInsight.message}
          </p>
          <button data-testid="xray-look-deeper-btn" onClick={() => setDeep(!deep)}
            className={`w-full md:max-w-xs rounded-full py-3.5 font-bold flex items-center justify-center gap-2 transition-colors ${deep ? "bg-[var(--surface-card)] border border-[var(--border)]" : "gold-btn shadow-lg shadow-[var(--dive-blue)]/25 hover:bg-[var(--dive-blue-hover)]"}`}>
            {deep ? "Back to surface view" : "Look Deeper"} <ChevronDown size={18} className={deep ? "rotate-180" : ""} />
          </button>
        </div>
      </div>

      {/* Always visible regardless of surface/deep view — now that the user
          has seen their real exposure, the obvious next step is to act on it. */}
      <div className="px-6 mt-3">
        <button data-testid="xray-go-to-suggestions-btn" onClick={() => setScreen("suggestions")}
          className="w-full md:max-w-xs md:ml-auto rounded-full py-3.5 font-bold flex items-center justify-center gap-2 bg-[var(--dive-blue-light)] text-[var(--dive-blue-dark)] hover:brightness-105 transition-all">
          <Lightbulb size={18} /> See Suggestions For You
        </button>
      </div>

      {deep && realOverlaps.length > 0 && (
        <div className="px-6 mt-6">
          <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4" data-testid="xray-real-overlaps">
            <h3 className="font-bold text-sm mb-1">Hidden overlaps this donut can't show by name alone</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              Your Real Diversification score already accounts for these — holdings above that look independent by name but actually share exposure:
            </p>
            <div className="space-y-2">
              {realOverlaps.map((c, i) => (
                <div key={i} className="text-xs bg-[var(--surface-card-hover)] rounded-xl p-3" data-testid={`xray-overlap-${i}`}>
                  <span className="font-semibold">{c.reason}.</span>{" "}
                  <span className="text-[var(--text-tertiary)]">~{Math.round(c.strength * 100)}% shared exposure.</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
