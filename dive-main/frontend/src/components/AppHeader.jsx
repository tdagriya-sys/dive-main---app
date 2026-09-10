import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Search, Bell, User, LogOut, X, Download, LifeBuoy, Menu, LayoutGrid } from "lucide-react";
import { useDive } from "../context/DiveContext";

// Client-side only — this is a brand-new feature with nothing to persist yet
// (no backend model exists for it). Opening the panel marks everything read;
// state resets on reload, same lightweight non-persisted pattern this app
// already uses for sim/sheet UI state.
const DEFAULT_NOTIFICATIONS = [
  {
    id: "welcome",
    title: "Welcome to DIVVE 👋",
    body: "Add your first holding, or tell Divve Planner how much you have — either way, you'll have a real Divve Score in under a minute.",
    unread: true,
  },
];

// Persistent header shown on every authenticated screen (DiveShell.jsx) —
// logo (home), Your Journey (Insights.jsx — already titled "Your DIVVE
// Journey"), search (Ask Divve), notifications, and profile. Promotes what
// used to be three Home-only icons (home-search-btn/home-notif-btn/
// home-settings-btn) to somewhere reachable from any page, plus two
// genuinely new features (notifications, the richer profile dropdown).
export default function AppHeader({ onOpenExtension, onOpenSupport, onOpenMobileNav }) {
  const { user, setScreen, logout } = useDive();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false); // the mobile quick-actions popover
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const hasUnread = notifications.some((n) => n.unread);

  // The three header popovers (notifications, profile, quick actions) are
  // mutually exclusive — opening any one closes the other two.
  const openNotifications = () => {
    setProfileOpen(false);
    setQuickOpen(false);
    setNotifOpen(true);
    setNotifications((list) => list.map((n) => ({ ...n, unread: false })));
  };

  const openProfile = () => {
    setNotifOpen(false);
    setQuickOpen(false);
    setProfileOpen((v) => !v);
  };

  const openQuick = () => {
    setNotifOpen(false);
    setProfileOpen(false);
    setQuickOpen((v) => !v);
  };

  return (
    <header className="relative z-30 shrink-0 border-b border-[var(--border)] px-4 md:px-6" data-testid="app-header">
      <div className="h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 shrink-0">
          {/* Hamburger — mobile only, opens DiveShell's off-canvas nav drawer
              (the same links the desktop sidebar shows permanently). Takes no
              space at all at md:+, where the sidebar is already visible. */}
          <button data-testid="header-menu-btn" onClick={onOpenMobileNav}
            className="md:hidden w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
            <Menu size={20} />
          </button>
          {/* `shrink-0` + `whitespace-nowrap` — the wordmark must never
              compress or wrap ("Divv" / "e" on two lines); if the header
              can't fit everything, the right-hand icons give way (they
              already collapse into the quick-actions popover below md),
              not the logo. */}
          <button onClick={() => setScreen("home")} className="flex items-center gap-2 shrink-0" data-testid="app-header-logo-btn">
            <span className="font-heading font-black text-xl whitespace-nowrap">
              <span className="text-gold-gradient">Divv</span>
              <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          {/* Quick actions — mobile only. Six inline header icons plus the
              wordmark don't fit on a narrow phone, and the wordmark is what
              gave way (wrapping to "Divv" / "e"). This collapses the five
              utility icons (Get Extension, Your Journey, Search,
              Notifications, Support) behind one button — the way a launcher
              grid collapses a row of apps — leaving just this and Profile
              on mobile. At md:+ (sidebar visible, plenty of width) the five
              are inline again and this is hidden. */}
          <div className="relative md:hidden">
            <button data-testid="header-quick-actions-btn" onClick={openQuick} aria-label="Quick actions"
              className="relative w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
              <LayoutGrid size={19} />
              {hasUnread && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--red)]" data-testid="header-quick-actions-unread-dot" />}
            </button>
            {quickOpen && (
              <QuickActionsMenu
                hasUnread={hasUnread}
                onClose={() => setQuickOpen(false)}
                onExtension={() => { setQuickOpen(false); onOpenExtension?.(); }}
                onJourney={() => { setQuickOpen(false); setScreen("insights"); }}
                onSearch={() => { setQuickOpen(false); setScreen("ask"); }}
                onNotifications={() => { setQuickOpen(false); openNotifications(); }}
                onSupport={() => { setQuickOpen(false); onOpenSupport?.(); }}
              />
            )}
          </div>

          {/* The five utility icons — inline from md:+, collapsed into the
              quick-actions popover above below md. */}
          <button data-testid="header-extension-btn" onClick={onOpenExtension}
            className="hidden md:flex items-center gap-1.5 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 rounded-full hover:bg-[var(--surface-card-hover)] transition-colors">
            <Download size={16} className="text-[var(--dive-blue)] shrink-0" /> Get Extension
          </button>
          <button data-testid="header-journey-btn" onClick={() => setScreen("insights")}
            className="hidden md:flex items-center gap-1.5 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 rounded-full hover:bg-[var(--surface-card-hover)] transition-colors">
            <Trophy size={16} className="text-[var(--dive-blue)] shrink-0" /> Your Journey
          </button>
          <button data-testid="header-search-btn" onClick={() => setScreen("ask")}
            className="hidden md:flex w-9 h-9 rounded-full items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
            <Search size={19} />
          </button>
          <div className="relative hidden md:block">
            <button data-testid="header-notif-btn" onClick={openNotifications}
              className="relative w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
              <Bell size={19} />
              {hasUnread && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--red)]" data-testid="header-notif-unread-dot" />}
            </button>
          </div>
          <button data-testid="header-support-btn" onClick={onOpenSupport}
            className="hidden md:flex w-9 h-9 rounded-full items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
            <LifeBuoy size={19} />
          </button>
          {/* Profile — always visible, mobile and desktop alike. */}
          <div className="relative">
            <button data-testid="header-profile-btn" onClick={openProfile}
              className="w-9 h-9 rounded-full bg-[var(--dive-blue-light)] flex items-center justify-center text-[var(--dive-blue)] hover:opacity-80 transition-opacity">
              <User size={18} />
            </button>
            <AnimatePresence>
              {profileOpen && (
                <ProfileDropdown user={user} onClose={() => setProfileOpen(false)}
                  onViewProfile={() => { setProfileOpen(false); setScreen("profile"); }} onLogout={logout} />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>{notifOpen && <NotificationPanel notifications={notifications} onClose={() => setNotifOpen(false)} />}</AnimatePresence>
    </header>
  );
}

