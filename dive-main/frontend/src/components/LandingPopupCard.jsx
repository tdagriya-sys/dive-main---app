import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell } from "lucide-react";
import { api } from "../lib/api";
import { usePortalEnter } from "../lib/usePortalEnter";

// Which pop-ups this browser SESSION has already dismissed, as
// `${id}:${version}`. sessionStorage lives exactly as long as the tab/session
// — a reload keeps it (so a dismissed pop-up doesn't nag on every refresh),
// but a new tab or a new browser session starts empty, so the pop-up comes
// back. `version` (the pop-up's activation time — see backend
// landingPopupService.ts) means an edited-then-reactivated pop-up counts as
// new even within the same session.
const DISMISSED_KEY = "dive:landingPopupsDismissed";

function readDismissed() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDismissed(key) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), key]));
  } catch {
    // sessionStorage unavailable (private mode etc.) — it just may show again on reload
  }
}

/**
 * Pop-ups for LOGGED-OUT visitors on the public landing page — no login
 * needed, nothing per-user (see backend models/LandingPopup.ts). Fetches the
 * currently active ones from the public `GET /landing-popups`, shows one at a
 * time (oldest activated first), and remembers each dismissal for this
 * session only. `bodyHtml` is backend-rendered from staff-authored content
 * (same trust boundary as NotificationPopupCard.jsx).
 */
export default function LandingPopupCard() {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/landing-popups");
        if (cancelled) return;
        const dismissed = readDismissed();
        setQueue((data.popups || []).filter((p) => !dismissed.includes(`${p.id}:${p.version}`)));
      } catch {
        // best-effort — a failed fetch just means no pop-up this visit
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];

  function dismiss() {
    rememberDismissed(`${current.id}:${current.version}`);
    setQueue((q) => q.slice(1));
  }

  return (
    <AnimatePresence mode="wait">
      <LandingPopupCardInner key={current.id} popup={current} onDismiss={dismiss} />
    </AnimatePresence>
  );
}

function LandingPopupCardInner({ popup, onDismiss }) {
  // See lib/usePortalEnter.js — same reasoning as NotificationPopupCard.jsx.
  const { entered, handleClose } = usePortalEnter(onDismiss);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }}
      onClick={handleClose}
      data-testid="landing-popup-backdrop"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        data-testid="landing-popup-card"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-11 h-11 rounded-2xl bg-[var(--gold-b)]/15 flex items-center justify-center shrink-0">
            <Bell size={20} className="text-[var(--gold-c)]" />
          </div>
          <button data-testid="landing-popup-close-btn" onClick={handleClose} aria-label="Close">
            <X size={20} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <h2 className="font-heading font-black text-lg mb-2" data-testid="landing-popup-title">{popup.title}</h2>
        <div
          className="text-sm text-[var(--text-secondary)] leading-relaxed"
          data-testid="landing-popup-body"
          // Following a link inside the pop-up counts as dealing with it, so it
          // doesn't greet the visitor again on their way back this session. The
          // link's own navigation still proceeds — this only records the
          // dismissal and never calls preventDefault.
          onClick={(e) => {
            if (e.target.closest && e.target.closest("a")) onDismiss();
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: popup.bodyHtml }}
        />
        <button type="button" data-testid="landing-popup-dismiss-btn" onClick={handleClose} className="w-full mt-6 gold-btn rounded-full py-3 font-bold">
          Got it
        </button>
      </motion.div>
    </motion.div>,
    document.body
  );
}
