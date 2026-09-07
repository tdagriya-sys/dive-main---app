import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Users, TrendingUp, Layers, ChevronDown, Menu, X } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { StatChip } from "./dive/FeatureMocks";
import HeroScene from "./dive/HeroScene";
import FeatureShowcaseSections from "./dive/FeatureShowcase";
import OurStoryPage from "./dive/OurStoryPage";
import ContactPage from "./dive/ContactPage";
import { TermsPage, PrivacyPage, RefundPolicyPage } from "./dive/LegalPages";

// Fully static marketing page — no live app instance, no auth-gated actions,
// no dependency on any real user data. Every number/card below is
// illustrative sample data (see FeatureMocks.jsx). The real, interactive
// product only exists behind login/signup — see App.js's routing.

const STEPS = [
  { n: "01", title: "Track", body: "All your investments in one place — equity, mutual funds, bonds, gold, REITs, crypto, deposits, provident fund, insurance." },
  { n: "02", title: "Score", body: "One number. Your Divve Score (0–100) — like a CIBIL score for your portfolio resilience." },
  { n: "03", title: "Diversify", body: "Rupee-specific suggestions. Not vague advice. A truly balanced portfolio, built for you." },
];

const FAQS = [
  {
    q: "What does “real vs. apparent diversification” actually mean?",
    a: "Two funds and a stock can look like three different bets while all sitting on the same underlying company. Divve looks through every holding — funds, bonds, ETFs, direct stock — and traces it back to the real issuer, so your diversification score reflects what you actually own, not just how many line items are in your portfolio.",
  },
  {
    q: "Is my account and data safe?",
    a: "Divve only ever reads your holdings — it never places a trade or moves your money. Account linking goes through RBI-licensed Account Aggregators, and you can revoke access anytime. Manual entry, Bot Scan, and file upload all work the same way: read-only, and fully under your control.",
  },
  {
    q: "Does Divve give investment advice, or trade on my behalf?",
    a: "No. Divve isn't a licensed financial advisor and never executes a trade for you — 0 trades, always. It surfaces concentration and diversification insights, plus a quantified rupee amount to consider for each category, so the decision — and the click — stays entirely yours.",
  },
  {
    q: "Do I need to know investing — or coding — to use Divve?",
    a: "No. There's no jargon, no scripts to write. Add your portfolio however's easiest, and Divve translates the analysis into a plain 0–100 score and specific rupee suggestions — the same way a credit bureau turns your history into one CIBIL score.",
  },
  {
    q: "How do I get my portfolio into Divve — do I have to link a broker?",
    a: "Whatever's easiest for you: connect accounts via Account Aggregator, add holdings manually, let Divve Bot scan your broker screen, upload a statement, or just tell Divve Planner how much you have. There's no single required way in.",
  },
  {
    q: "What is Divve Bot — is it a separate trading app?",
    a: "No — it's a lightweight browser extension, not another account. It watches for the moment you're about to place an order on your existing broker, banking, or gold app, and flags real concentration risk right there, before you confirm — not after.",
  },
  {
    q: "What if my risk appetite or preferences change later?",
    a: "Update them anytime from your profile — conservative or aggressive, prefer gold, exclude crypto entirely. Every score, suggestion, and Planner recommendation adapts instantly to your latest preferences, never a fixed one-time template.",
  },
];

