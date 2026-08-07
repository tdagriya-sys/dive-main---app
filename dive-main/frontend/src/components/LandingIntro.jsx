import React, { useEffect, useRef } from "react";

/*
 * One-shot "Divve" wordmark reveal, shown full-screen before the landing
 * page's own content mounts (see App.js) — the site's front door, the same
 * way a product page opens on its logo before the page itself. Ported
 * near-verbatim from the provided divve_landing_animation.html: same SVG
 * geometry/timeline math, only the DOM plumbing changed (getElementById ->
 * refs scoped to this component's own container, so it can mount/unmount
 * freely inside React without touching anything else on the page, and the
 * rAF loop is cancelled on unmount instead of running forever).
 */

// Raw SVG markup, unchanged from the source file (kept as a string rather
// than JSX so every attribute — clip-path, stop-color, the exact path `d`
// data — stays byte-for-byte what the animation math below was tuned against).
const SVG_MARKUP = `
<svg id="stage" viewBox="0 0 900 460" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="#F7D68C"/>
      <stop offset="45%" stop-color="#E0A73E"/>
      <stop offset="100%" stop-color="#A9741C"/>
    </linearGradient>
    <radialGradient id="dotGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%"  stop-color="#FBE5A8"/>
      <stop offset="60%" stop-color="#E0A73E"/>
      <stop offset="100%" stop-color="#A9741C"/>
    </radialGradient>
    <linearGradient id="shimmerGrad" gradientUnits="userSpaceOnUse" x1="-100" y1="0" x2="-10" y2="0">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="40%"  stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="50%"  stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="60%"  stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <g id="dGroup">
    <path fill="url(#goldGrad)"
      d="M664 347Q664 240 619.5 161.5Q575 83 491.5 41.5Q408 0 294 0H77V697H294Q408 697 491.5 654.5Q575 612 619.5 533.0Q664 454 664 347ZM571 347Q571 477 499.5 550.0Q428 623 294 623H168V75H294Q429 75 500.0 146.5Q571 218 571 347Z"/>
  </g>
  <rect id="iStem" fill="url(#goldGrad)" rx="13"/>
  <circle id="trail2" fill="url(#dotGrad)" r="0"/>
  <circle id="trail1" fill="url(#dotGrad)" r="0"/>
  <circle id="dot"    fill="url(#dotGrad)" r="0"/>

  <g clip-path="url(#v1WipeClip)">
    <g id="v1Group"><path fill="url(#goldGrad)" d="M281 84 451 548H548L333 0H227L12 548H110Z"/></g>
  </g>
  <g clip-path="url(#v2WipeClip)">
    <g id="v2Group"><path fill="url(#goldGrad)" d="M281 84 451 548H548L333 0H227L12 548H110Z"/></g>
  </g>
  <g clip-path="url(#eWipeClip)">
    <g id="eGroup">
      <!-- Static tilt baked into the glyph's own local coordinate space (rotated
           BEFORE eGroup's dynamic scale/position matrix is applied each frame),
           so it rides along with the letter's slide/scale for free — no need to
           track a moving pivot point. Angle/pivot mirror Google's signature
           upward-tilted "e". -->
      <g transform="rotate(9 310 274)">
        <path fill="url(#goldGrad)"
          d="M574 240H136Q141 159 191.5 113.5Q242 68 314 68Q373 68 412.5 95.5Q452 123 468 169H566Q544 90 478.0 40.5Q412 -9 314 -9Q236 -9 174.5 26.0Q113 61 78.0 125.5Q43 190 43 275Q43 360 77.0 424.0Q111 488 172.5 522.5Q234 557 314 557Q392 557 452.0 523.0Q512 489 544.5 429.5Q577 370 577 295Q577 269 574 240ZM310 480Q241 480 192.5 436.0Q144 392 137 314H483Q483 366 460.0 403.5Q437 441 397.5 460.5Q358 480 310 480Z"/>
      </g>
    </g>
  </g>
  <clipPath id="v1WipeClip"><rect id="v1ClipRect" x="332.3912976887391" y="60" width="0" height="260"/></clipPath>
  <clipPath id="v2WipeClip"><rect id="v2ClipRect" x="491.0683049880091" y="60" width="0" height="260"/></clipPath>
  <clipPath id="eWipeClip"><rect  id="eClipRect"  x="658.5135604624616" y="60" width="0" height="260"/></clipPath>

  <clipPath id="wordClip">
    <path transform="matrix(0.27259684,0,0,-0.27259684,69.45633659,275.0000)"
      d="M664 347Q664 240 619.5 161.5Q575 83 491.5 41.5Q408 0 294 0H77V697H294Q408 697 491.5 654.5Q575 612 619.5 533.0Q664 454 664 347ZM571 347Q571 477 499.5 550.0Q428 623 294 623H168V75H294Q429 75 500.0 146.5Q571 218 571 347Z"/>
    <rect x="282.4606408" y="145" width="26" height="130" rx="13"/>
    <circle cx="295.4606408" cy="116" r="16"/>
    <path transform="matrix(0.28284672,0,0,-0.28284672,328.99713710,275.0000)" d="M281 84 451 548H548L333 0H227L12 548H110Z"/>
    <path transform="matrix(0.28284672,0,0,-0.28284672,487.67414440,275.0000)" d="M281 84 451 548H548L333 0H227L12 548H110Z"/>
    <g transform="matrix(0.28284672,0,0,-0.28284672,646.35115170,275.0000)">
      <g transform="rotate(9 310 274)">
        <path d="M574 240H136Q141 159 191.5 113.5Q242 68 314 68Q373 68 412.5 95.5Q452 123 468 169H566Q544 90 478.0 40.5Q412 -9 314 -9Q236 -9 174.5 26.0Q113 61 78.0 125.5Q43 190 43 275Q43 360 77.0 424.0Q111 488 172.5 522.5Q234 557 314 557Q392 557 452.0 523.0Q512 489 544.5 429.5Q577 370 577 295Q577 269 574 240ZM310 480Q241 480 192.5 436.0Q144 392 137 314H483Q483 366 460.0 403.5Q437 441 397.5 460.5Q358 480 310 480Z"/>
      </g>
    </g>
  </clipPath>
  <rect id="shimmerRect" x="60" y="60" width="790" height="260"
        fill="url(#shimmerGrad)" clip-path="url(#wordClip)" opacity="0"/>

  <text id="slogan" x="86.35318839" y="365" text-anchor="start"
        font-family="'Poppins', sans-serif" font-weight="400"
        font-size="59.62125795" fill="#D6D2C9"></text>
</svg>
`;

