import React from "react";
import { motion } from "framer-motion";
import { TrendingUp, Search, Sparkles, ShieldAlert, Link2, PenLine, Bot, Upload, Compass, ChevronRight } from "lucide-react";
import { ScoreRing, Donut, RangeBar, AnimatedNumber } from "./Widgets";
import { SEGMENT_COLORS, fmtINR } from "../../lib/diveEngine";

// Every mock below is 100% static/illustrative — hardcoded sample numbers,
// no live data, no auth, no API calls. They exist purely to give the landing
// page's feature cards a real visual instead of a stock icon, reusing the
// exact same chart/ring components (Widgets.jsx) the real logged-in app
// renders, so the brand's visual language stays identical between "here's
// what it looks like" and "here's what you actually get."

// Shared phone-shaped inner "screen" so every mock reads as one consistent
// family of illustrations, even though each one's content is different.
export function MockScreen({ children, className = "" }) {
  return (
    <div className={`w-full max-w-[280px] mx-auto rounded-[2rem] border border-[var(--border)] bg-[var(--surface-card)] shadow-2xl shadow-black/40 overflow-hidden ${className}`}>
      <div className="h-6 flex items-center justify-center bg-[var(--surface-card-hover)]">
        <div className="w-16 h-1.5 rounded-full bg-[var(--border)]" />
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function ScoreMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4 text-center">Your DIVVE Score</p>
      <div className="flex justify-center">
        <ScoreRing score={71} size={150} stroke={12} />
      </div>
      <div className="mt-5 flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--dive-blue)]">
        <TrendingUp size={14} /> Up 6 points this month
      </div>
    </MockScreen>
  );
}

const XRAY_SEGS = [
  { name: "Equity", pct: 62, color: SEGMENT_COLORS.Equity },
  { name: "Mutual Funds", pct: 20, color: SEGMENT_COLORS["Mutual Funds"] },
  { name: "Gold/Silver", pct: 12, color: SEGMENT_COLORS["Gold/Silver"] },
  { name: "Bonds", pct: 6, color: SEGMENT_COLORS.Bonds },
];

export function XRayMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4 text-center">The X-Ray</p>
      <div className="flex justify-center">
        <Donut data={XRAY_SEGS} size={140} stroke={14}
          centerTop={<span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Real exposure</span>}
          centerBottom={<><span className="font-heading font-black text-xl text-[var(--red)] leading-none">41%</span><span className="text-[9px] text-[var(--text-secondary)] font-semibold">Reliance Industries</span></>} />
      </div>
      <div className="mt-4 flex items-start gap-1.5 bg-[var(--red)]/10 border border-[var(--red)]/20 rounded-lg px-2.5 py-2">
        <ShieldAlert size={13} className="text-[var(--red)] shrink-0 mt-0.5" />
        <p className="text-[10px] font-semibold text-[var(--red)] leading-relaxed">3 "different" holdings, same company underneath.</p>
      </div>
    </MockScreen>
  );
}

export function SuggestionsMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4 text-center">Suggestions</p>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold">Gold/Silver</span>
            <span className="text-[10px] font-bold text-[var(--dive-blue)]">+₹18,000</span>
          </div>
          <RangeBar currentPct={4} loPct={8} hiPct={12} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold">Bonds</span>
            <span className="text-[10px] font-bold text-[var(--dive-blue)]">+₹22,500</span>
          </div>
          <RangeBar currentPct={9} loPct={15} hiPct={25} />
        </div>
      </div>
    </MockScreen>
  );
}

const PLANNER_ROWS = [
  { cat: "Equity", amt: 20000, color: SEGMENT_COLORS.Equity },
  { cat: "Mutual Funds", amt: 15000, color: SEGMENT_COLORS["Mutual Funds"] },
  { cat: "Gold/Silver", amt: 8000, color: SEGMENT_COLORS["Gold/Silver"] },
  { cat: "Bonds", amt: 7000, color: SEGMENT_COLORS.Bonds },
];

