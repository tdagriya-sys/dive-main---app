import { useState } from "react";
import "@/App.css";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster } from "sonner";
import { DiveProvider, useDive } from "@/context/DiveContext";
import DiveShell from "@/components/DiveShell";
import LandingIntro from "@/components/LandingIntro";
import LandingPage from "@/components/LandingPage";
import ErrorBoundary from "@/components/ErrorBoundary";

// Full-page container for everything that isn't the static marketing page —
// onboarding/auth (splash/signup/login/reveal) and the real logged-in app
// alike. Previously this was PhoneFrame: a fixed-aspect-ratio phone bezel
// the whole product was boxed into regardless of viewport, even on a wide
// desktop browser. DiveShell itself needs nothing from that bezel — its own
// root is just `h-full w-full` with internal scroll and an absolutely
// positioned bottom nav docked to ITS OWN bounding box (see DiveShell.jsx) —
// so `h-screen` here (a real, viewport-bound height) is all that's needed
// for that same internal-scroll/docked-nav mechanism to keep working
// unchanged; only the width and the bezel decoration are gone.
//
// Bug (first version of this component): the outer wrapper and DiveShell's
// own root both used the identical `dive-app-surface` gradient class, so on
// a wide viewport the "empty margin" and "the app" were pixel-identical —
// no border, no shadow contrast, nothing to read as a deliberate column at
// all, just content floating in an undifferentiated black field.
//
// Bug (second version): fixed that contrast issue, but then capped this
// wrapper at `max-w-6xl` with a border/shadow around it — which just moved
// the problem rather than solving it: on a wide monitor the app was now a
// clearly bordered "card" sitting in the middle of the page with visible
// dead space on both sides, still not actually using the screen. There is
// no outer cap here anymore — DiveShell.jsx's sidebar + flexible-width
// content area (Phase 3) genuinely fills whatever width this wrapper gives
// it. The narrow, centered treatment for auth/full-screen-flow forms
// (signup, Bot Scan, etc.) still exists — that's DiveShell.jsx's own
// decision for that specific case, appropriate there since a form
// shouldn't stretch edge-to-edge either.
function AppShell() {
  return (
    // `h-dvh`, not `h-screen` (`100vh`) — on mobile Chrome/Safari, `100vh`
    // is measured against the LARGEST possible viewport (address bar
    // hidden), not the actually-visible one, so this root ends up taller
    // than the real screen the moment the address bar is showing (i.e. on
    // load, and after any scroll-up). Everything below inherits its height
    // from this box via `h-full`, so that overflow silently pushed
    // DiveShell's bottom-anchored mobile nav mostly off-screen — `dvh`
    // (dynamic viewport height) tracks the browser chrome live instead.
    <div className="relative h-dvh w-full bg-[var(--wrapper-bg)] overflow-hidden" data-testid="app-shell">
      <div className="absolute top-0 right-0 w-[45vw] h-[45vw] rounded-full bg-[var(--dive-blue)] blur-3xl opacity-[0.08] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[35vw] h-[35vw] rounded-full bg-[var(--dive-blue)] blur-3xl opacity-[0.06] pointer-events-none" />
      <div className="relative h-full w-full overflow-hidden">
        <ErrorBoundary variant="phone">
          <DiveShell />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function AppRouter() {
  const { user, screen, authLoading } = useDive();
  // Mirrors DiveShell's own authLoading guard — without this, a returning
  // logged-in user would flash the marketing LandingPage for one frame
  // (user starts null until the session-restore check resolves) before
  // snapping to the real app once it does.
  if (authLoading) return <div className="min-h-screen bg-[var(--wrapper-bg)]" data-testid="app-router-loading" />;
  if (!user && screen === "splash") return <LandingPage />;
  return <AppShell />;
}

function App() {
  // The site opens on the Divve wordmark reveal, then hands off to the
  // router above — the same "brand first, product second" beat a big
  // product site opens on. AnimatePresence lets the intro fade out while
  // the next screen fades in underneath (both near-black backgrounds, so
  // the crossfade reads as one continuous dissolve, not a hard cut).
  const [showIntro, setShowIntro] = useState(true);
  return (
    <DiveProvider>
      <AnimatePresence>
        {showIntro ? (
          <motion.div key="intro" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            <LandingIntro onFinished={() => setShowIntro(false)} />
          </motion.div>
        ) : (
          <motion.div key="router" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <AppRouter />
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster position="top-center" richColors />
    </DiveProvider>
  );
}

export default App;