// Mobile-only popover collapsing the five utility icons into one list —
// same anchored-card + click-outside-catcher shape as ProfileDropdown
// below, just a menu instead of a data panel. The unread-notification dot
// rides on the trigger button (see header-quick-actions-unread-dot) so an
// unread notification is still glanceable without opening this.
//
// Plain conditional render, no transition at all — exactly what this app's
// landing-page mobile menu settled on, for the same reason. Framer-motion's
// mount/exit auto-triggers are unreliable in this environment (see
// usePortalEnter.js) — verified live here, the motion version froze at
// opacity ~0.71 mid-exit — and even a pure-CSS `animate-in` was observed
// still "running" long past its duration. A header dropdown that gets stuck
// half-faded is worse than one that just appears; instant is fine for a
// small menu.
function QuickActionsMenu({ hasUnread, onClose, onExtension, onJourney, onSearch, onNotifications, onSupport }) {
  const items = [
    { Icon: Download, label: "Get Extension", onClick: onExtension, testId: "quick-action-extension" },
    { Icon: Trophy, label: "Your Journey", onClick: onJourney, testId: "quick-action-journey" },
    { Icon: Search, label: "Search", onClick: onSearch, testId: "quick-action-search" },
    { Icon: Bell, label: "Notifications", onClick: onNotifications, testId: "quick-action-notifications", showDot: hasUnread },
    { Icon: LifeBuoy, label: "Support", onClick: onSupport, testId: "quick-action-support" },
  ];
  return (
    <>
      {/* Same top-16 offset as ProfileDropdown/NotificationPanel — the
          catcher starts below the header so it never swallows a tap meant
          for another header button. */}
      <div className="fixed top-16 inset-x-0 bottom-0 z-40" onClick={onClose} data-testid="quick-actions-backdrop" />
      <div
        className="absolute right-0 top-full mt-2 w-56 bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] shadow-xl p-2 z-50"
        data-testid="quick-actions-menu">
        {items.map(({ Icon, label, onClick, testId, showDot }) => (
          <button key={testId} data-testid={testId} onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-secondary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)] transition-colors">
            <span className="relative shrink-0">
              <Icon size={18} className="text-[var(--dive-blue)]" />
              {showDot && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--red)]" />}
            </span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function ProfileDropdown({ user, onClose, onViewProfile, onLogout }) {
  return (
    <>
      {/* Transparent click-outside catcher — no dark backdrop, this is a
          small anchored dropdown, not a full-screen modal. Starts BELOW the
          header (top-16, matching its h-16), not inset-0, so it never
          overlaps the header itself — otherwise it would sit on top of and
          swallow clicks meant for the other header buttons (e.g. switching
          straight from this to the notification bell). */}
      <div className="fixed top-16 inset-x-0 bottom-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -4 }}
        transition={{ duration: 0.15 }}
        className="absolute right-0 top-full mt-2 w-72 bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] shadow-xl p-4 z-50"
        data-testid="profile-dropdown">
        <button onClick={onViewProfile} className="block text-left w-full" data-testid="profile-dropdown-name-btn">
          <p className="font-heading font-black text-lg hover:text-[var(--dive-blue)] transition-colors">{user?.name}</p>
        </button>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--text-tertiary)]">Age</span>
            <span className="font-semibold">{user?.age}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--text-tertiary)]">Email</span>
            <span className="font-semibold truncate">{user?.email}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--text-tertiary)]">Mobile</span>
            <span className="font-semibold">{user?.mobile}</span>
          </div>
        </div>
        <button data-testid="profile-dropdown-logout-btn" onClick={onLogout}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2.5 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
          <LogOut size={16} /> Log out
        </button>
      </motion.div>
    </>
  );
}

function NotificationPanel({ notifications, onClose }) {
  return (
    <>
      {/* Same reasoning as ProfileDropdown's backdrop — starts below the
          header (top-16) so it doesn't swallow clicks meant for other
          header buttons while this panel is open. */}
      <div className="fixed top-16 inset-x-0 bottom-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}
        className="fixed top-16 left-[16%] right-[16%] bottom-[16%] z-50 bg-[var(--surface-card)] rounded-3xl border border-[var(--border)] shadow-2xl overflow-y-auto no-scrollbar"
        data-testid="notification-panel">
        <div className="sticky top-0 bg-[var(--surface-card)] flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
          <h2 className="font-heading font-black text-xl">Notifications</h2>
          <button data-testid="notification-panel-close-btn" onClick={onClose}><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <div className="p-6 space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className="bg-[var(--surface-card-hover)] rounded-2xl p-4" data-testid={`notification-item-${n.id}`}>
              <p className="font-bold text-sm">{n.title}</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{n.body}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
