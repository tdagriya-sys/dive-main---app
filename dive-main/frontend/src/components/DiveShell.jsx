import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, ScanLine, Lightbulb, Compass, User, LogOut, Download, HelpCircle } from "lucide-react";
import { useDive } from "../context/DiveContext";
import AppHeader from "./AppHeader";
import ExtensionDownloadCard from "./ExtensionDownloadCard";
import Walkthrough from "./Walkthrough";
import Onboarding from "../screens/Onboarding";
import Home from "../screens/Home";
import XRay from "../screens/XRay";
import Suggestions from "../screens/Suggestions";
import ScoreBreakdown from "../screens/ScoreBreakdown";
import Preferences from "../screens/Preferences";
import AskDive from "../screens/AskDive";
import DiveBot from "../screens/DiveBot";
import Planner from "../screens/Planner";
import Insights from "../screens/Insights";
import ChooseFetchMethod from "../screens/ChooseFetchMethod";
import ManualEntry from "../screens/ManualEntry";
import FileUpload from "../screens/FileUpload";
import BotScan from "../screens/BotScan";
import AAConsent from "../screens/AAConsent";
import MyHoldings from "../screens/MyHoldings";

// Screens rendered via the <Onboarding/> switch (no bottom nav).
const ONBOARDING = ["splash", "signup", "login", "forgotPassword", "reveal"];
// Full-screen flows that also hide the bottom nav but render from SCREENS below.
const NO_NAV_EXTRA = ["chooseMethod", "manualEntry", "fileUpload", "botScan", "aaConsent"];
const NAV = [
  { id: "home", label: "Home", Icon: HomeIcon },
  { id: "xray", label: "X-Ray", Icon: ScanLine },
  { id: "suggestions", label: "Suggest", Icon: Lightbulb },
  { id: "planner", label: "Divve Planner", Icon: Compass },
  { id: "profile", label: "Profile", Icon: User },
];

const SCREENS = {
  home: Home, xray: XRay, suggestions: Suggestions, divebot: DiveBot, planner: Planner,
  profile: Preferences, ask: AskDive, insights: Insights, myHoldings: MyHoldings,
  scoreBreakdown: ScoreBreakdown,
  chooseMethod: ChooseFetchMethod, manualEntry: ManualEntry, fileUpload: FileUpload, botScan: BotScan, aaConsent: AAConsent,
};

