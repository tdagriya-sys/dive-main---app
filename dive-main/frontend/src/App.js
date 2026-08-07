import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "@/App.css";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Toaster } from "sonner";
import { DiveProvider, useDive } from "@/context/DiveContext";
import DiveShell from "@/components/DiveShell";
import LandingIntro from "@/components/LandingIntro";
import ErrorBoundary from "@/components/ErrorBoundary";

function PhoneFrame() {
  return (
    <div className="relative shrink-0 mx-auto" data-testid="phone-frame">
      <div className="relative aspect-[9/19.5] h-[calc(100vh-80px)] max-h-[900px] min-h-[500px] w-auto rounded-[2.75rem] border-[8px] border-neutral-800 bg-black shadow-[0_30px_80px_-15px_rgba(0,0,0,0.75)] gold-ring overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-5 w-28 mx-auto bg-neutral-800 rounded-b-2xl z-50" />
        <div className="absolute -right-[10px] top-32 w-1 h-14 bg-neutral-700 rounded-r" />
        <div className="absolute -left-[10px] top-28 w-1 h-9 bg-neutral-700 rounded-l" />
        <div className="absolute -left-[10px] top-40 w-1 h-9 bg-neutral-700 rounded-l" />
        <div className="h-full w-full rounded-[2.1rem] overflow-hidden bg-[var(--app-bg)]">
          <ErrorBoundary variant="phone">
            <DiveShell />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

const SECTIONS = [
  { screen: "home", eyebrow: "Portfolio health, scored", title: "Meet your DIVVE Score — like a CIBIL score, for your money",
    body: "One number out of 100 that tells you how safe your investments really are. A CIBIL score tells a bank how trustworthy you are with credit. Your DIVVE Score tells YOU how resilient your portfolio really is — in plain language, not jargon.",
    callout: "One honest number, updated the moment you add a holding" },
  { screen: "scoreBreakdown", eyebrow: "How we calculate it", title: "Built from 10 real signals, not a guess",
    body: "We measure how concentrated your money is, how much it swings up and down, how independently your investments move from each other, how fast you'd recover from a crash, and more — then blend all of it into one score, the same way a credit bureau blends your repayment history and debt into one CIBIL number.",
    callout: "Concentration + volatility + correlation + 7 more, in one score" },
  { screen: "xray", eyebrow: "The X-Ray", title: "Your diversification might be an illusion",
    body: "You think ₹10k in a stock, ₹10k in a fund, and ₹10k in a bond means you're spread across three things. DIVVE looks INSIDE each one and often finds you're 70-80% exposed to one company without knowing it.",
    callout: "Real look-through, not just labels on a statement" },
  { screen: "xray", eyebrow: "Apparent vs. Real", title: "Two diversification numbers. Only one is true.",
    body: "'Apparent' is what your statement shows you. 'Real' is what's left after DIVVE traces every fund's actual holdings and every company's true parent group. That gap is the risk your other apps never show you.",
    callout: "Tap 'Look Deeper' to see the real number" },
  { screen: "suggestions", eyebrow: "Quantified nudges", title: "We don't just say 'diversify' — we tell you exactly how much",
    body: "Most apps stop at vague advice. DIVVE tells you the real ₹ amount to add or trim in each category, built around your own risk profile — never a one-size-fits-all rule.",
    callout: "Current ₹ → Ideal ₹ range, always in real rupees" },
  { screen: "suggestions", eyebrow: "Try before you invest", title: "Drag a slider. Watch your score move. For real.",
    body: "Before a single rupee moves, simulate it. See exactly how much your DIVVE Score would improve by adding ₹20,000 to Gold or ₹50,000 to a Bond fund — instantly, with nothing at risk.",
    callout: "Instant what-if, zero real money involved" },
  { screen: "planner", eyebrow: "New: Divve Planner", title: "Don't know where to start? Let Divve plan it for you",
    body: "Tell us how much you have — a one-time lumpsum or a monthly SIP — and Divve Planner builds a complete, personalised asset-class plan around it. Brand new investor or a seasoned one, it works around what you already hold.",
    callout: "No stock-picking, ever — just the categories that matter" },
  { screen: "planner", eyebrow: "Built for real life", title: "It knows your age, your corpus, and your patience",
    body: "A ₹10,000 starter portfolio doesn't need 8 asset classes on day one — a ₹50 lakh one does. Divve Planner adjusts what it recommends to your corpus size and life stage, and for SIPs, tells you exactly which month to start each new category.",
    callout: "Month-by-month milestones, not a wall of numbers" },
  { screen: "ask", eyebrow: "Ask DIVVE", title: "Curious about one specific stock or fund? Just ask.",
    body: "Search any stock, mutual fund, or bond and get a clear, no-nonsense read — fundamentals, technicals, and valuation — without a pushy 'buy now' pitch.",
    callout: "Instrument-level insight, only when you ask for it" },
  { screen: "ask", eyebrow: "Fit for you", title: "It tells you how THIS fits YOUR portfolio, not just if it's 'good'",
    body: "A great fund can still be a bad idea for you, if you already own too much of the same company through it. 'Fit for you' simulates adding it and shows exactly how your real score and concentration would shift.",
    callout: "Same math as your real score — never a second, competing one" },
  { screen: "divebot", eyebrow: "The differentiator", title: "DIVVE follows you everywhere you invest",
    body: "About to buy more of a stock you're already overloaded on, in a completely different app? DIVVE Bot steps in right there, in real time — before you tap 'confirm', not after.",
    callout: "Warns you before the mistake, not after" },
  { screen: "profile", eyebrow: "Built around you", title: "Your risk appetite. Your preferences. Your rules.",
    body: "Conservative or aggressive, want more gold or none at all, never want crypto — every suggestion, score nudge, and Planner recommendation respects your own choices, never a generic template.",
    callout: "Change it anytime — DIVVE adapts instantly" },
  { screen: "chooseMethod", eyebrow: "However you invest, however you track it", title: "5 ways in — pick whatever's easiest for you",
    body: "Connect your accounts securely, add holdings manually, share your broker screen, upload a statement, or just tell us how much you have and let Divve Planner map it out. There's no single 'right' way to start.",
    callout: "Bank-grade security — you control what's connected" },
];

function Landing() {
  const { setScreen } = useDive();
  const refs = useRef([]);
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  // Focus/demo mode: hides the scrolling explainer copy and centers the phone
  // full-page. The SAME <PhoneFrame> instance renders in both modes (see the
  // shared wrapper below, not two separate branches) so its internal screen/
  // state is never lost or reset when toggling — only the surrounding layout
  // classes change.
  const [demoMode, setDemoMode] = useState(false);

  // Measures the header's real rendered height (it's positioned absolutely
  // below, so it no longer pushes content down in normal flow) and applies
  // it as top padding instead. useLayoutEffect (not useEffect) so this
  // happens before the browser paints — otherwise the phone would flash at
  // the wrong offset for a frame before snapping into place, the exact
  // "settles after a moment" issue this is fixing.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Synchronous initial read (before paint) — don't rely solely on
    // ResizeObserver's callback for the first measurement, since it fires
    // asynchronously and isn't guaranteed to land before the first frame.
    setHeaderHeight(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setHeaderHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (demoMode) return; // section refs aren't mounted while the explainer copy is hidden
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) setScreen(e.target.dataset.screen);
      });
    }, { threshold: 0.6 });
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, [setScreen, demoMode]);

  const enterDemo = (screen) => {
    setScreen(screen);
    setDemoMode(true);
  };

  return (
    <div className="App min-h-screen bg-[var(--wrapper-bg)]">
      {/* soft gold backdrop accent */}
      <div className="fixed top-0 right-0 w-[45vw] h-[45vw] rounded-full bg-[var(--dive-blue)] blur-3xl opacity-[0.08] -z-0 pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6 lg:px-10" style={{ "--hh": `${headerHeight}px` }}>
        {/* Header — absolutely positioned so its height never pushes content
            down in normal document flow. This matters specifically for the
            phone column below: a `position: sticky` element only starts
            "stuck" once its own normal (unstuck) flow position has been
            scrolled past — so if anything (the header's own flow height, or
            padding standing in for it) pushed the phone column down even a
            little, it would render "unstuck" below its final spot on first
            paint, only snapping up to true-center once the user scrolled
            past that offset. The phone column below gets NO top offset at
            the `lg` breakpoint (where it becomes sticky) so it's already in
            its final position on the very first frame; only the copy column
            (and the phone column pre-`lg`, where it isn't sticky yet) is
            padded by the header's own measured height (--hh, set above) to
            clear it visually. */}
        <header ref={headerRef} className="absolute top-0 inset-x-0 z-20 flex items-center justify-between py-6">
          {/* Shifted left at the `lg` breakpoint specifically — that's where
              the phone column becomes sticky and starts flush with the top of
              the page (see the comment above), so the logo's own footprint
              would otherwise land on top of the phone's top-left corner. */}
          <div className="flex items-center gap-2 lg:-ml-20">
            <span className="font-heading font-black text-2xl">
              <span className="text-gold-gradient">Divv</span>
              {/* Tilted 9° like Google's own wordmark "e". */}
              <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
            </span>
            <Sparkles size={18} className="text-[var(--dive-blue)]" />
          </div>
          <button data-testid="header-cta" onClick={() => setScreen("splash")}
            className="hidden sm:inline-flex gold-btn rounded-full px-5 py-2.5 font-bold text-sm transition-transform hover:scale-[1.03]">
            Try the live demo
          </button>
        </header>

        <div className={demoMode
          ? "min-h-screen flex flex-col items-center justify-center py-10"
          : "lg:grid lg:grid-cols-[auto_1fr] lg:gap-20 lg:items-start"}>
          {/* Phone column — same wrapper element in both modes (only its
              className toggles), and PhoneFrame keeps a stable `key` so
              React never unmounts/remounts it across the demoMode switch:
              whatever screen it's on, and any in-progress interaction
              (a form mid-fill, a Bot Scan screen-share in progress), stays
              exactly as the user left it, in both directions. */}
          <div className={demoMode
            ? "pt-[var(--hh)] flex items-end justify-center gap-6"
            : "pt-[var(--hh)] lg:pt-0 lg:sticky lg:top-0 lg:h-screen flex justify-center items-center mb-12 lg:mb-0"}>
            <PhoneFrame key="phone" />
            {/* Sits beside the phone (not above/below it), so it never
                pushes the phone's own position around — `items-end` on the
                row above aligns it near the phone's bottom-right. */}
            {demoMode && (
              <button key="back-btn" data-testid="demo-back-btn" onClick={() => setDemoMode(false)}
                className="mb-16 flex items-center gap-1.5 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap">
                <ArrowLeft size={16} /> Back to overview
              </button>
            )}
          </div>

          {!demoMode && (
            <div key="copy" className="pt-[var(--hh)] lg:max-w-xl">
              <section className="min-h-[50vh] flex flex-col justify-center py-10">
                  <h1 className="font-heading font-black text-4xl sm:text-5xl leading-[1.05] tracking-tight">
                    Divve deeper.<br /><span className="text-gold-gradient">Invest smarter.</span>
                  </h1>
                  <p className="text-lg text-[var(--text-secondary)] mt-5 leading-relaxed">
                    DIVVE looks through every investment you own — stocks, funds, bonds, gold, REITs — to find the hidden risk your other apps can't see.
                  </p>
                  <div className="flex items-center gap-3 mt-7">
                    <button data-testid="hero-demo-btn" onClick={() => enterDemo("splash")}
                      className="gold-btn rounded-full px-6 py-3.5 font-bold flex items-center gap-2 transition-transform hover:scale-[1.03]">
                      Start the demo <ArrowRight size={18} />
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-4">👆 The phone is fully interactive — tap through it live.</p>
                  <motion.p
                    data-testid="hero-signup-note"
                    onClick={() => setScreen("signup")}
                    className="text-lg font-bold text-gold-gradient mt-3 cursor-pointer w-fit"
                    animate={{ opacity: [1, 0.35, 1] }}
                    transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
                  >
                    Login/signup to access all the screens
                  </motion.p>
                </section>

                {SECTIONS.map((s, i) => (
                  <section key={`${s.screen}-${i}`} ref={(el) => (refs.current[i] = el)} data-screen={s.screen}
                    className="min-h-[85vh] flex flex-col justify-center py-10" data-testid={`landing-section-${i}`}>
                    <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
                      <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)]">{s.eyebrow}</span>
                      <h2 className="font-heading font-black text-3xl sm:text-4xl leading-tight mt-3 tracking-tight">{s.title}</h2>
                      <p className="text-base text-[var(--text-secondary)] mt-4 leading-relaxed">{s.body}</p>
                      {s.callout && (
                        <span className="inline-block mt-5 text-xs font-bold px-3.5 py-2 rounded-full bg-[var(--dive-blue-light)] text-[var(--dive-blue-dark)]">
                          {s.callout}
                        </span>
                      )}
                    </motion.div>
                  </section>
                ))}

                {/* Closing CTA */}
                <section className="min-h-[70vh] flex flex-col justify-center py-10">
                  <h2 className="font-heading font-black text-4xl leading-tight tracking-tight">
                    Divve deeper.<br /><span className="text-gold-gradient">Invest smarter.</span>
                  </h2>
                  <button data-testid="closing-cta-btn" onClick={() => enterDemo("divebot")}
                    className="mt-6 self-start gold-btn rounded-full px-7 py-4 font-bold flex items-center gap-2 transition-transform hover:scale-[1.03]">
                    See DIVVE in Action <ArrowRight size={18} />
                  </button>
                  <div className="flex items-center gap-2 mt-5 text-sm text-[var(--text-secondary)]">
                    <ShieldCheck size={16} className="text-[var(--dive-blue)]" />
                    Bank-grade security. You control what's connected.
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}

function App() {
  // The site opens on the Divve wordmark reveal, then hands off to the real
  // landing page — the same "brand first, product second" beat a big product
  // site opens on. AnimatePresence lets the intro fade out while Landing
  // fades in underneath (both near-black backgrounds, so the crossfade reads
  // as one continuous dissolve, not a hard cut).
  const [showIntro, setShowIntro] = useState(true);
  return (
    <DiveProvider>
      <AnimatePresence>
        {showIntro ? (
          <motion.div key="intro" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            <LandingIntro onFinished={() => setShowIntro(false)} />
          </motion.div>
        ) : (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <Landing />
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster position="top-center" richColors />
    </DiveProvider>
  );
}

export default App;
