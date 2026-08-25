import React from "react";
import { flushSync } from "react-dom";
import { motion } from "framer-motion";
import { Search, TrendingUp, Calendar, Link2, PenLine, Bot, Upload, Monitor, Compass } from "lucide-react";
import { ScoreRing } from "./Widgets";
import "./FeatureShowcase.css";

// Ported from the uploaded reference (divve-sections_4.html) — three
// standalone sections (a hover-driven USP accordion, a scroll-linked 3D
// flip showcase, and a Divve Bot promo) placed directly below the "Divve
// deeper. Invest smarter." recap section on the landing page. Colors are a
// direct swap onto this app's existing dark/gold theme tokens (see the
// mapping comment at the top of FeatureShowcase.css); copy, layout, and all
// three interactions are otherwise a faithful port of the reference.

function SectionHead({ eyebrow, title, body }) {
  return (
    <div className="fs-section-head">
      <span className="fs-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

// =============================================================
// SECTION 1 — USP Accordion
// =============================================================
// Hover (or focus) a panel and it grows to 3.6x flex-basis while the other
// two shrink to a thin rail with their heading rotated vertical — a plain
// CSS `transition: flex` on each panel, driven by a single `active` index
// in state. Mouse-leaving the whole accordion resets all three to equal
// width, matching the reference's own mouseenter/focus/mouseleave wiring.
const USP_PANELS = [
  {
    id: "xray", Icon: Search, heading: "The X-Ray", oneliner: "Your diversification might be an illusion.",
    stat: "70–80%", statLabel: "of a “diversified” portfolio can secretly sit inside one company.",
    body: "You think ₹10k in a stock, ₹10k in a fund, and ₹10k in a bond means you're spread across three things. Divve looks inside each one and traces it back to what you actually own.",
    Visual: () => (
      <>
        <div className="fs-acc-visual">
          <div className="fs-xray-chips">
            <div className="fs-xray-chip apparent"><span>APPARENT DIV.</span><b>69%</b></div>
            <div className="fs-xray-chip real"><span>REAL DIV.</span><b>56%</b></div>
          </div>
        </div>
        <div className="fs-popup-card fs-overlap-pop">
          <div className="fs-overlap-avatars">
            <span style={{ background: "rgba(248,113,113,.18)", color: "var(--red)" }}>EQ</span>
            <span style={{ background: "rgba(52,211,153,.18)", color: "var(--green)" }}>BD</span>
            <span style={{ background: "rgba(227,184,86,.18)", color: "var(--dive-blue)" }}>ETF</span>
          </div>
          <div className="info"><b>HDFC Bank shows up 3 times</b><span className="sub">Inside your equity fund, bond fund, and index ETF</span></div>
        </div>
        <div className="fs-popup-card fs-exposure-pop">
          <div><span className="sub">TRUE SINGLE-COMPANY EXPOSURE</span><b>25%</b></div>
        </div>
      </>
    ),
  },
  {
    id: "suggest", Icon: TrendingUp, heading: "Suggest", oneliner: "Exact rupees, not vague advice.",
    stat: "₹40K–₹80K", statLabel: "the exact range Divve tells you to add — not just “diversify more.”",
    body: "Divve doesn't push you to buy more within a category you already own. It points you to the asset classes you're missing, built around your own risk profile.",
    Visual: () => (
      <>
        <div className="fs-acc-visual">
          <div className="fs-sugg-row"><span className="label">Add to ETF</span><span className="range">₹40,000 – ₹80,000</span></div>
          <div className="fs-sugg-bar-track"><div className="fs-sugg-bar-fill" /></div>
        </div>
        <div className="fs-popup-card fs-sim-pop">
          <div className="sim-head"><b>Simulate: ETF</b><span>×</span></div>
          <div className="sim-amount">₹80,000</div>
          <div className="fs-sugg-bar-track"><div className="fs-sugg-bar-fill" style={{ width: "65%" }} /></div>
          <div className="fs-sim-stats">
            <div className="fs-sim-stat"><span>DIVVE SCORE</span><b>73 → <em>74</em></b></div>
            <div className="fs-sim-stat"><span>TOP EXPOSURE</span><b>25% → <em>23%</em></b></div>
          </div>
        </div>
      </>
    ),
  },
  {
    id: "planner", Icon: Calendar, heading: "Divve Planner", oneliner: "Lumpsum or SIP — planned for you.",
    stat: "120", statLabel: "months mapped out, from your first rupee to your last milestone.",
    body: "Tell Divve how much you have — lumpsum or monthly SIP — and it builds a complete asset-class plan around what you already hold, down to the month each category starts.",
    Visual: () => (
      <>
        <div className="fs-acc-visual">
          <div className="fs-plan-row"><span className="fs-plan-dot" /><span><b>Month 1:</b> start Equity</span></div>
          <div className="fs-plan-row"><span className="fs-plan-dot" /><span><b>Month 4:</b> add FD</span></div>
          <div className="fs-plan-row"><span className="fs-plan-dot" /><span><b>Month 120:</b> add REIT / InvIT</span></div>
        </div>
        <div className="fs-popup-card fs-year-pop">
          <div className="year-head"><b>Year 1</b><span>₹6,00,000 invested · total so far ₹14,00,000</span></div>
          <div className="fs-year-rows">
            <div className="fs-year-row"><span className="yr-cat"><span className="yr-dot" style={{ background: "var(--dive-blue)" }} />Equity</span><b>₹1,86,761</b></div>
            <div className="fs-year-row"><span className="yr-cat"><span className="yr-dot" style={{ background: "#B18CF0" }} />Mutual Funds</span><b>₹1,55,634</b></div>
            <div className="fs-year-row"><span className="yr-cat"><span className="yr-dot" style={{ background: "var(--green)" }} />Bonds</span><b>₹84,507</b></div>
            <div className="fs-year-row"><span className="yr-cat"><span className="yr-dot" style={{ background: "#F0C869" }} />Gold/Silver</span><b>₹62,254</b></div>
          </div>
        </div>
      </>
    ),
  },
];

function UspPanel({ panel, state, onActivate }) {
  const { Icon, heading, oneliner, stat, statLabel, body, Visual } = panel;
  const expanded = state === "expanded";
  const shrunk = state === "shrunk";
  return (
    <div
      className={`fs-acc-panel ${expanded ? "expanded" : ""} ${shrunk ? "shrunk" : ""}`}
      tabIndex={0}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      data-testid={`usp-panel-${panel.id}`}
    >
      <div className="fs-acc-icon"><Icon size={18} color="#1a1408" /></div>
      <div className="fs-acc-heading-wrap"><span className="fs-acc-heading">{heading}</span></div>
      <p className="fs-acc-oneliner">{oneliner}</p>
      <div className="fs-acc-expanded-content">
        <div className="fs-acc-text">
          <div className="fs-acc-stat">{stat}</div>
          <div className="fs-acc-stat-label">{statLabel}</div>
          <p>{body}</p>
        </div>
        <div className="fs-acc-visuals">
          <Visual />
        </div>
      </div>
    </div>
  );
}

function UspAccordion() {
  const [active, setActive] = React.useState(null);
  return (
    <section className="py-24 md:py-28">
      <SectionHead
        eyebrow="What makes Divve different"
        title="Three ways Divve sees more than your statement does."
        body="Hover a panel to open it up — the other two make room and the detail comes forward."
      />
      <div className="fs-accordion" data-testid="usp-accordion" onMouseLeave={() => setActive(null)}>
        {USP_PANELS.map((p, i) => (
          <UspPanel key={p.id} panel={p} state={active === null ? "idle" : active === i ? "expanded" : "shrunk"} onActivate={() => setActive(i)} />
        ))}
      </div>
    </section>
  );
}

// =============================================================
// SECTION 2 — Scroll-driven feature showcase
// =============================================================
// The 3D flip is a card that shares one perspective with its parent
// (`.fs-image-pane{perspective}`) and rotates on Y as the user scrolls
// through a tall (420vh) track behind a `position: sticky` stage. The
// rotation itself is written straight to the DOM node's style in the
// scroll handler (bypassing React state/re-render) for the same reason
// HeroScene's cursor-tracked glow does — a synchronous style write has no
// dependency on requestAnimationFrame actually ticking, unlike a
// framer-motion motion value. React state is only touched when the CURRENT
// feature index actually changes (i.e. rarely), driving which mock content
// renders on the flip card's front/back faces and in the text pane.
function ScoreFlipMock() {
  return (
    <>
      <div className="fs-ring-mock">
        <ScoreRing score={73} size={110} stroke={11} showLabel={false} />
        <div className="fs-ring-legend">
          <div className="tag">DIVVE SCORE</div>
          <div className="tier">Good</div>
        </div>
      </div>
      <div className="fs-metric-tags">
        {["Concentration", "Correlation", "Volatility", "Drawdown", "Liquidity", "+5 more"].map((t) => (
          <span key={t} className="fs-metric-tag">{t}</span>
        ))}
      </div>
    </>
  );
}

function AskFlipMock() {
  return (
    <>
      <div className="fs-fit-title">Fit for you</div>
      <div className="fs-fit-sub">If you added ₹84,000 of this</div>
      <div className="fs-fit-slider-track">
        <div className="fs-fit-slider-fill" />
        <div className="fs-fit-slider-handle" />
      </div>
      <div className="fs-fit-rows">
        <div className="fs-fit-row"><span>Divve Score</span><span className="delta">73 → 74</span></div>
        <div className="fs-fit-row"><span>Apparent diversification</span><span className="delta">69% → 74%</span></div>
        <div className="fs-fit-row"><span>Real diversification</span><span className="delta">56% → 61%</span></div>
      </div>
    </>
  );
}

function PersonalizationFlipMock() {
  return (
    <>
      <div className="fs-fit-sub" style={{ marginBottom: 8 }}>Risk appetite</div>
      <div className="fs-seg-control">
        <span className="fs-seg-opt">Conservative</span>
        <span className="fs-seg-opt active">Balanced</span>
        <span className="fs-seg-opt">Aggressive</span>
      </div>
      <div className="fs-fit-sub" style={{ margin: "18px 0 8px" }}>Preferred categories</div>
      <div className="fs-chip-grid">
        <span className="fs-chip on">Equity</span>
        <span className="fs-chip on">Mutual Funds</span>
        <span className="fs-chip">Bonds</span>
        <span className="fs-chip on">Gold/Silver</span>
        <span className="fs-chip">REIT/InvIT</span>
        <span className="fs-chip">Crypto</span>
      </div>
    </>
  );
}

function ConnectFlipMock() {
  const cards = [
    { Icon: Link2, t: "Account Aggregator", s: "Securely pull holdings", hi: true },
    { Icon: PenLine, t: "Add manually", s: "Guided forms", hi: false },
    { Icon: Bot, t: "Bot Scan", s: "Share your screen", hi: true },
    { Icon: Upload, t: "Upload a file", s: "Screenshot / CSV", hi: false },
    { Icon: Compass, t: "Divve Planner", s: "Just tell it how much you have", hi: true, span2: true },
  ];
  return (
    <div className="fs-fetch-grid">
      {cards.map((c) => (
        <div key={c.t} className={`fs-fetch-card ${c.hi ? "hi" : ""} ${c.span2 ? "span2" : ""}`}>
          <div className="fs-fetch-ic"><c.Icon size={14} color={c.hi ? "#1a1408" : "var(--text-primary)"} /></div>
          <div className="t">{c.t}</div>
          <div className="s">{c.s}</div>
        </div>
      ))}
    </div>
  );
}

const SCROLLY_FEATURES = [
  {
    title: "Divve Score",
    body: "One number out of 100 that tells you how resilient your portfolio really is — built from 10 real signals, blended the way a credit bureau blends your history into one score.",
    Mock: ScoreFlipMock,
  },
  {
    title: "Ask Divve",
    body: "Search any stock, fund, or bond and get a fit-for-you read — not just whether it's good, but whether it's good for a portfolio that already looks like yours.",
    Mock: AskFlipMock,
  },
  {
    title: "Personalization",
    body: "Set your risk appetite, return expectation, and how hard Divve should push you to diversify. Prefer gold, exclude crypto entirely — every suggestion adapts instantly.",
    Mock: PersonalizationFlipMock,
  },
  {
    title: "Connect everything",
    body: "Five ways in, pick whatever's easiest — link accounts via an RBI-licensed Account Aggregator, let Divve Bot read your broker's holdings page for you, or skip linking entirely and tell Divve Planner how much you have.",
    Mock: ConnectFlipMock,
  },
];

function smoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

function FeatureShowcaseScrolly() {
  const trackRef = React.useRef(null);
  const flip3dRef = React.useRef(null);
  const lastFaceIdx = React.useRef(-1);
  const lastTextIdx = React.useRef(-1);
  const [faceIdx, setFaceIdx] = React.useState(0);
  const [nextIdx, setNextIdx] = React.useState(1);
  const [textIdx, setTextIdx] = React.useState(0);

  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    let ticking = false;
    const maxIdx = SCROLLY_FEATURES.length - 1;

    function render() {
      const track = trackRef.current;
      const flip3d = flip3dRef.current;
      if (!track || !flip3d) return;

      if (!mq.matches) {
        if (lastFaceIdx.current !== 0) {
          setFaceIdx(0);
          setNextIdx(Math.min(maxIdx, 1));
          setTextIdx(0);
          lastFaceIdx.current = 0;
          lastTextIdx.current = 0;
        }
        flip3d.style.transform = "rotateY(0deg)";
        return;
      }

      const rect = track.getBoundingClientRect();
      const total = Math.max(1, track.offsetHeight - window.innerHeight);
      const scrolled = -rect.top;
      const progressAll = Math.min(1, Math.max(0, scrolled / total));
      const raw = progressAll * SCROLLY_FEATURES.length;

      const idxFace = Math.min(maxIdx, Math.floor(raw));
      const localFace = idxFace >= maxIdx ? 0 : Math.max(0, Math.min(1, raw - idxFace));
      const rotation = smoothstep(localFace) * 180;

      if (idxFace !== lastFaceIdx.current) {
        // The rotation reset below (180deg -> ~0deg as we cross into the
        // next feature's slot) is a synchronous DOM write, but a plain
        // setState here would only commit on React's next scheduled
        // render — which could land a frame or two AFTER the rotation
        // reset already applied. In that gap, the flip card's front face
        // is showing the OLD feature at the NEW (near-0deg, front-facing)
        // rotation, i.e. the wrong content flashes into view for an
        // instant. flushSync forces the front/back content to commit
        // before this function moves on to write the new transform, so
        // by the time the rotation changes, the DOM already matches it.
        flushSync(() => {
          setFaceIdx(idxFace);
          setNextIdx(Math.min(maxIdx, idxFace + 1));
        });
        lastFaceIdx.current = idxFace;
      }

      const newTextIdx = Math.min(maxIdx, Math.round(raw));
      if (newTextIdx !== lastTextIdx.current) {
        setTextIdx(newTextIdx);
        lastTextIdx.current = newTextIdx;
      }

      flip3d.style.transform = `rotateY(${rotation}deg)`;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          render();
          ticking = false;
        });
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", render);
    render();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", render);
    };
  }, []);

  const current = SCROLLY_FEATURES[textIdx];
  const FrontMock = SCROLLY_FEATURES[faceIdx].Mock;
  const BackMock = SCROLLY_FEATURES[nextIdx].Mock;

  return (
    <section className="fs-scrolly" data-testid="feature-scrolly">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 fs-scrolly-intro">
        <span className="fs-eyebrow">Under the hood</span>
        <h2 className="fs-scrolly-head">Four systems doing the work of a full-time analyst.</h2>
        <p className="fs-scrolly-sub">Keep scrolling — each feature takes over the stage as it comes into view.</p>
      </div>

      <div className="fs-scrolly-track" ref={trackRef}>
        <div className="fs-stage">
          <div className="fs-stage-inner">
            <div className="fs-content-pane">
              <span className="fs-feat-index" data-testid="scrolly-feat-index">{String(textIdx + 1).padStart(2, "0")} / 0{SCROLLY_FEATURES.length}</span>
              <h3 className="fs-content-title">{current.title}</h3>
              <p className="fs-content-body">{current.body}</p>
            </div>
            <div className="fs-image-pane">
              <div className="fs-flip-3d" ref={flip3dRef} data-testid="scrolly-flip-3d">
                <div className="fs-flip-face fs-flip-front"><FrontMock /></div>
                <div className="fs-flip-face fs-flip-back"><BackMock /></div>
              </div>
            </div>
          </div>
          <div className="fs-dots">
            {SCROLLY_FEATURES.map((_, i) => (
              <span key={i} className={`fs-dot ${i === textIdx ? "active" : ""}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================
// SECTION 3 — Divve Bot
// =============================================================
const BOT_FEATURES = [
  { title: "Reads the order before you place it", body: "Sees what you're about to buy across any connected app." },
  { title: "Flags the real risk, instantly", body: "Concentration, correlation, or exposure you didn't notice." },
  { title: "Works on desktop, too", body: "A lightweight browser extension brings the same nudge to your desktop broker." },
];

function DiveBotShowcase() {
  return (
    <section className="fs-bot max-w-7xl mx-auto px-6 lg:px-10" data-testid="divebot-showcase">
      <div className="fs-bot-grid">
        <div>
          <span className="fs-eyebrow">Divve Bot</span>
          <h2 className="fs-bot-title">Warns you <span className="text-gold-gradient">before</span> the mistake, not after.</h2>
          <p className="fs-bot-body">
            You don't need to open Divve every time you invest. The moment you place an order in any broker, banking, or gold app, Divve Bot steps in — right there, in real time — before you tap confirm.
          </p>

          <div className="fs-bot-feature-list">
            {BOT_FEATURES.map((f) => (
              <div className="fs-bot-feature" key={f.title}>
                <span className="fs-bot-dot-ic" />
                <div><strong>{f.title}</strong><span>{f.body}</span></div>
              </div>
            ))}
          </div>

          <div className="fs-bot-cta">
            <span className="fs-ext-note">
              <Monitor size={16} />
              Available as a desktop extension
            </span>
          </div>
        </div>

        <motion.div
          className="fs-bot-visual"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="fs-bot-visual-inner">
            <div className="fs-order-mock">
              <div className="fs-order-top">
                <div className="fs-order-app-name"><span className="fs-order-app-ic" />PropShare</div>
                <span className="fs-order-close">×</span>
              </div>
              <div className="fs-order-body">
                <div className="fs-order-label">ORDER</div>
                <div className="fs-order-title">Invest in Embassy Office REIT</div>
                <div className="fs-order-sub">₹25,000 · 6.8% yield</div>
                <div className="fs-order-confirm">CONFIRM</div>
              </div>
            </div>

            <div className="fs-ext-pill">● Live in Groww and AngelOne.</div>

            <div className="fs-popup-mock">
              <div className="fs-popup-head">
                <div className="fs-popup-brand"><span className="fs-pulse" /><b>Divve Bot</b></div>
                <span className="fs-popup-badge">FLAGGED</span>
              </div>
              <div className="fs-popup-msg">Wait — you're already exposed to real estate through Oberoi Realty.</div>
              <div className="fs-popup-sub">This REIT would push your real-estate exposure to 34% of your portfolio. Want to see the impact first?</div>
              <div className="fs-popup-actions">
                <button>Continue anyway</button>
                <button className="fs-popup-primary">See impact</button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================
// Composed export
// =============================================================
export default function FeatureShowcaseSections() {
  return (
    <>
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <UspAccordion />
      </div>
      <FeatureShowcaseScrolly />
      <DiveBotShowcase />
    </>
  );
}