export function PlannerMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1 text-center">Divve Planner</p>
      <p className="text-center font-heading font-black text-lg mb-4">₹50,000 lumpsum</p>
      <div className="space-y-2">
        {PLANNER_ROWS.map((r) => (
          <div key={r.cat} className="flex items-center justify-between bg-[var(--surface-card-hover)] rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
              <span className="text-xs font-semibold truncate">{r.cat}</span>
            </div>
            <span className="text-xs font-bold shrink-0">{fmtINR(r.amt)}</span>
          </div>
        ))}
      </div>
    </MockScreen>
  );
}

export function AskMock() {
  return (
    <MockScreen>
      <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-3 py-2.5 mb-4">
        <Search size={14} className="text-[var(--text-tertiary)] mr-2" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">HDFC Flexi Cap Fund</span>
      </div>
      <div className="bg-[var(--surface-card-hover)] rounded-xl p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Fit for you</p>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[var(--text-secondary)]">DIVVE Score</span>
          <span className="font-bold flex items-center gap-1 text-[var(--green)]"><TrendingUp size={12} /> 71 → 76 (+5)</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--text-secondary)]">Real diversification</span>
          <span className="font-bold">54% → 63%</span>
        </div>
      </div>
    </MockScreen>
  );
}

export function DiveBotMock() {
  return (
    <MockScreen className="relative">
      <div className="rounded-xl p-3.5 mb-3" style={{ background: "#F4F4F5" }}>
        <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "#3987E5" }}>Order · Other App</p>
        <p className="font-black text-sm text-[#09090B]">Buy Reliance Industries</p>
        <p className="text-[10px] text-[#71717A]">Qty 10 · ₹2,900 · ₹29,000</p>
      </div>
      <motion.div initial={{ y: 12, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
        className="bg-[var(--surface-card)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="w-5 h-5 rounded-md gold-btn flex items-center justify-center"><Sparkles size={11} className="text-black" /></div>
          <span className="font-heading font-black text-xs text-[var(--dive-blue)]">DIVVE Bot</span>
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#B91C1C]">WARNING</span>
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">You already hold 40% of your equity here — this pushes it to 52%.</p>
      </motion.div>
    </MockScreen>
  );
}

const METHODS = [
  { icon: Link2, label: "Connect accounts" },
  { icon: PenLine, label: "Add manually" },
  { icon: Bot, label: "Bot Scan" },
  { icon: Upload, label: "Upload a file" },
  { icon: Compass, label: "Divve Planner" },
];

export function AddMethodsMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4 text-center">5 ways in</p>
      <div className="space-y-2">
        {METHODS.map((m) => (
          <div key={m.label} className="flex items-center gap-2.5 bg-[var(--surface-card-hover)] rounded-xl px-3 py-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <m.icon size={13} className="text-[var(--dive-blue)]" />
            </div>
            <span className="text-xs font-semibold flex-1">{m.label}</span>
            <ChevronRight size={13} className="text-[var(--text-tertiary)]" />
          </div>
        ))}
      </div>
    </MockScreen>
  );
}

export function PreferencesMock() {
  return (
    <MockScreen>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4 text-center">Your rules</p>
      <div className="space-y-3">
        <div>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mb-1.5">Risk appetite</p>
          <div className="flex gap-1 bg-[var(--surface-card-hover)] rounded-full p-1">
            {["Conservative", "Balanced", "Aggressive"].map((r) => (
              <span key={r} className={`flex-1 text-center rounded-full py-1.5 text-[9px] font-bold ${r === "Balanced" ? "gold-btn" : "text-[var(--text-secondary)]"}`}>{r}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mb-1.5">Never suggest</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="px-2 py-1 rounded-full text-[9px] font-semibold bg-[#FEE2E2] border border-[var(--red)] text-[#B91C1C]">Crypto</span>
            <span className="px-2 py-1 rounded-full text-[9px] font-semibold bg-[var(--surface-card-hover)] border border-[var(--border)] text-[var(--text-secondary)]">Insurance</span>
          </div>
        </div>
      </div>
    </MockScreen>
  );
}

export const StatChip = ({ icon: Icon, value, format, label }) => (
  <div className="flex items-center gap-2.5">
    <div className="w-9 h-9 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
      <Icon size={16} className="text-[var(--dive-blue)]" />
    </div>
    <div>
      <AnimatedNumber value={value} format={format} className="font-heading font-black text-lg leading-none block" />
      <span className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-wide">{label}</span>
    </div>
  </div>
);