export default function DiveShell() {
  const { screen, setScreen, authLoading, logout, user, walkthroughOpen, setWalkthroughOpen, markWalkthroughSeen } = useDive();
  // Triggered from two separate components (AppHeader's header button and
  // this file's own sidebar button below) — lifted here, their shared
  // parent, rather than into DiveContext, since it's a plain UI toggle, not
  // real app state.
  const [extensionCardOpen, setExtensionCardOpen] = useState(false);

  // Auto-starts the guided tour exactly once ever for this account — see
  // User.ts's hasSeenWalkthrough. The ref (not just the effect's own
  // dependency array) guards against re-firing if `screen` bounces back to
  // "home" again before `user.hasSeenWalkthrough` has round-tripped through
  // the backend and updated locally — this should only ever attempt once
  // per app mount, whatever happens.
  const autoWalkthroughTriedRef = useRef(false);
  useEffect(() => {
    if (autoWalkthroughTriedRef.current) return;
    if (screen !== "home" || !user) return;
    autoWalkthroughTriedRef.current = true;
    if (!user.hasSeenWalkthrough) setWalkthroughOpen(true);
  }, [screen, user, setWalkthroughOpen]);

  const inOnboarding = ONBOARDING.includes(screen);
  const isFullScreenFlow = NO_NAV_EXTRA.includes(screen);
  const ScreenComp = SCREENS[screen] || Home;
  const activeNav = ["ask", "insights", "myHoldings", "scoreBreakdown"].includes(screen)
    ? "home"
    : screen === "divebot"
    ? "profile" // only ever reached from the "Simulate app pop-up" button in Profile now
    : screen;

  // Avoid ever mounting the "splash" screen just to immediately redirect away
  // from it once the session-restore check resolves (also sidesteps a
  // framer-motion AnimatePresence edge case when the very first render's key
  // changes before its enter transition completes).
  if (authLoading) {
    return <div className="h-full w-full dive-app-surface" data-testid="app-loading" />;
  }

  const content = (
    <AnimatePresence>
      {/* `h-full`, not `min-h-full` — a screen (e.g. HoldingsGateStates.jsx's
          empty/loading/error states) that sizes ITSELF with `h-full` to
          center its content vertically depends on this box having an
          explicitly-specified height, not just a minimum one. Per the CSS
          spec, a percentage height only resolves against an ancestor whose
          own height is "specified explicitly" — `min-height` alone doesn't
          count, even though the box visually renders at the full 900px
          here, so a child's `h-full` silently fell back to `auto` (shrink
          to content) instead, pinning short content to the top of the
          screen instead of centering it. A screen taller than the viewport
          still scrolls fine with a fixed `h-full` here: the actual
          `overflow-y-auto` lives on the grandparent, and this element has
          no `overflow` of its own, so content taller than 100% simply
          extends past this box in normal flow — still part of what the
          ancestor's scroll region measures — exactly as it did before. */}
      <motion.div key={screen} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="h-full">
        {inOnboarding ? <Onboarding /> : <ScreenComp />}
      </motion.div>
    </AnimatePresence>
  );

  // Forms (auth) and full-screen action flows (Bot Scan, file upload, etc.)
  // don't benefit from a sidebar or extra width at any viewport — they stay
  // a single, comfortably narrow centered column, matching how a login page
  // or a focused wizard step reads on any real site regardless of screen
  // size. Only the nav'd, dashboard-like screens (below) get the wider
  // sidebar treatment on desktop. Reused as-is for both onboarding (no
  // header) and the authenticated full-screen flows (header sits above it).
  const narrowColumn = (
    <div className="relative h-full w-full overflow-hidden flex justify-center">
      <div className="h-full w-full max-w-xl overflow-y-auto no-scrollbar">{content}</div>
    </div>
  );

  // Pre/mid-auth screens never get the app header — there's no real user
  // session (or none of its data has loaded yet) to show in it.
  if (inOnboarding) {
    return <div className="h-full w-full dive-app-surface">{narrowColumn}</div>;
  }

  // Every authenticated screen from here down gets the header — including
  // the full-screen flows (chooseMethod/manualEntry/etc.), so search/
  // notifications/profile/Your Journey stay reachable from any page, not
  // just the nav'd dashboard screens.
  return (
    <div className="relative h-full w-full flex flex-col dive-app-surface overflow-hidden">
      <AppHeader onOpenExtension={() => setExtensionCardOpen(true)} />
      <AnimatePresence>
        {extensionCardOpen && <ExtensionDownloadCard onClose={() => setExtensionCardOpen(false)} />}
      </AnimatePresence>
      {walkthroughOpen && (
        <Walkthrough onDone={() => { markWalkthroughSeen(); setWalkthroughOpen(false); }} />
      )}
      <div className="flex-1 min-h-0">
        {isFullScreenFlow ? narrowColumn : (
          <div className="relative h-full w-full overflow-hidden md:flex">
            {/* Sidebar — desktop only (md:+). Mobile keeps the bottom nav below,
                unchanged from before this phase. */}
            <div className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:h-full md:border-r md:border-[var(--border)] md:py-6 md:px-3" data-testid="sidebar-nav">
              <div className="flex items-center gap-2 px-3 mb-8">
                <span className="font-heading font-black text-xl">
                  <span className="text-gold-gradient">Divv</span>
                  <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
                </span>
              </div>
              {/* flex-1 makes this <nav> claim all the leftover vertical space in
                  the sidebar column — its own items stay top-anchored, so the
                  slack lands at nav's bottom edge, which is exactly what pushes
                  the logout button below it down to the sidebar's bottom edge. */}
              <nav className="flex flex-col gap-1 flex-1">
                {NAV.map(({ id, label, Icon }) => {
                  const active = activeNav === id;
                  return (
                    <button key={id} data-testid={`sidebar-nav-${id}`} onClick={() => setScreen(id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left transition-colors ${active ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)]"}`}>
                      <Icon size={18} strokeWidth={active ? 2.5 : 2} /> {label}
                    </button>
                  );
                })}
              </nav>
              {/* Manual replay of the guided tour — same component the
                  first-time auto-start opens (see the useEffect above), not
                  part of NAV.map/activeNav highlighting for the same reason
                  the Get Extension button below isn't either. */}
              <button data-testid="sidebar-walkthrough-btn" onClick={() => setWalkthroughOpen(true)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-tertiary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)] transition-colors">
                <HelpCircle size={18} /> Walkthrough
              </button>
              {/* Opens the same ExtensionDownloadCard as AppHeader's header
                  button — not part of NAV.map/activeNav highlighting, since
                  it opens a popup rather than navigating to a real screen. */}
              <button data-testid="sidebar-extension-btn" onClick={() => setExtensionCardOpen(true)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-tertiary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)] transition-colors">
                <Download size={18} /> Get Extension
              </button>
              <button data-testid="sidebar-logout-btn" onClick={logout}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-tertiary)] hover:bg-[var(--red)]/10 hover:text-[var(--red)] transition-colors">
                <LogOut size={18} /> Log out
              </button>
            </div>

            {/* `relative` (not just a plain flex child) — the binding ancestor
                for any `absolute inset-0` overlay still deep inside a screen;
                without it, that positioning bubbles up to the outer wrapper
                above, which spans the sidebar too, centering the popup
                across the whole app width instead of just this content
                column. A screen's own full-screen SHEETS (WhatIfSheet,
                MarketStressSheet, ShareCard, GetStartedPopup,
                ExtensionDownloadCard) don't rely on this anymore — they're
                portaled straight to `document.body` (see each component's
                own comment) specifically because nesting them inside THIS
                div, even as `position: fixed`, still scrolled them along
                with its `overflow-y-auto` content: a transformed ancestor
                only changes which box `fixed`/`absolute` positions against,
                it doesn't grant immunity from that box's own scrolling if
                the element is still part of its scrollable content — the
                classic "trap fixed in a scroll panel" trick assumes the
                trapped element sits OUTSIDE the scrolling region (e.g. a
                pinned header), not inside it, which isn't this shape. */}
            <div className="relative flex-1 h-full overflow-y-auto no-scrollbar">{content}</div>

            {/* Bottom nav — mobile only, hidden once the sidebar takes over at md:+. */}
            <div className="md:hidden absolute bottom-0 inset-x-0 bg-[var(--surface-card)]/95 backdrop-blur-lg border-t border-[var(--border)] px-2 py-2 flex justify-around" data-testid="bottom-nav">
              {NAV.map(({ id, label, Icon }) => {
                const active = activeNav === id;
                return (
                  <button key={id} data-testid={`nav-${id}`} onClick={() => setScreen(id)}
                    className="flex flex-col items-center gap-1 py-1 px-2 flex-1">
                    <Icon size={20} className={active ? "text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"} strokeWidth={active ? 2.5 : 2} />
                    <span className={`text-[10px] font-bold ${active ? "text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
