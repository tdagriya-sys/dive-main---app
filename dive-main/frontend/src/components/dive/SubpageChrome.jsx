import React from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

// Shared header bits for the marketing site's secondary pages (Our Story,
// Contact Us, Terms, Privacy) — these aren't real routes (see LandingPage.jsx's
// `page` state), so every one of them needs its own way back to the main
// site, which this standardizes instead of four slightly-different copies.
export function BackLink({ onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid="subpage-back-btn"
      className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-10"
    >
      <ArrowLeft size={16} /> Back to Divve
    </button>
  );
}

export function SubpageHead({ eyebrow, title, lede, maxWidth = "max-w-3xl" }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className={maxWidth}>
      <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)] inline-flex items-center gap-1.5">
        <span className="text-[var(--text-tertiary)]">/</span>{eyebrow}
      </span>
      <h1 className="font-heading font-black text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight mt-4">{title}</h1>
      {lede && <p className="text-lg text-[var(--text-secondary)] mt-6 leading-relaxed">{lede}</p>}
    </motion.div>
  );
}
