import React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Share2, Link2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { ScoreRing } from "./Widgets";
import { scoreLabel } from "../../lib/diveEngine";
import { usePortalEnter } from "../../lib/usePortalEnter";

export default function ShareCard({ score, name, topPct, onClose }) {
  // See usePortalEnter.js — framer-motion's own initial/animate/exit
  // auto-trigger is unreliable for anything portaled to document.body,
  // this one included.
  const { entered, handleClose } = usePortalEnter(onClose);

  const link = `${process.env.REACT_APP_BACKEND_URL}/api/share/${score}?u=${encodeURIComponent(name || "me")}&top=${Math.round(topPct)}`;
  const caption = `My DIVVE Score is ${score}/100 (${scoreLabel(score)}). DIVVE looked through my whole portfolio and found ${Math.round(topPct)}% was secretly tied to one company 😳 Check your real diversification 👉`;

  const doShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "My DIVVE Score", text: caption, url: link });
      } else {
        await navigator.clipboard.writeText(`${caption} ${link}`);
        toast.success("Copied! Paste it anywhere to share.");
      }
    } catch (e) { /* user dismissed */ }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); toast.success("Link copied to clipboard"); }
    catch (e) { toast.error("Couldn't copy link"); }
  };

  // Portaled to document.body, outside Insights.jsx's own scrolling content
  // column — `position: fixed` alone doesn't escape a scrollable ancestor's
  // own internal scrolling for content still nested inside it (see
  // DiveShell.jsx's content-column comment for the fuller explanation).
  // `md:left-56` on both layers restates the sidebar exclusion the old
  // `relative`-ancestor scoping gave "for free" before this was portaled —
  // matching DiveShell's own `md:w-56` sidebar width. The sheet is nested
  // INSIDE the backdrop motion.div, not a sibling — `stopPropagation` on the
  // sheet keeps a click on it from bubbling up to the backdrop's own close.
  return createPortal(
    <motion.div className="fixed inset-0 md:left-56 bg-black/50 z-40" animate={{ opacity: entered ? 1 : 0 }} onClick={handleClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="fixed bottom-0 inset-x-0 md:left-56 z-50 bg-white rounded-t-3xl p-6"
        animate={{ opacity: entered ? 1 : 0, y: entered ? 0 : 24 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-testid="share-card-sheet">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-extrabold text-xl">Share your DIVVE Score</h2>
          <button data-testid="share-close-btn" onClick={handleClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>

        {/* The shareable card artifact — premium black + gold */}
        <div className="rounded-3xl p-6 relative overflow-hidden border border-[var(--dive-blue)]/30 gold-ring" style={{ background: "radial-gradient(120% 120% at 80% 0%, #1C1608 0%, #0B0B0C 55%)" }} data-testid="share-card-visual">
          <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-[var(--dive-blue)]/10 blur-2xl" />
          <div className="flex items-center gap-2 mb-4 relative">
            <span className="font-heading font-extrabold text-lg text-gold-gradient">DIVVE</span>
          </div>
          <div className="flex items-center gap-5 relative">
            <div className="bg-black/40 rounded-full p-1 border border-[var(--dive-blue)]/20">
              <ScoreRing score={score} size={120} stroke={12} showLabel={false} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">My DIVVE Score</p>
              <p className="font-heading font-extrabold text-4xl leading-none mt-1 text-white">{score}<span className="text-lg text-[var(--text-tertiary)]">/100</span></p>
              <div className="inline-flex items-center gap-1 mt-2 bg-[var(--dive-blue)]/15 border border-[var(--dive-blue)]/30 rounded-full px-2.5 py-1">
                <Trophy size={12} className="text-[var(--dive-blue)]" /><span className="text-xs font-bold text-[var(--dive-blue-dark)]">{scoreLabel(score)}</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-5 relative leading-relaxed">
            I found out <b className="text-white">{Math.round(topPct)}%</b> of my money was secretly tied to one company. What's your real diversification?
          </p>
          <p className="text-xs font-bold text-gold-gradient mt-4 relative">Divve deeper. Invest smarter.</p>
        </div>

        <div className="flex gap-3 mt-5">
          <button data-testid="share-btn" onClick={doShare}
            className="flex-1 gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]">
            <Share2 size={18} /> Share
          </button>
          <button data-testid="copy-link-btn" onClick={copyLink}
            className="flex-1 bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
            <Link2 size={18} /> Copy link
          </button>
        </div>
        <p className="text-xs text-[var(--text-tertiary)] text-center mt-3">Invite a friend to check their real diversification.</p>
      </motion.div>
    </motion.div>,
    document.body
  );
}
