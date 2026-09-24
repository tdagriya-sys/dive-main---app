import React, { useState, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";

const LEVEL_STYLE = {
  info: "bg-[var(--dive-blue)] text-white",
  warning: "bg-[var(--amber)] text-black",
  critical: "bg-[var(--red)] text-white",
};

/**
 * Announcement banner + maintenance-mode full-page gate (Phase 7 of
 * docs/ADMIN_PANEL_PLAN.md §4.6/§5.3/§7) — wraps the whole app (both the
 * logged-out marketing site and the logged-in product) at the top of the
 * tree, since either audience needs to see either state. Reads the same
 * public, no-auth `GET /api/app-settings` the backend's own maintenance-mode
 * gate is backed by (app.ts), so what this shows always matches what the
 * API would actually do with any other request right now.
 */
export default function AppSettingsGate({ children }) {
  const [settings, setSettings] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/app-settings")
      .then(({ data }) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        // Best-effort — if this fails, just show the app normally rather
        // than blocking on a settings-fetch hiccup.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (settings?.maintenance?.enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--wrapper-bg)] px-6 text-center" data-testid="maintenance-gate">
        <div>
          <AlertTriangle size={32} className="mx-auto mb-4 text-[var(--amber)]" />
          <h1 className="font-heading font-black text-xl mb-2">Divve is temporarily down</h1>
          <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
            {settings.maintenance.message || "We're doing some maintenance. Please check back shortly."}
          </p>
        </div>
      </div>
    );
  }

  const announcement = settings?.announcement;
  const showBanner = announcement?.enabled && announcement.text && !dismissed;

  return (
    <>
      {showBanner && (
        <div className={`flex items-center justify-center gap-3 text-xs font-bold py-2 px-4 ${LEVEL_STYLE[announcement.level] || LEVEL_STYLE.info}`} data-testid="announcement-banner">
          <span>{announcement.text}</span>
          {announcement.dismissible && (
            <button type="button" data-testid="announcement-dismiss-btn" onClick={() => setDismissed(true)} aria-label="Dismiss">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {children}
    </>
  );
}
