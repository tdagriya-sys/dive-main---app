import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home as HomeIcon, ScanLine, Lightbulb, Compass, User } from "lucide-react";
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
  const { screen, setScreen, authLoading } = useDive();
  const inOnboarding = ONBOARDING.includes(screen);
  const hideNav = inOnboarding || NO_NAV_EXTRA.includes(screen);
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

  return (
    <div className="relative h-full w-full dive-app-surface overflow-hidden">
      <div className="h-full w-full overflow-y-auto no-scrollbar">
        <AnimatePresence>
          <motion.div key={screen} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="min-h-full">
            {inOnboarding ? <Onboarding /> : <ScreenComp />}
          </motion.div>
        </AnimatePresence>
      </div>

      {!hideNav && (
        <div className="absolute bottom-0 inset-x-0 bg-[var(--surface-card)]/95 backdrop-blur-lg border-t border-[var(--border)] px-2 py-2 flex justify-around" data-testid="bottom-nav">
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
      )}
    </div>
  );
}
