import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Geometry + timeline for the animated Divve "Di" mark, ported verbatim from
 * logo/divve_loading_animation.html (the brand reference implementation) —
 * a dot orbits the D glyph's exact center, then breaks off to merge into the
 * i's stem, pauses, respawns, and repeats. All layout numbers stay in one
 * place so the mark can be resized without touching the animation math.
 */
const GEOMETRY = (() => {
  // D glyph (Poppins Regular "D"), font units -> SVG matrix.
  const glyph = { xMin: 77, yMin: 0, xMax: 664, yMax: 697 };
  const D_LEFT_X = 95, D_TOP_Y = 85, D_HEIGHT = 190;
  const s = D_HEIGHT / (glyph.yMax - glyph.yMin);
  const e = D_LEFT_X - glyph.xMin * s;
  const f = D_TOP_Y + glyph.yMax * s;
  const dWidth = (glyph.xMax - glyph.xMin) * s;
  const dCenter = { x: D_LEFT_X + dWidth / 2, y: D_TOP_Y + D_HEIGHT / 2 };

  // i stem — positioned close to D.
  const stem = { x: 287, y: 145, w: 26, h: 110, rx: 13 };
  const stemCx = stem.x + stem.w / 2;
  const stemBottom = stem.y + stem.h;

  return {
    dTransform: `matrix(${s.toFixed(6)},0,0,${(-s).toFixed(6)},${e.toFixed(4)},${f.toFixed(4)})`,
    stem,
    dotRadius: 16,
    rest: { x: stemCx, y: 116 }, // resting spot above the stem
    approach: { x: stemCx, y: stemBottom + 30 }, // staging point directly below the stem
    mergeTo: { x: stemCx, y: 200 }, // point inside the stem where the dot vanishes
    orbit: { cx: dCenter.x, cy: dCenter.y, r: 150 },
  };
})();

const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// Angle convention matches the orbit: x = cx + r*cos(theta), y = cy - r*sin(theta)
// (so increasing theta sweeps ANTICLOCKWISE on screen).
function angleOf(pt, center) {
  const dx = pt.x - center.cx, dy = pt.y - center.cy;
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return (deg + 360) % 360;
}
function circlePoint(thetaDeg, orbit) {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: orbit.cx + orbit.r * Math.cos(t), y: orbit.cy - orbit.r * Math.sin(t) };
}

// Story beats: lift-off -> orbit -> approach -> merge -> pause -> spawn -> hold
const TIMELINE = [
  { name: "liftoff", duration: 220 },
  { name: "orbit", duration: 1300 },
  { name: "approach", duration: 220 },
  { name: "merge", duration: 380 },
  { name: "pause", duration: 250 },
  { name: "spawn", duration: 350 },
  { name: "hold", duration: 450 },
];
const TOTAL_DURATION = TIMELINE.reduce((sum, p) => sum + p.duration, 0);

function getDotState(tMs) {
  const g = GEOMETRY;
  let t = tMs % TOTAL_DURATION;
  const thetaStart = angleOf(g.rest, g.orbit);
  let thetaEnd = angleOf(g.approach, g.orbit);
  if (thetaEnd < thetaStart) thetaEnd += 360;

  for (const phase of TIMELINE) {
    if (t > phase.duration) {
      t -= phase.duration;
      continue;
    }
    const p = easeInOut(t / phase.duration);

    switch (phase.name) {
      case "liftoff": {
        const start = g.rest, end = circlePoint(thetaStart, g.orbit);
        return { x: lerp(start.x, end.x, p), y: lerp(start.y, end.y, p), r: g.dotRadius, opacity: 1 };
      }
      case "orbit": {
        // linear progress here (not eased) so orbital speed stays constant
        const theta = lerp(thetaStart, thetaEnd, t / phase.duration);
        const pt = circlePoint(theta, g.orbit);
        return { x: pt.x, y: pt.y, r: g.dotRadius, opacity: 1 };
      }
      case "approach": {
        const start = circlePoint(thetaEnd, g.orbit), end = g.approach;
        return { x: lerp(start.x, end.x, p), y: lerp(start.y, end.y, p), r: g.dotRadius, opacity: 1 };
      }
      case "merge": {
        // pure vertical rise into the stem — x never moves here
        const y = lerp(g.approach.y, g.mergeTo.y, p);
        const r = lerp(g.dotRadius, 0, p * p);
        const opacity = lerp(1, 0, Math.max(0, (p - 0.3) / 0.7));
        return { x: g.approach.x, y, r, opacity };
      }
      case "pause":
        return { x: g.rest.x, y: g.rest.y, r: 0, opacity: 0 };
      case "spawn": {
        const r = lerp(0, g.dotRadius, p);
        const opacity = Math.min(1, p * 1.6);
        return { x: g.rest.x, y: g.rest.y, r, opacity };
      }
      case "hold":
        return { x: g.rest.x, y: g.rest.y, r: g.dotRadius, opacity: 1 };
      default:
        break;
    }
  }
  return { x: g.rest.x, y: g.rest.y, r: g.dotRadius, opacity: 1 }; // fallback
}