// Total wall-clock time (ms) from mount to the point the wordmark + slogan
// have fully settled (blinking cursor idle state) — see the TIMELINE build
// below for how each beat adds up to this. A little slack past the last
// beat lets the viewer register the finished tagline before it hands off.
const TOTAL_DURATION_MS = 7200;

function buildGeometry() {
  const BASELINE = 275;
  const dTransform = `matrix(0.27259684,0,0,-0.27259684,69.45633659,${BASELINE.toFixed(4)})`;
  const dCenter = { x: 170.45346715328475, y: 180 };

  const stem = { x: 282.4606407544325, y: 145, w: 26, h: 130, rx: 13 };
  const stemCx = stem.x + stem.w / 2;
  const stemBottom = stem.y + stem.h;

  const S_vve = 0.28284671532846717;
  const vveTransform = (e) => `matrix(${S_vve.toFixed(8)},0,0,${(-S_vve).toFixed(8)},${e.toFixed(6)},${BASELINE.toFixed(4)})`;

  return {
    pageW: 900, pageH: 460,
    dTransform, dCenter,
    stem, stemCx,
    v1: { transform: vveTransform(328.9971371047975), left: 332.3912976887391, right: 483.99713710479745 },
    v2: { transform: vveTransform(487.67414440406753), left: 491.0683049880091, right: 642.6741444040674 },
    e: { transform: vveTransform(646.3511517033376), left: 658.5135604624616, right: 809.5537064478631 },
    dotRadius: 16,
    rest: { x: stemCx, y: 116 },
    approach: { x: stemCx, y: stemBottom + 30 },
    mergeTo: { x: stemCx, y: 210 },
    orbit: { cx: dCenter.x, cy: dCenter.y, r: 150 },
    wordLeft: 90.44629355213698, wordRight: 809.5537064478631,
    diShiftInitial: 249.04653284671525,
  };
}

