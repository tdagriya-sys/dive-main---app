import React from "react";
import { motion } from "framer-motion";
import { X, Crown } from "lucide-react";

const KEY_LABELS = { bot_scan: "Bot Scan AI extraction", doc_upload: "Doc Upload AI extraction", portfolio_edit: "portfolio edits" };

function formatResetsAt(resetsAt) {
  if (!resetsAt) return "soon";
  const d = new Date(resetsAt);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * The shared upgrade prompt (Phase 6a of docs/ADMIN_PANEL_PLAN.md §5.4/§7 —
 * "PLAN_LIMIT_REACHED handling in lib/api.js -> upgrade prompt"). Rendered
 * once from DiveShell.jsx, triggered by `planLimitInfo` (DiveContext),
 * itself set by lib/api.js's response interceptor the instant ANY request
 * hits a 403 PLAN_LIMIT_REACHED — same "one shared handler, not
 * per-feature paywall UI" reasoning as SupportCard/ExtensionDownloadCard
 * being owned by DiveShell rather than duplicated per trigger.
 */
export default function PlanLimitModal({ info, onClose, onUpgrade }) {
  const label = KEY_LABELS[info?.key] || "this feature";
  return (
    <motion.div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--surface-card)] rounded-3xl p-6"
        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="plan-limit-modal">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
            <Crown size={20} className="text-[var(--dive-blue)]" />
          </div>
          <button data-testid="plan-limit-close-btn" onClick={onClose} className="shrink-0"><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <h2 className="font-heading font-black text-xl mb-2">You've hit your plan's limit</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-5" data-testid="plan-limit-message">
          You've used up your {info?.window === "monthly" ? "monthly" : "weekly"} allowance for {label} on the Freemium plan.
          {info?.resetsAt ? ` It resets on ${formatResetsAt(info.resetsAt)}, or ` : " Or "}upgrade to Premium for a much higher limit.
        </p>
        <button data-testid="plan-limit-upgrade-btn" onClick={onUpgrade}
          className="w-full gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors">
          <Crown size={16} /> Upgrade to Premium
        </button>
      </motion.div>
    </motion.div>
  );
}
