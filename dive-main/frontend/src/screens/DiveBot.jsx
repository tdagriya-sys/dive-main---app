import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Landmark, FileText, Building2, Coins, X, Sparkles } from "lucide-react";

// Each simulated OTHER app has its own distinct skin + a DIVE overlay verdict.
const APPS = [
  {
    id: "equity", name: "StockUp", tag: "Equity app", accent: "#00D09C", bg: "#FFFFFF", dark: false, Icon: TrendingUp,
    action: "Buy Reliance Industries", detail: "Qty 10 · ₹2,900 · ₹29,000",
    verdict: { tone: "danger", title: "Hold on — you're doubling down", reason: "You already hold 40% of your equity in this one company. Buying more would push your sector exposure from 40% to 52%.",
      a: "Proceed Anyway", b: "Show Me Alternatives" },
  },
  {
    id: "fd", name: "SafeBank", tag: "Banking / FD", accent: "#6D28D9", bg: "#FAFAFA", dark: false, Icon: Landmark,
    action: "Open a new Fixed Deposit", detail: "₹50,000 · 7.1% · 1 year",
    verdict: { tone: "warn", title: "You've got solid FD coverage", reason: "FDs are already at a healthy level for your profile. A debt mutual fund could give better post-tax returns for the same safety tier.",
      a: "Continue FD", b: "Explore Debt Funds" },
  },
  {
    id: "bonds", name: "BondBazaar", tag: "Bonds platform", accent: "#0F766E", bg: "#FFFFFF", dark: false, Icon: FileText,
    action: "Invest in Reliance Corp Bond", detail: "₹40,000 · 7.9% · AA",
    verdict: { tone: "danger", title: "Same company, different wrapper", reason: "This bond is from a company you already have 20%+ exposure to via equity and a mutual fund. It won't actually diversify you.",
      a: "Proceed Anyway", b: "See Other Issuers" },
  },
  {
    id: "reit", name: "PropShare", tag: "REIT / InvIT", accent: "#D97706", bg: "#FFFBEB", dark: false, Icon: Building2,
    action: "Invest in Embassy Office REIT", detail: "₹25,000 · 6.8% yield",
    verdict: { tone: "good", title: "Nice — a category you've never explored", reason: "You hold ₹0 in REIT/InvIT. Adding some here is exactly the kind of move that lifts your DIVVE Score and spreads real-estate risk.",
      a: "Great, Continue", b: "How much is ideal?" },
  },
  {
    id: "gold", name: "GoldVault", tag: "Digital gold", accent: "#EAB308", bg: "#18181B", dark: true, Icon: Coins,
    action: "Buy Digital Gold", detail: "₹20,000 · 24K",
    verdict: { tone: "warn", title: "Careful with the gold rush", reason: "You'd be at ~14% gold after this — above the 8–12% healthy band for your profile. Consider ₹8,000 instead to stay balanced.",
      a: "Buy ₹20,000", b: "Adjust to ₹8,000" },
  },
];

export default function DiveBot() {
  const [active, setActive] = useState(null);
  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="divebot-hub-screen">
      <div className="px-6 pt-8">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">The differentiator</p>
        <h1 className="font-heading font-black text-2xl mb-1">See DIVVE in Action</h1>
        <p className="text-sm text-[var(--text-secondary)]">Tap any app to watch DIVVE Bot step in — in real time, right where you invest.</p>
      </div>
      <div className="px-6 mt-6 grid grid-cols-2 gap-3">
        {APPS.map((app, i) => (
          <motion.button key={app.id} data-testid={`divebot-tile-${app.id}`} onClick={() => setActive(app)}
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
            className="rounded-2xl p-4 border border-[var(--border)] text-left hover:shadow-md transition-all"
            style={{ background: app.bg }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: app.accent + "22" }}>
              <app.Icon size={20} style={{ color: app.accent }} />
            </div>
            <p className="font-bold text-sm" style={{ color: app.dark ? "#fff" : "#09090B" }}>{app.name}</p>
            <p className="text-xs" style={{ color: app.dark ? "#A1A1AA" : "#71717A" }}>{app.tag}</p>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {active && <SimApp app={active} onClose={() => setActive(null)} />}
      </AnimatePresence>
    </div>
  );
}

function SimApp({ app, onClose }) {
  const [showBot, setShowBot] = useState(false);
  React.useEffect(() => { const t = setTimeout(() => setShowBot(true), 800); return () => clearTimeout(t); }, []);
  const toneStyle = {
    danger: { bg: "#FEE2E2", text: "#B91C1C" },
    warn: { bg: "#FEF3C7", text: "#92400E" },
    good: { bg: "#D1FAE5", text: "#047857" },
  }[app.verdict.tone];

  return (
    <motion.div className="absolute inset-0 z-50 flex flex-col" style={{ background: app.bg }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="divebot-simapp">
      {/* fake other-app header */}
      <div className="px-5 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <app.Icon size={20} style={{ color: app.accent }} />
          <span className="font-black text-lg" style={{ color: app.dark ? "#fff" : "#09090B" }}>{app.name}</span>
        </div>
        <button data-testid="simapp-close-btn" onClick={onClose}><X size={22} style={{ color: app.dark ? "#fff" : "#71717A" }} /></button>
      </div>

      <div className="flex-1 px-5">
        <div className="rounded-2xl p-5 mb-4" style={{ background: app.dark ? "#27272A" : "#F4F4F5" }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: app.accent }}>Order</p>
          <p className="font-black text-xl mb-1" style={{ color: app.dark ? "#fff" : "#09090B" }}>{app.action}</p>
          <p className="text-sm" style={{ color: app.dark ? "#A1A1AA" : "#71717A" }}>{app.detail}</p>
        </div>
        <button className="w-full rounded-xl py-4 font-black text-white" style={{ background: app.accent }}>
          {app.id === "equity" ? "BUY NOW" : "CONFIRM"}
        </button>
      </div>

      {/* DIVE overlay — always DIVE brand blue */}
      <AnimatePresence>
        {showBot && (
          <>
            <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className="absolute bottom-0 inset-x-0 bg-[var(--surface-card)] border-t border-[var(--border)] rounded-t-3xl p-6"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-testid="divebot-overlay">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl gold-btn flex items-center justify-center">
                  <Sparkles size={16} className="text-black" />
                </div>
                <span className="font-heading font-black text-[var(--dive-blue)]">DIVVE Bot</span>
                <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: toneStyle.bg, color: toneStyle.text }}>
                  {app.verdict.tone === "good" ? "APPROVES" : app.verdict.tone === "warn" ? "HEADS UP" : "WARNING"}
                </span>
              </div>
              <h3 className="font-heading font-black text-lg mb-2">{app.verdict.title}</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">{app.verdict.reason}</p>
              <div className="flex gap-3">
                <button data-testid="divebot-action-a" onClick={onClose}
                  className="flex-1 rounded-full py-3 font-bold border border-[var(--border)] text-[var(--text-secondary)]">{app.verdict.a}</button>
                <button data-testid="divebot-action-b" onClick={onClose}
                  className="flex-1 rounded-full py-3 font-bold gold-btn hover:bg-[var(--dive-blue-hover)] transition-colors">{app.verdict.b}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
