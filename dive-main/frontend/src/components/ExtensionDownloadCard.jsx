import React, { useState } from "react";
import { motion } from "framer-motion";
import { X, Download, ShieldCheck, Copy, Check } from "lucide-react";
import { API_BASE } from "../lib/api";

// Real production API base for early-bird users to paste into the
// extension's own "Advanced: API server" field (popup/popup.html) — the
// extension itself still defaults to http://localhost:8000/api (shared/
// config.js's DEFAULT_API_BASE), unchanged, since that's what local
// development of the extension needs. This card never bakes the live URL
// into the shipped zip — it's shown here purely as a copy-ready value.
const LIVE_API_URL = "https://www.divve.in/api";

const SITES = ["AngelOne", "Groww"];

const STEPS = [
  { title: "Unzip the download", body: "Extract the zip you downloaded below anywhere on your computer." },
  { title: "Enable Developer mode", body: <>Open <code className="text-[var(--dive-blue)]">chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</> },
  { title: "Load unpacked", body: <>Click <b>Load unpacked</b> and select the unzipped folder.</> },
  { title: "Log in", body: "Click the Divve Bot icon in your browser toolbar and log in with your Divve account — same email/mobile and password as this app." },
  { title: "Advanced: API server", body: "Open the extension popup's \"Advanced: API server\" section, paste the live URL below, then Save." },
];

// Same floating centered-modal pattern already established by Suggestions.jsx's
// WhatIfSheet/MarketStressSheet — triggered from both AppHeader.jsx (header
// button) and DiveShell.jsx (sidebar button), so its open/close state lives
// in DiveShell, their shared parent.
export default function ExtensionDownloadCard({ onClose }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(LIVE_API_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Clipboard permission can fail in some contexts — the URL is still
      // right there to select/copy by hand, so this isn't fatal.
    }
  };

  return (
    // z-50, not the page-content sheets' usual z-40 (WhatIfSheet, Home's own
    // GetStartedPopup, etc.) — this is opened from the header/sidebar chrome,
    // not from within a screen's own content, so it must always render on
    // top of any in-page sheet regardless of DOM paint order, rather than
    // competing at the same stacking level.
    <motion.div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="extension-download-card">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="font-heading font-black text-xl">Divve Bot, in your broker tab</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">A quick "does this fit your portfolio" check — right where you place the order.</p>
          </div>
          <button data-testid="extension-download-close-btn" onClick={onClose} className="shrink-0"><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>

        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
          Divve Bot watches the order screen on a supported broker site, and the moment you start typing a quantity or amount,
          it shows a real verdict — based on your actual Divve Score — on whether this trade helps or hurts your diversification.
          It only reads what's already on the page; nothing is typed or clicked on your behalf.
        </p>

        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Works on</p>
          <div className="flex gap-2">
            {SITES.map((s) => (
              <span key={s} className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" data-testid={`extension-site-${s.toLowerCase()}`}>
                {s}
              </span>
            ))}
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]">more coming soon</span>
          </div>
        </div>

        <div className="rounded-2xl p-4 bg-[var(--green)]/10 border border-[var(--green)]/25 flex items-start gap-2.5 mb-5">
          <ShieldCheck size={18} className="text-[var(--green)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            <b className="text-[var(--text-primary)]">Early testing version — for early birds only.</b> It's completely safe to
            install: Divve Bot only <b>reads</b> your order screen. It never places, modifies, or cancels a trade on your behalf.
          </p>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Steps to make it live</p>
        <div className="space-y-3 mb-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-3" data-testid={`extension-step-${i + 1}`}>
              <div className="w-6 h-6 rounded-full bg-[var(--dive-blue-light)] text-[var(--dive-blue)] text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</div>
              <div className="min-w-0">
                <p className="font-bold text-sm">{s.title}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-[var(--surface-card-hover)] border border-[var(--border)] p-3 flex items-center justify-between gap-3 mb-5">
          <code className="text-xs font-semibold text-[var(--text-primary)] truncate" data-testid="extension-live-api-url">{LIVE_API_URL}</code>
          <button data-testid="extension-copy-url-btn" onClick={copyUrl}
            className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-[var(--dive-blue)] px-2.5 py-1.5 rounded-lg hover:bg-[var(--dive-blue-light)] transition-colors">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <a href={`${API_BASE}/extension/download`} download data-testid="extension-download-btn"
          className="w-full gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors">
          <Download size={18} /> Download Extension
        </a>
      </motion.div>
    </motion.div>
  );
}
