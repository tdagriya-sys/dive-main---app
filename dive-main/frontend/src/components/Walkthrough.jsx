import React, { useEffect, useLayoutEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { useDive } from "../context/DiveContext";

// A real spotlight product tour, not another centered modal — dims the
// whole screen except the one real element being explained, with a tooltip
// card pointing at it. Two kinds of steps: most have a `target` (a real
// data-testid selector) and get the spotlight treatment; the welcome/closing
// steps have `target: null` and render as a plain centered card instead
// (same floating-modal chrome Suggestions.jsx's WhatIfSheet already uses),
// since there's nothing on the page to point at yet.
//
// Copy is deliberately as simple as explaining to a 5-year-old — one idea
// per step, short sentences, no jargon.
const FIXED_INTRO = [
  { id: "welcome", target: null, title: "Hi there! 👋", body: "I'm your quick tour of Divve. It takes about a minute — ready?" },
];

const CHROME_STEPS = [
  { id: "logo", target: '[data-testid="app-header-logo-btn"]', title: "The Divve logo", body: "This is the Divve logo. Tap it anytime to zoom back Home." },
  { id: "extension", target: '[data-testid="header-extension-btn"]', title: "Get Extension", body: "This downloads a little helper for your browser. It watches you shop for stocks and gives you a friendly heads-up if you're about to buy too much of one thing." },
  { id: "journey", target: '[data-testid="header-journey-btn"]', title: "Your Journey", body: "Tap here to see your badges, and how you're doing compared to others." },
  { id: "search", target: '[data-testid="header-search-btn"]', title: "Ask Divve", body: "This magnifying glass lets you ask Divve about any stock or fund — like asking a smart friend a question." },
  { id: "notifications", target: '[data-testid="header-notif-btn"]', title: "Notifications", body: "The bell shows your messages from Divve — like a little mailbox, just for you." },
  { id: "profile-icon", target: '[data-testid="header-profile-btn"]', title: "Your account", body: "Tap your little circle to see your name, your email, or log out." },
  { id: "xray", target: '[data-testid="sidebar-nav-xray"]', title: "X-Ray", body: "X-Ray peeks inside everything you own, to see what it's REALLY made of underneath." },
  { id: "suggest", target: '[data-testid="sidebar-nav-suggestions"]', title: "Suggest", body: "Suggest tells you exactly what to add next — in real rupees, not guesswork." },
  { id: "planner", target: '[data-testid="sidebar-nav-planner"]', title: "Divve Planner", body: "Planner helps you decide how to split new money, one easy step at a time." },
  { id: "profile-nav", target: '[data-testid="sidebar-nav-profile"]', title: "Profile", body: "Profile is where you tell Divve what kind of investor you are — safe, in-between, or bold. Divve uses this to make every suggestion just for you." },
];

// Adaptive — a brand-new user (near-certainly zero holdings, the case this
// tour auto-starts for) sees the empty-state's own CTA explained; replaying
// the tour later with real holdings shows the real dashboard content instead.
const ZERO_HOLDINGS_STEPS = [
  { id: "add-investments", target: '[data-testid="home-empty-add-btn"]', title: "Add investments", body: "Tap here to add your very first investment — it only takes about a minute!" },
];
const HAS_HOLDINGS_STEPS = [
  { id: "score-ring", target: '[data-testid="home-score-ring-card"]', title: "Your Divve Score", body: "This circle is your Divve Score — one number that shows how healthy your mix of investments is." },
  { id: "download-report", target: '[data-testid="home-download-report-btn"]', title: "Your report", body: "This downloads a little report card of your investments, as a PDF you can keep." },
];

const FIXED_OUTRO = [
  { id: "walkthrough-replay", target: '[data-testid="sidebar-walkthrough-btn"]', title: "Come back anytime", body: "Want this tour again someday? Just tap here!" },
  { id: "done", target: null, title: "All done! 🎉", body: "That's everything! You're ready to explore Divve. Have fun!" },
];

// An element that exists in the DOM but is CSS-hidden (e.g. the header's
// `hidden sm:flex` buttons on a narrow viewport) has offsetParent === null —
// a standard, reliable way to detect real display:none, unlike just
// checking querySelector found *something*.
function isReallyVisible(el) {
  return !!el && el.offsetParent !== null;
}

export default function Walkthrough({ onDone }) {
  const { holdings } = useDive();

  // Computed once, when the tour opens — not re-evaluated per step, so
  // Back/Next only ever walk through a fixed, valid list. Any step whose
  // target isn't actually on the page right now (wrong holdings state,
  // hidden at this viewport width) is dropped up front.
  const steps = useMemo(() => {
    const all = [
      ...FIXED_INTRO,
      ...CHROME_STEPS,
      ...(holdings.length ? HAS_HOLDINGS_STEPS : ZERO_HOLDINGS_STEPS),
      ...FIXED_OUTRO,
    ];
    return all.filter((s) => !s.target || isReallyVisible(document.querySelector(s.target)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  useLayoutEffect(() => {
    if (!step?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const measure = () => setTargetRect(el.getBoundingClientRect());

    // If the target is already comfortably in view (true for most steps —
    // Home's header/sidebar/dashboard chrome all fit in a normal viewport
    // without scrolling), position it in THIS SAME render, together with
    // the new step's content. That's what actually fixes the "content
    // changes here, then the card jumps there a moment later" jank this was
    // built to avoid: previously every step waited a flat 350ms before its
    // real position was known, even when no scrolling was ever needed. Only
    // a genuinely off-screen target (e.g. the report button near the page
    // bottom) still scrolls first — and even then, the tooltip/spotlight's
    // own CSS transition (see their transition-all classes below) turns that
    // repositioning into a smooth glide instead of a hard cut.
    const rect = el.getBoundingClientRect();
    const margin = 90; // room for the tooltip card itself, not just the bare element
    const fullyVisible = rect.top >= margin && rect.bottom <= window.innerHeight - margin;
    let timer;
    if (fullyVisible) {
      setTargetRect(rect);
    } else {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      timer = setTimeout(measure, 350);
    }

    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  // Nothing left to show (e.g. every step's target vanished from the page
  // mid-tour) — bail out gracefully rather than render an empty overlay.
  useEffect(() => {
    if (steps.length === 0) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (steps.length === 0) return null;

  const goNext = () => (isLast ? onDone() : setStepIndex((i) => i + 1));
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const TOOLTIP_WIDTH = 320;
  const tooltipStyle = (() => {
    if (!targetRect) return null; // centered card instead
    const margin = 14;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const fitsBelow = targetRect.bottom + margin + 160 < viewportH;
    const top = fitsBelow ? targetRect.bottom + margin : Math.max(margin, targetRect.top - margin - 160);
    const centerX = targetRect.left + targetRect.width / 2;
    const left = Math.min(Math.max(margin, centerX - TOOLTIP_WIDTH / 2), viewportW - TOOLTIP_WIDTH - margin);
    return { top, left, width: TOOLTIP_WIDTH };
  })();

  return (
    <div className="fixed inset-0 z-[60]" data-testid="walkthrough">
      {targetRect ? (
        <>
          {/* The spotlight itself: a transparent cutout at the target's real
              position, with a huge box-shadow that dims everything else —
              the standard CSS "spotlight" trick, no SVG masking needed. */}
          <div
            className="fixed rounded-2xl border-2 border-[var(--dive-blue)] pointer-events-none transition-all duration-300"
            style={{
              top: targetRect.top - 8, left: targetRect.left - 8,
              width: targetRect.width + 16, height: targetRect.height + 16,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.75)",
            }}
          />
          {/* This outer wrapper is NOT keyed by step — it persists across
              steps so changing its `top`/`left` (tooltipStyle, recomputed
              per step above) animates via the plain CSS transition below,
              gliding to the next target instead of teleporting. Only the
              INNER content is keyed by step.id, so just the text crossfades
              — position and content now change together, never one before
              the other, which is what caused the "content updates here,
              then the card jumps there" jank this replaces. */}
          <div className="fixed transition-all duration-300 ease-out" style={tooltipStyle}>
            <motion.div
              key={step.id}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}
              className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] shadow-2xl p-5"
              data-testid="walkthrough-tooltip">
              <StepBody step={step} stepIndex={stepIndex} total={steps.length} isFirst={isFirst} isLast={isLast}
                onBack={goBack} onNext={goNext} onSkip={onDone} />
            </motion.div>
          </div>
        </>
      ) : (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <motion.div
            key={step.id}
            initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="w-full max-w-sm bg-[var(--surface-card)] rounded-3xl border border-[var(--border)] shadow-2xl p-6"
            data-testid="walkthrough-tooltip">
            <StepBody step={step} stepIndex={stepIndex} total={steps.length} isFirst={isFirst} isLast={isLast}
              onBack={goBack} onNext={goNext} onSkip={onDone} centered />
          </motion.div>
        </div>
      )}
    </div>
  );
}

function StepBody({ step, stepIndex, total, isFirst, isLast, onBack, onNext, onSkip, centered }) {
  return (
    <>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--dive-blue)]" data-testid="walkthrough-step-counter">
          {stepIndex + 1} of {total}
        </p>
        <button data-testid="walkthrough-skip-btn" onClick={onSkip} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <X size={18} />
        </button>
      </div>
      <h3 className={`font-heading font-black text-lg mb-1.5 ${centered ? "text-center" : ""}`}>{step.title}</h3>
      <p className={`text-sm text-[var(--text-secondary)] leading-relaxed mb-4 ${centered ? "text-center" : ""}`}>{step.body}</p>
      <div className={`flex items-center gap-2 ${centered ? "flex-col" : "justify-between"}`}>
        {!centered && (
          <button data-testid="walkthrough-skip-link" onClick={onSkip} className="text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Skip tour
          </button>
        )}
        <div className={`flex items-center gap-2 ${centered ? "w-full" : ""}`}>
          {!isFirst && (
            <button data-testid="walkthrough-back-btn" onClick={onBack}
              className="flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-full border border-[var(--border)] hover:bg-[var(--surface-card-hover)] transition-colors">
              <ChevronLeft size={16} /> Back
            </button>
          )}
          <button data-testid="walkthrough-next-btn" onClick={onNext}
            className={`gold-btn rounded-full py-2 px-4 font-bold text-sm flex items-center justify-center gap-1 hover:bg-[var(--dive-blue-hover)] transition-colors ${centered ? "w-full" : ""}`}>
            {isLast ? "Done" : "Next"} {!isLast && <ChevronRight size={16} />}
          </button>
        </div>
        {centered && (
          <button data-testid="walkthrough-skip-link" onClick={onSkip} className="text-xs font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mt-1">
            Skip tour
          </button>
        )}
      </div>
    </>
  );
}
