import React from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { scoreColor, scoreLabel } from "../../lib/diveEngine";

// Animated number that counts up/down
export function AnimatedNumber({ value, format = (v) => Math.round(v), className, ...props }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = React.useState(value);
  React.useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.9, ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return controls.stop;
  }, [value]);
  return <span className={className} {...props}>{format(display)}</span>;
}

// SVG progress ring for the DIVE Score
export function ScoreRing({ score, size = 200, stroke = 16, showLabel = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useMotionValue(0);
  const dash = useTransform(progress, (p) => `${(p / 100) * c} ${c}`);
  const color = scoreColor(score);
  React.useEffect(() => {
    const controls = animate(progress, score, { duration: 1.4, ease: "easeOut" });
    return controls.stop;
  }, [score]);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} data-testid="dive-score-ring">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E4E4E7" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round" style={{ strokeDasharray: dash }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber value={score} className="font-heading font-black tabular-nums leading-none"
          style={{ fontSize: size * 0.28, color }} data-testid="dive-score-value" />
        {showLabel && (
          <>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mt-1">DIVVE Score</span>
            <span className="text-xs font-bold mt-0.5" style={{ color }}>{scoreLabel(score)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Donut chart from a list of {name, pct, color}. Thin ring by design (not the
// old thick band) — a slim stroke leaves a wide center hole so the label
// there has real room, and a small rounded gap between slices (dataviz
// skill's "2px surface gap between fills") keeps them visually distinct
// instead of bleeding into one wash of color at a glance.
export function Donut({ data, size = 220, stroke = 16, centerTop, centerBottom }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = Math.min(3, c / Math.max(1, data.length) / 4); // never eat more than a quarter of the smallest slice
  const innerHole = size - stroke * 2;
  let offset = 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#232327" strokeWidth={stroke} />
        {data.map((d, i) => {
          const len = (d.pct / 100) * c;
          const visibleLen = Math.max(0, len - gap);
          const el = (
            <motion.circle
              key={d.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color}
              strokeWidth={stroke} strokeLinecap="round"
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${visibleLen} ${c}` }}
              transition={{ duration: 0.8, delay: i * 0.08, ease: "easeOut" }}
              style={{ strokeDashoffset: -offset }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {(centerTop || centerBottom) && (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Width tied to the actual hole diameter (not a fixed padding) —
              guarantees the label wraps/truncates within the hole no matter
              what stroke thickness a caller picks, instead of visually
              bleeding onto the ring. */}
          <div className="flex flex-col items-center justify-center text-center gap-0.5" style={{ width: innerHole * 0.82 }}>
            {centerTop}
            {centerBottom}
          </div>
        </div>
      )}
    </div>
  );
}

// Legend row list
export function Legend({ data, valueFn }) {
  return (
    <div className="space-y-2 w-full">
      {data.map((d) => (
        <div key={d.name} className="flex items-center justify-between text-sm" data-testid={`legend-${d.name}`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="truncate text-[var(--text-secondary)] font-medium">{d.name}</span>
          </div>
          <span className="font-bold tabular-nums shrink-0 ml-2">{valueFn ? valueFn(d) : `${d.pct.toFixed(0)}%`}</span>
        </div>
      ))}
    </div>
  );
}

// Before/after mini bar for suggestions (current vs ideal band)
export function RangeBar({ currentPct, loPct, hiPct }) {
  const max = Math.max(currentPct, hiPct, 30) * 1.15;
  return (
    <div className="relative h-8 w-full rounded-full bg-[#F4F4F5] overflow-hidden">
      <div className="absolute top-0 bottom-0 bg-[var(--dive-blue)]/25"
        style={{ left: `${(loPct / max) * 100}%`, width: `${((hiPct - loPct) / max) * 100}%` }} />
      <motion.div className="absolute top-0 bottom-0 left-0 rounded-full bg-[var(--dive-blue)]/80"
        initial={{ width: 0 }} animate={{ width: `${(currentPct / max) * 100}%` }}
        transition={{ duration: 0.7 }} />
      <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px] font-bold">
        <span className="text-[#1A1400]">Now {currentPct.toFixed(0)}%</span>
        <span className="text-[var(--dive-blue-dark)]">Ideal {loPct}–{hiPct}%</span>
      </div>
    </div>
  );
}

// Renders a holding's per-asset-class quality/risk signal (see backend/src/
// services/holdingQualityService.ts) — "good"/"neutral"/"caution" color the
// badge, "unknown" (data genuinely not available) reads as neutral gray
// rather than implying a judgment we can't actually back up.
export function QualityBadge({ label, tier }) {
  const map = {
    good: "bg-[#D1FAE5] text-[#047857]",
    neutral: "bg-[var(--dive-blue-light)] text-[var(--dive-blue-dark)]",
    caution: "bg-[#FEF3C7] text-[#B45309]",
    unknown: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
  };
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap ${map[tier] || map.unknown}`}>{label}</span>;
}