// Expand/collapse uses the CSS grid-template-rows 0fr/1fr trick — a pure CSS
// transition, not a JS height measurement or a framer-motion "auto" height
// (which needs to measure scrollHeight via a layout effect and doesn't
// reliably animate). Consistent with the rest of this page's rule of thumb:
// prefer plain CSS transitions over anything that depends on
// requestAnimationFrame ticking every frame.
function FaqItem({ q, a, isOpen, onToggle, index }) {
  return (
    <div className="border-b border-[var(--border-light)]" data-testid={`faq-item-${index}`}>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-6 py-6 text-left"
      >
        <span className="font-heading font-bold text-lg sm:text-xl">{q}</span>
        <ChevronDown
          size={20}
          className={`shrink-0 text-[var(--text-tertiary)] transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <p className="text-[var(--text-secondary)] leading-relaxed pb-6 pr-6 sm:pr-16">{a}</p>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  const [openIndex, setOpenIndex] = React.useState(0);
  return (
    <section className="py-16 md:py-20" data-testid="faq-section">
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }}>
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)]">
          <span className="text-[var(--text-tertiary)] mr-1.5">/</span>Questions
        </span>
        <h2 className="font-heading font-black text-4xl sm:text-5xl leading-tight tracking-tight mt-3">Everything you're about to ask.</h2>
      </motion.div>
      <div className="mt-10 border-t border-[var(--border-light)]">
        {FAQS.map((f, i) => (
          <FaqItem key={f.q} q={f.q} a={f.a} index={i} isOpen={openIndex === i} onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))} />
        ))}
      </div>
    </section>
  );
}

// The "reflective" hover the design asked for: beyond a plain lift + gold
// border on :hover (which works even before any JS runs), a soft gold
// radial highlight tracks the cursor's actual position inside the card via
// two CSS custom properties written directly in the mousemove handler
// (--spot-x/--spot-y, read by the child's inline radial-gradient). Direct
// style mutation rather than a rAF loop or a framer-motion motion
// value — both of the latter were established earlier as unreliable in
// this app's dev sandbox tab, since it doesn't run a compositor; a plain
// synchronous DOM write on the event has no such dependency.
//
// The entrance animation (fade+slide-up via framer-motion's own `transform`)
// and the hover lift (a plain CSS `hover:-translate-y` utility) deliberately
// live on TWO separate elements, not one. framer-motion sets `transform` as
// an inline style, and an inline style always wins over any class-based CSS
// rule — including a `:hover` rule — no matter its specificity. Putting both
// on the same motion.div would make the hover lift permanently dead once the
// entrance animation finishes and "locks in" its own inline transform.
function StepCard({ n, title, body, index }) {
  const ref = React.useRef(null);
  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--spot-y", `${((e.clientY - rect.top) / rect.height) * 100}%`);
  };
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.1 }}
    >
      <div
        ref={ref}
        onMouseMove={handleMove}
        className="group relative h-full rounded-2xl border border-[var(--border-light)] bg-[var(--surface-card)] p-7 overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:border-[var(--dive-blue)] hover:shadow-[0_24px_48px_-22px_rgba(227,184,86,0.28)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: "radial-gradient(360px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(227,184,86,0.14), transparent 65%)" }}
        />
        <span className="relative font-heading font-black text-2xl text-gold-gradient">{n}</span>
        <h3 className="relative font-heading font-black text-xl mt-4">{title}</h3>
        <div className="relative w-8 h-px bg-[var(--border)] my-4" />
        <p className="relative text-sm text-[var(--text-secondary)] leading-relaxed">{body}</p>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const { setScreen } = useDive();
  // This marketing site has no URL router (see App.js's own screen-state
  // pattern) — "page" is the same kind of in-memory state machine, just
  // scoped to this component, so Our Story/Contact/Terms/Privacy can be
  // reached from the header and footer without leaving the static site or
  // routing through DiveShell's post-login screens.
  const [page, setPage] = React.useState("home");
  // Below `md`, "Our Story"/"Contact us" (the `nav`) and "Log in" all
  // disappear (see their own `hidden md:flex`/`hidden sm:inline-flex`
  // classes below) — this hamburger is the mobile-only way back to them,
  // rather than cramming three extra text links into an already-tight
  // mobile header next to the logo and the primary "Get started" CTA.
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const goToPage = React.useCallback((next) => {
    setPage(next);
    setMobileMenuOpen(false);
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--wrapper-bg)]" data-testid="landing-page">
      {/* Two symmetric ambient glows (not one) — a single top-right blur left
          the left margin and the lower half of a long scroll page flat,
          empty black with nothing to look at; this pair gives both sides of
          the page some visual presence throughout the scroll instead of
          just the very top. */}
      <div className="fixed top-0 right-0 w-[45vw] h-[45vw] rounded-full bg-[var(--dive-blue)] blur-3xl opacity-[0.08] -z-0 pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[40vw] h-[40vw] rounded-full bg-[var(--dive-blue)] blur-3xl opacity-[0.06] -z-0 pointer-events-none" />

      {/* Click-outside catcher for the mobile menu below — deliberately a
          sibling of `<header>`, not nested inside it: `<header>` has
          `backdrop-blur-lg` (a `backdrop-filter`), which makes it the
          containing block for any `position: fixed` descendant nested
          inside it (the same way `filter`/`transform`/`perspective` do),
          confining `inset-0` to the header's own ~80px box instead of the
          full viewport — the backdrop only ever covered a sliver at the
          very top and never reached anything below it, so a tap anywhere
          on the actual page silently did nothing. Living outside that
          ancestor, its containing block is the real viewport again.
          Plain conditional rendering, not AnimatePresence/motion — this
          dropdown doesn't need an exit transition, and framer-motion's
          exit animations have already proven unreliable elsewhere in this
          app's dev sandbox tab (no real compositor driving it — see
          StepCard's own comment below), which for THIS element wouldn't
          just be a cosmetic stutter: an exit that never fires leaves the
          backdrop (and the menu it goes with) permanently covering the
          page, an unrecoverable dead end for a real visitor. */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-10" onClick={() => setMobileMenuOpen(false)} data-testid="landing-mobile-menu-backdrop" />
      )}

      <header className="sticky top-0 z-20 backdrop-blur-lg bg-[var(--wrapper-bg)]/80 border-b border-[var(--border-light)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-5 flex items-center justify-between">
          <button onClick={() => goToPage("home")} className="flex items-center gap-2" data-testid="landing-logo-btn">
            <span className="font-heading font-black text-2xl">
              <span className="text-gold-gradient">Divv</span>
              <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
            </span>
          </button>
          <div className="flex items-center gap-3">
            <nav className="hidden md:flex items-center gap-1 mr-2">
              <button data-testid="header-story-btn" onClick={() => goToPage("story")}
                className="text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-3 py-2">
                Our Story
              </button>
              <button data-testid="header-contact-btn" onClick={() => goToPage("contact")}
                className="text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-3 py-2">
                Contact us
              </button>
            </nav>
            <button data-testid="landing-login-btn" onClick={() => setScreen("login")}
              className="hidden sm:inline-flex text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-3 py-2">
              Log in
            </button>
            <button data-testid="landing-signup-btn" onClick={() => setScreen("signup")}
              className="gold-btn rounded-full px-5 py-2.5 font-bold text-sm transition-transform hover:scale-[1.03]">
              Get started
            </button>
            <button data-testid="landing-menu-btn" onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              className="md:hidden w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card-hover)] transition-colors">
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            className="md:hidden relative z-20 border-t border-[var(--border-light)] bg-[var(--wrapper-bg)]"
            data-testid="landing-mobile-menu"
          >
            <nav className="max-w-7xl mx-auto px-6 py-3 flex flex-col">
              <button data-testid="mobile-menu-story-btn" onClick={() => goToPage("story")}
                className="text-left text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2 py-3">
                Our Story
              </button>
              <button data-testid="mobile-menu-contact-btn" onClick={() => goToPage("contact")}
                className="text-left text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2 py-3">
                Contact us
              </button>
              <button data-testid="mobile-menu-login-btn" onClick={() => { setMobileMenuOpen(false); setScreen("login"); }}
                className="text-left text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2 py-3">
                Log in
              </button>
            </nav>
          </div>
        )}
      </header>

      {page === "story" && <OurStoryPage onBack={() => goToPage("home")} onGetStarted={() => setScreen("signup")} />}
      {page === "contact" && <ContactPage onBack={() => goToPage("home")} />}
      {page === "terms" && <TermsPage onBack={() => goToPage("home")} />}
      {page === "privacy" && <PrivacyPage onBack={() => goToPage("home")} />}
      {page === "refund" && <RefundPolicyPage onBack={() => goToPage("home")} />}

      {page === "home" && <>
      {/* Hero — the isometric 3D scene. Its background sits behind the page's
          own ambient glow (no solid fill of its own), but its content is
          boxed to the same max-w-7xl/px-6/lg:px-10 container as everything
          else on the page (see HeroScene.jsx) so its left/right edges line
          up with the header and footer below it. */}
      <HeroScene />

      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        {/* What used to be the hero — moved below the new isometric hero
            above rather than removed, so this messaging (and its own
            get-started/login CTAs and stat chips) still has a home. */}
        <section className="flex flex-col items-center text-center gap-8 py-20 md:py-28">
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.7, ease: "easeOut" }}>
            <h2 className="font-heading font-black text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight max-w-3xl mx-auto">
              Divve deeper.<br /><span className="text-gold-gradient">Invest smarter.</span>
            </h2>
            <p className="text-lg sm:text-xl text-[var(--text-secondary)] mt-6 max-w-xl mx-auto leading-relaxed">
              DIVVE looks through every investment you own — stocks, funds, bonds, gold, REITs — to find the hidden risk your other apps can't see.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
              <button data-testid="hero-signup-btn" onClick={() => setScreen("signup")}
                className="gold-btn rounded-full px-7 py-4 font-bold flex items-center gap-2 transition-transform hover:scale-[1.03]">
                Get started free <ArrowRight size={18} />
              </button>
              <button data-testid="hero-login-btn" onClick={() => setScreen("login")}
                className="rounded-full px-7 py-4 font-bold border border-[var(--border)] hover:bg-[var(--surface-card)] transition-colors">
                Log in
              </button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.7, delay: 0.15 }}
            className="flex flex-wrap justify-center gap-x-10 gap-y-6">
            {/* Hard-coded literals, not derived from a shared constant — none of
                these exist on the frontend to import (10 = DIVE_SCORE_V2_WEIGHTS'
                sub-score count, backend/src/services/diveScoreService.ts; 12 =
                ASSET_CLASSES.length, backend/src/models/Instrument.ts, the RAW
                backend enum count before REIT+InvIT/Gold+Silver collapse to
                shared labels — NOT CORE_CATEGORIES.length, which is 10; 5 = the
                entry methods on ChooseFetchMethod.jsx). Manually keep in sync,
                same convention as every other cross-file duplicated constant in
                this codebase — last synced 2026-09-01 when PF became the 12th
                asset class. */}
            <StatChip icon={Layers} value={10} label="Score signals" format={(v) => Math.round(v)} />
            <StatChip icon={ShieldCheck} value={12} label="Asset classes covered" format={(v) => Math.round(v)} />
            <StatChip icon={TrendingUp} value={5} label="Ways to add your portfolio" format={(v) => Math.round(v)} />
            <StatChip icon={Users} value={0} label="Bank-grade security, always" format={() => "🔒"} />
          </motion.div>
        </section>
      </div>

      {/* Three feature-deep-dive sections (USP accordion, scroll-linked
          showcase, Divve Bot) — rendered outside the max-w-7xl wrapper
          because the middle one is a full-bleed scroll-jacked stage with
          its own background; each section constrains its own content back
          to max-w-7xl/px-6/lg:px-10 internally (see FeatureShowcase.jsx),
          same technique as HeroScene above. */}
      <FeatureShowcaseSections />

      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        {/* How it works — the 3-step Track / Score / Diversify journey. */}
        <section className="py-16 md:py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }}>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)]">How it works</span>
            <h2 className="font-heading font-black text-4xl sm:text-5xl leading-tight tracking-tight mt-3">Three steps to clarity.</h2>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {STEPS.map((s, i) => (
              <StepCard key={s.n} n={s.n} title={s.title} body={s.body} index={i} />
            ))}
          </div>
        </section>

        <FaqSection />

        {/* Closing CTA */}
        <section className="py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }}>
            <h2 className="font-heading font-black text-4xl sm:text-5xl leading-tight tracking-tight">
              Divve deeper.<br /><span className="text-gold-gradient">Invest smarter.</span>
            </h2>
            <button data-testid="closing-signup-btn" onClick={() => setScreen("signup")}
              className="mt-8 gold-btn rounded-full px-8 py-4 font-bold inline-flex items-center gap-2 transition-transform hover:scale-[1.03]">
              Get started free <ArrowRight size={18} />
            </button>
            <div className="flex items-center justify-center gap-2 mt-6 text-sm text-[var(--text-secondary)]">
              <ShieldCheck size={16} className="text-[var(--dive-blue)]" />
              Bank-grade security. You control what's connected.
            </div>
          </motion.div>
        </section>
      </div>
      </>}

      <footer className="relative border-t border-[var(--border-light)]" data-testid="landing-footer">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-14">
          <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <button onClick={() => goToPage("home")} className="flex items-center gap-2">
                <span className="font-heading font-black text-2xl">
                  <span className="text-gold-gradient">Divv</span>
                  <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
                </span>
              </button>
              <p className="text-sm text-[var(--text-secondary)] mt-4 max-w-xs leading-relaxed">
                DIVVE looks through every investment you own to find the hidden risk your other apps can't see — one honest score, not a guess.
              </p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4">Company</p>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <button data-testid="footer-story-btn" onClick={() => goToPage("story")}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    Our Story
                  </button>
                </li>
                <li>
                  <button data-testid="footer-contact-btn" onClick={() => goToPage("contact")}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    Contact us
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-4">Get started</p>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <button data-testid="footer-signup-btn" onClick={() => setScreen("signup")}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    Create an account
                  </button>
                </li>
                <li>
                  <button data-testid="footer-login-btn" onClick={() => setScreen("login")}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    Log in
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-12 pt-8 border-t border-[var(--border-light)]">
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
              <p className="text-xs text-[var(--text-tertiary)]">© {new Date().getFullYear()} Divve, a product of Dagriya Fin-Tech Private Limited. All rights reserved.</p>
              <div className="flex items-center gap-4">
                <button data-testid="footer-terms-btn" onClick={() => goToPage("terms")}
                  className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  Terms &amp; Conditions
                </button>
                <button data-testid="footer-privacy-btn" onClick={() => goToPage("privacy")}
                  className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  Privacy Policy
                </button>
                <button data-testid="footer-refund-btn" onClick={() => goToPage("refund")}
                  className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  Refund Policy
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
              <ShieldCheck size={14} className="text-[var(--dive-blue)]" />
              Bank-grade security. You control what's connected.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
