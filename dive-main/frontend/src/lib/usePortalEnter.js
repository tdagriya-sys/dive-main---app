import { useEffect, useState } from "react";

// Drives an overlay's enter/exit animation via manual state instead of
// relying on framer-motion's own initial/animate/exit auto-trigger — that
// auto-trigger turned out to be genuinely UNRELIABLE (not just "needs more
// time") in this app: verified directly via computed style across every
// full-screen sheet that uses one (ShareCard, GetStartedPopup, SimulateSheet,
// WhatIfSheet, MarketStressSheet) — each intermittently got stuck at its
// `initial` opacity/transform values on mount. Not deterministic: the exact
// same component sometimes animated in fine and sometimes didn't, across
// otherwise-identical clicks in the same session, so this isn't a structural
// difference between a "working" and a "broken" component — every one of
// them needs this. Originally suspected to be specific to createPortal(...,
// document.body) targets (every sheet above is portaled) — but DiveShell's
// mobile nav drawer hit the exact same stuck-at-initial-value symptom despite
// never being portaled at all (a plain `motion.div` nested normally in
// DiveShell's own tree), so the real trigger is broader than portaling; it
// was never conclusively pinned down (a genuine upstream/environment quirk,
// not app code) and this hook is the safe default for ANY mount-triggered
// framer-motion transition in this app, portaled or not. This sidesteps it
// entirely with a plain, always-reliable prop-change animation instead — the
// same code path any already-mounted `motion` component's `animate` update
// already uses correctly everywhere else in this app (e.g. Widgets.jsx's
// AnimatedNumber).
//
// Usage:
//   const { entered, handleClose } = usePortalEnter(onClose);
//   <motion.div animate={{ opacity: entered ? 1 : 0, ... }} onClick={handleClose}>
// instead of the usual initial/animate/exit props and the raw onClose prop —
// `handleClose` plays the reverse transition before actually telling the
// parent to unmount, since framer-motion's own AnimatePresence exit-delay is
// the same unreliable auto-triggered mechanism as the mount one above.
export function usePortalEnter(onClose, exitDurationMs = 300) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const handleClose = () => {
    setEntered(false);
    setTimeout(onClose, exitDurationMs);
  };
  return { entered, handleClose };
}