// The animated Divve "Di" brand mark — imperative rAF loop driving raw SVG
// attributes (cx/cy/r/opacity), scoped via refs (not document.getElementById)
// so multiple mounts never collide. Cleaned up via cancelAnimationFrame on
// unmount since this component mounts/unmounts every time a caller's
// loading state toggles.
function DivveMarkAnimated({ size = 200 }) {
  const dotRef = useRef(null);
  const trail1Ref = useRef(null);
  const trail2Ref = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const history = [];
    let start = null;

    function setDot(el, x, y, r, opacity) {
      if (!el) return;
      el.setAttribute("cx", x.toFixed(2));
      el.setAttribute("cy", y.toFixed(2));
      el.setAttribute("r", Math.max(0, r).toFixed(2));
      el.setAttribute("opacity", Math.max(0, Math.min(1, opacity)).toFixed(3));
    }

    function frame(now) {
      if (start === null) start = now;
      const tMs = now - start;
      const state = getDotState(tMs);

      history.push(state);
      if (history.length > 5) history.shift();

      setDot(dotRef.current, state.x, state.y, state.r, state.opacity);
      if (history.length >= 3) {
        const h1 = history[history.length - 3];
        setDot(trail1Ref.current, h1.x, h1.y, h1.r * 0.6, h1.opacity * 0.22);
      }
      if (history.length >= 5) {
        const h2 = history[history.length - 5];
        setDot(trail2Ref.current, h2.x, h2.y, h2.r * 0.6, h2.opacity * 0.12);
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <svg viewBox="0 0 380 380" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="divveLoaderGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F7D68C" />
          <stop offset="45%" stopColor="#E0A73E" />
          <stop offset="100%" stopColor="#A9741C" />
        </linearGradient>
        <radialGradient id="divveLoaderDotGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FBE5A8" />
          <stop offset="60%" stopColor="#E0A73E" />
          <stop offset="100%" stopColor="#A9741C" />
        </radialGradient>
      </defs>
      <g transform={GEOMETRY.dTransform}>
        <path
          fill="url(#divveLoaderGoldGrad)"
          d="M664 347Q664 240 619.5 161.5Q575 83 491.5 41.5Q408 0 294 0H77V697H294Q408 697 491.5 654.5Q575 612 619.5 533.0Q664 454 664 347ZM571 347Q571 477 499.5 550.0Q428 623 294 623H168V75H294Q429 75 500.0 146.5Q571 218 571 347Z"
        />
      </g>
      <rect
        fill="url(#divveLoaderGoldGrad)"
        x={GEOMETRY.stem.x}
        y={GEOMETRY.stem.y}
        width={GEOMETRY.stem.w}
        height={GEOMETRY.stem.h}
        rx={GEOMETRY.stem.rx}
      />
      <circle ref={trail2Ref} fill="url(#divveLoaderDotGrad)" r="0" />
      <circle ref={trail1Ref} fill="url(#divveLoaderDotGrad)" r="0" />
      <circle ref={dotRef} fill="url(#divveLoaderDotGrad)" r="0" />
    </svg>
  );
}

// Generic status lines for a document/screenshot scan pipeline — used
// whenever a caller doesn't pass its own. Purely cosmetic pacing to keep the
// wait engaging; not a live step-by-step feed from the backend (which
// doesn't expose one), so wording stays generic/plausible rather than
// claiming a specific real-time step.
const DEFAULT_MESSAGES = [
  "Scanning your document…",
  "Reading the numbers…",
  "Fetching investment details…",
  "Matching instruments to our database…",
  "Categorizing into asset classes…",
  "Almost there…",
];

/**
 * Full-height "AI is working" loader — the animated Divve mark with a
 * rotating line of status copy underneath. Used wherever the backend is
 * doing multi-second AI work (Bot Scan's analyze step, file/doc upload
 * parsing) so the wait reads as active progress instead of a frozen spinner.
 */
export default function ScanningLoader({ title, subtitle, messages = DEFAULT_MESSAGES, intervalMs = 3000, onCancel }) {
  const [idx, setIdx] = useState(0);
  // Callers typically pass `messages` as a fresh inline array literal, which
  // gets a new identity on every parent re-render. Depending on it directly
  // would reset (and effectively freeze) the cycle any time the parent
  // re-renders faster than intervalMs — read the current value via a ref
  // instead, and only ever set up the interval once, on mount.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % messagesRef.current.length), intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center" data-testid="scanning-loader">
      <div className="rounded-3xl mb-6 flex items-center justify-center p-4" style={{ background: "#0A0908" }}>
        <DivveMarkAnimated size={168} />
      </div>
      {title && <h2 className="font-heading font-black text-xl mb-2">{title}</h2>}
      {subtitle && <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-xs">{subtitle}</p>}
      <div className="h-5 relative w-full max-w-xs">
        {/* No mode="wait" — that gates the new line's mount on the old
            line's exit-transition finishing, so a stalled/dropped transition
            (e.g. a backgrounded tab, or a compositor that skips frames)
            would freeze the whole cycle on one message forever. Crossfading
            instead keeps the text itself always correct immediately on each
            interval tick; only the fade polish depends on transitions firing. */}
        <AnimatePresence>
          <motion.p
            key={idx}
            data-testid="scanning-loader-message"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
            className="text-xs font-bold text-[var(--dive-blue)] absolute inset-x-0"
          >
            {messages[idx]}
          </motion.p>
        </AnimatePresence>
      </div>
      {onCancel && (
        // A hung AI response otherwise has no escape short of waiting out the
        // full timeout chain (OpenAI/Anthropic SDK timeout x retries — up to
        // TWICE that if the OpenAI primary call fails and falls back to
        // Claude — plus Nginx's proxy_read_timeout and this request's own
        // axios timeout) — this is the only way to bail out immediately instead.
        <button data-testid="scanning-loader-cancel-btn" onClick={onCancel}
          className="mt-8 text-sm font-bold text-[var(--text-secondary)] underline">
          Cancel
        </button>
      )}
    </div>
  );
}
