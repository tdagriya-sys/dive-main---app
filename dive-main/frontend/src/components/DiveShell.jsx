import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, ScanLine, Lightbulb, Compass, User, LogOut } from "lucide-react";
import { useDive } from "../context/DiveContext";
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
const ONBOARDING = ["splash", "signup", "login", "reveal"];
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
  const { screen, setScreen, authLoading, logout } = useDive();
  const inOnboarding = ONBOARDING.includes(screen);
  const isFullScreenFlow = NO_NAV_EXTRA.includes(screen);
  const hideNav = inOnboarding || isFullScreenFlow;
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
  // sidebar treatment on desktop.
  if (hideNav) {
    return (
      <div className="relative h-full w-full dive-app-surface overflow-hidden flex justify-center">
        <div className="h-full w-full max-w-xl overflow-y-auto no-scrollbar">{content}</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full dive-app-surface overflow-hidden md:flex">
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
        <button data-testid="sidebar-logout-btn" onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-left text-[var(--text-tertiary)] hover:bg-[var(--red)]/10 hover:text-[var(--red)] transition-colors">
          <LogOut size={18} /> Log out
        </button>
      </div>

      <div className="flex-1 h-full overflow-y-auto no-scrollbar">{content}</div>

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
  );
}