const SLOGAN_TEXT = "Diversify My Investment.";
const CHAR_DURATION = 55;

const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function angleOf(pt, orbit) {
  const dx = pt.x - orbit.cx, dy = pt.y - orbit.cy;
  return ((Math.atan2(-dy, dx) * 180 / Math.PI) + 360) % 360;
}
function circlePoint(thetaDeg, orbit) {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: orbit.cx + orbit.r * Math.cos(t), y: orbit.cy - orbit.r * Math.sin(t) };
}

function buildTimeline(g) {
  const thetaStart = angleOf(g.rest, g.orbit);
  let thetaEnd = angleOf(g.approach, g.orbit);
  if (thetaEnd < thetaStart) thetaEnd += 360;

  const liftoff = { start: 0, dur: 220, thetaStart, thetaEnd };
  const orbit = { start: 220, dur: 1300, thetaStart, thetaEnd };
  const approach = { start: 1520, dur: 220 };
  const merge = { start: 1740, dur: 380 };
  const pause = { start: 2120, dur: 200 };
  const spawn = { start: 2320, dur: 350 };
  const hold = { start: 2670, dur: 200 };

  const vveStagger = 120, vveDur = 420;
  const vveStart = hold.start + hold.dur;
  const v1 = { start: vveStart, dur: vveDur };
  const v2 = { start: vveStart + vveStagger, dur: vveDur };
  const e = { start: vveStart + vveStagger * 2, dur: vveDur };
  const vveEnd = e.start + e.dur;

  const diShift = { start: vveStart, dur: vveEnd - vveStart };

  const pause2 = { start: vveEnd, dur: 200 };
  const shimmer = { start: pause2.start + pause2.dur, dur: 1100 };
  const sloganStart = shimmer.start + 150;
  const sloganDur = SLOGAN_TEXT.length * CHAR_DURATION;
  const slogan = { start: sloganStart, dur: sloganDur };

  return { liftoff, orbit, approach, merge, pause, spawn, hold, v1, v2, e, diShift, pause2, shimmer, slogan };
}

function getDotState(t, g, T) {
  if (t <= T.liftoff.start + T.liftoff.dur) {
    const p = easeInOut((t - T.liftoff.start) / T.liftoff.dur);
    const end = circlePoint(T.liftoff.thetaStart, g.orbit);
    return { x: lerp(g.rest.x, end.x, p), y: lerp(g.rest.y, end.y, p), r: g.dotRadius, opacity: 1 };
  }
  if (t <= T.orbit.start + T.orbit.dur) {
    const p = (t - T.orbit.start) / T.orbit.dur;
    const theta = lerp(T.orbit.thetaStart, T.orbit.thetaEnd, p);
    const pt = circlePoint(theta, g.orbit);
    return { x: pt.x, y: pt.y, r: g.dotRadius, opacity: 1 };
  }
  if (t <= T.approach.start + T.approach.dur) {
    const p = easeInOut((t - T.approach.start) / T.approach.dur);
    const start = circlePoint(T.orbit.thetaEnd, g.orbit);
    return { x: lerp(start.x, g.approach.x, p), y: lerp(start.y, g.approach.y, p), r: g.dotRadius, opacity: 1 };
  }
  if (t <= T.merge.start + T.merge.dur) {
    const p = easeInOut((t - T.merge.start) / T.merge.dur);
    const y = lerp(g.approach.y, g.mergeTo.y, p);
    const r = lerp(g.dotRadius, 0, p * p);
    const opacity = lerp(1, 0, Math.max(0, (p - 0.3) / 0.7));
    return { x: g.approach.x, y, r, opacity };
  }
  if (t <= T.pause.start + T.pause.dur) {
    return { x: g.rest.x, y: g.rest.y, r: 0, opacity: 0 };
  }
  if (t <= T.spawn.start + T.spawn.dur) {
    const p = easeInOut((t - T.spawn.start) / T.spawn.dur);
    return { x: g.rest.x, y: g.rest.y, r: lerp(0, g.dotRadius, p), opacity: Math.min(1, p * 1.6) };
  }
  return { x: g.rest.x, y: g.rest.y, r: g.dotRadius, opacity: 1 };
}

