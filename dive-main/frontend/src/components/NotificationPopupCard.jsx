import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell } from "lucide-react";
import { api } from "../lib/api";
import { usePortalEnter } from "../lib/usePortalEnter";

// Same short-polling interval and reasoning as AppHeader.jsx's bell — see
// that file's own NOTIFICATIONS_POLL_MS comment.
const POPUPS_POLL_MS = 20000;

/**
 * The Home-screen popup-card delivery channel — the "popup" sibling to
 * in-app (bell) and email (see backend/src/models/NotificationCategory.ts::
 * NotificationChannel). An admin opts a specific notice into this channel
 * (e.g. the renewal-reminder settings' "Also show as a pop-up card"
 * checkbox); this component is what actually surfaces it, once, while the
 * user is on Home.
 *
 * Polls `GET /notifications/popups` (unread `channel: "popup"` rows, oldest
 * first) every POPUPS_POLL_MS — not just on mount — so a campaign sent
 * while the user is already on Home appears on its own, queued behind
 * whatever's currently showing (the oldest-first ordering means a
 * currently-displayed popup is never displaced by a newer poll result).
 * Shows exactly one at a time, and marks it read (`POST
 * /notifications/:id/read` — the SAME endpoint the bell uses) the moment
 * it's dismissed, which is what makes it "shown once" — a read popup row is
 * never returned by that endpoint again. `bodyHtml` is rendered via
 * `dangerouslySetInnerHTML`: it originates from the backend's own
 * `renderMarkdownToHtml` (admin-authored bold/highlight spans only, never a
 * passthrough of raw admin input) — the same trust boundary this app's
 * announcement banner already relies on.
 */
export default function NotificationPopupCard({ suppressed }) {
  const [queue, setQueue] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchPopups() {
      try {
        const { data } = await api.get("/notifications/popups");
        if (!cancelled) setQueue(data.popups || []);
      } catch {
        // best-effort — a failed fetch just means no popup shows this visit,
        // same posture as the bell's own fetch in AppHeader.jsx
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    fetchPopups();
    const intervalId = setInterval(fetchPopups, POPUPS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  if (!loaded || suppressed || queue.length === 0) return null;
  const current = queue[0];

  async function dismiss() {
    setQueue((q) => q.slice(1));
    try {
      await api.post(`/notifications/${current.id}/read`);
    } catch {
      // best-effort — worst case this exact notice reappears next visit,
      // same graceful-degradation posture as every other notification call
    }
  }

  return (
    <AnimatePresence mode="wait">
      <NotificationPopupCardInner key={current.id} notification={current} onDismiss={dismiss} />
    </AnimatePresence>
  );
}

function NotificationPopupCardInner({ notification, onDismiss }) {
  // See lib/usePortalEnter.js — framer-motion's own initial/animate/exit
  // auto-trigger is unreliable for anything portaled to document.body (see
  // Home.jsx's own GetStartedPopup for the same fix, same reasoning).
  const { entered, handleClose } = usePortalEnter(onDismiss);

  return createPortal(
    <motion.div
      className="fixed inset-0 md:left-56 z-40 bg-black/40 flex items-center justify-center p-4"
      animate={{ opacity: entered ? 1 : 0 }}
      onClick={handleClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0.94, y: entered ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        data-testid="notification-popup-card"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="w-11 h-11 rounded-2xl bg-[var(--gold-b)]/15 flex items-center justify-center shrink-0">
            <Bell size={20} className="text-[var(--gold-c)]" />
          </div>
          <button data-testid="notification-popup-close-btn" onClick={handleClose}>
            <X size={20} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <h2 className="font-heading font-black text-lg mb-2" data-testid="notification-popup-title">{notification.title}</h2>
        <div
          className="text-sm text-[var(--text-secondary)] leading-relaxed"
          data-testid="notification-popup-body"
          // Following a link/button inside the pop-up counts as dealing with it
          // (so it's marked read and doesn't come back). The link's own
          // navigation still proceeds — this never calls preventDefault.
          onClick={(e) => {
            if (e.target.closest && e.target.closest("a")) onDismiss();
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: notification.bodyHtml }}
        />
        <button
          type="button"
          data-testid="notification-popup-dismiss-btn"
          onClick={handleClose}
          className="w-full mt-6 gold-btn rounded-full py-3 font-bold"
        >
          Got it
        </button>
      </motion.div>
    </motion.div>,
    document.body
  );
}