export default function LandingIntro({ onFinished }) {
  const containerRef = useRef(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let cancelled = false;
    let rafId;

    const g = buildGeometry();
    const T = buildTimeline(g);

    const dGroup = root.querySelector("#dGroup");
    const iStem = root.querySelector("#iStem");
    const dot = root.querySelector("#dot");
    const trail1 = root.querySelector("#trail1");
    const trail2 = root.querySelector("#trail2");
    const v1Group = root.querySelector("#v1Group");
    const v2Group = root.querySelector("#v2Group");
    const eGroup = root.querySelector("#eGroup");
    const v1ClipRect = root.querySelector("#v1ClipRect");
    const v2ClipRect = root.querySelector("#v2ClipRect");
    const eClipRect = root.querySelector("#eClipRect");
    const shimmerRect = root.querySelector("#shimmerRect");
    const shimmerGrad = root.querySelector("#shimmerGrad");
    const sloganEl = root.querySelector("#slogan");

    iStem.setAttribute("y", g.stem.y);
    iStem.setAttribute("width", g.stem.w);
    iStem.setAttribute("height", g.stem.h);
    iStem.setAttribute("rx", g.stem.rx);

    const matrixRe = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^)]+)\)/;
    const dMatrixParts = g.dTransform.match(matrixRe).slice(1, 7).map(Number);
    const v1MatrixParts = g.v1.transform.match(matrixRe).slice(1, 7).map(Number);
    const v2MatrixParts = g.v2.transform.match(matrixRe).slice(1, 7).map(Number);
    const eMatrixParts = g.e.transform.match(matrixRe).slice(1, 7).map(Number);
    function setMatrix(el, parts, shiftX) {
      el.setAttribute(
        "transform",
        `matrix(${parts[0]},${parts[1]},${parts[2]},${parts[3]},${(parts[4] + shiftX).toFixed(4)},${parts[5]})`
      );
    }

    const chars = SLOGAN_TEXT.split("");
    const tspans = chars.map((ch) => {
      const ts = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      ts.textContent = ch === " " ? " " : ch;
      sloganEl.appendChild(ts);
      return ts;
    });

    function setCircle(el, x, y, r, opacity) {
      el.setAttribute("cx", x.toFixed(2));
      el.setAttribute("cy", y.toFixed(2));
      el.setAttribute("r", Math.max(0, r).toFixed(2));
      el.setAttribute("opacity", clamp01(opacity).toFixed(3));
    }

    function wipeLetter(clipRect, letter, phase, t, shiftX) {
      const p = easeOut((t - phase.start) / phase.dur);
      const w = lerp(0, letter.right - letter.left, clamp01(p));
      clipRect.setAttribute("x", (letter.left + shiftX).toFixed(2));
      clipRect.setAttribute("width", w.toFixed(2));
    }

    const history = [];
    let start;

    function frame(now) {
      if (cancelled) return;
      if (start === undefined) start = now;
      const t = now - start;

      let shiftX;
      if (t < T.diShift.start) {
        shiftX = g.diShiftInitial;
      } else if (t <= T.diShift.start + T.diShift.dur) {
        const p = easeInOut((t - T.diShift.start) / T.diShift.dur);
        shiftX = lerp(g.diShiftInitial, 0, p);
      } else {
        shiftX = 0;
      }
      setMatrix(dGroup, dMatrixParts, shiftX);
      setMatrix(v1Group, v1MatrixParts, shiftX);
      setMatrix(v2Group, v2MatrixParts, shiftX);
      setMatrix(eGroup, eMatrixParts, shiftX);
      iStem.setAttribute("x", (g.stem.x + shiftX).toFixed(3));

      const state = getDotState(t, g, T);
      state.x += shiftX;
      history.push(state);
      if (history.length > 5) history.shift();
      setCircle(dot, state.x, state.y, state.r, state.opacity);
      if (history.length >= 3) {
        const h = history[history.length - 3];
        setCircle(trail1, h.x, h.y, h.r * 0.6, h.opacity * 0.22);
      }
      if (history.length >= 5) {
        const h = history[history.length - 5];
        setCircle(trail2, h.x, h.y, h.r * 0.6, h.opacity * 0.12);
      }

      if (t >= T.v1.start) wipeLetter(v1ClipRect, g.v1, T.v1, t, shiftX);
      if (t >= T.v2.start) wipeLetter(v2ClipRect, g.v2, T.v2, t, shiftX);
      if (t >= T.e.start) wipeLetter(eClipRect, g.e, T.e, t, shiftX);

      if (t >= T.shimmer.start && t <= T.shimmer.start + T.shimmer.dur) {
        const p = (t - T.shimmer.start) / T.shimmer.dur;
        const bandCenter = lerp(g.wordLeft - 60, g.wordRight + 60, p);
        shimmerGrad.setAttribute("x1", (bandCenter - 45).toFixed(1));
        shimmerGrad.setAttribute("x2", (bandCenter + 45).toFixed(1));
        shimmerRect.setAttribute("opacity", "1");
      } else if (t > T.shimmer.start + T.shimmer.dur) {
        shimmerRect.setAttribute("opacity", "0");
      }

      if (t >= T.slogan.start) {
        const elapsed = t - T.slogan.start;
        const revealCount = Math.min(chars.length, Math.floor(elapsed / CHAR_DURATION) + 1);
        for (let i = 0; i < tspans.length; i++) {
          tspans[i].style.opacity = i < revealCount ? "1" : "0";
        }
        if (revealCount >= chars.length) {
          const last = tspans[tspans.length - 1];
          if (!last.classList.contains("divve-intro-cursor")) last.classList.add("divve-intro-cursor");
        }
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    const finishTimer = setTimeout(() => {
      if (!cancelled) onFinishedRef.current?.();
    }, TOTAL_DURATION_MS);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(finishTimer);
      // Only the tspans are elements this effect ADDS to the static SVG
      // markup (everything else is attributes set on nodes that already
      // exist) — remove them so a second effect run (React 18 StrictMode's
      // dev-mode double-invoke, or a remount) doesn't duplicate the slogan.
      tspans.forEach((ts) => ts.remove());
    };
  }, []);

  return (
    <div
      data-testid="landing-intro"
      onClick={() => onFinishedRef.current?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#0A0908",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <style>{`
        #divve-intro-stage tspan { opacity: 0; }
        .divve-intro-cursor { animation: divveIntroBlink 1.05s steps(1, end) infinite; }
        @keyframes divveIntroBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
      `}</style>
      <div
        ref={containerRef}
        style={{ width: "min(92vw, 1000px)", height: "auto" }}
        dangerouslySetInnerHTML={{ __html: SVG_MARKUP.replace('id="stage"', 'id="divve-intro-stage"') }}
      />
    </div>
  );
}
