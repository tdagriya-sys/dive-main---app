import React from "react";
import "./HeroScene.css";

// Ported from the uploaded reference (divve-hero.html) — a true CSS 3D
// isometric scene (perspective + rotateX/rotateZ on a shared parent, each
// piece redeclaring that same base tilt plus its own translateZ depth) —
// not the flat 2D skew/rotate approximation the previous SVG hero art used.
// This is what makes it read as ONE connected 3D construction rather than a
// collage: the phone, the two background context cards, and the two
// interactive feature cards all share the same rotateX(48deg) rotateZ(-38deg)
// camera angle, differing only in how far along Z they sit and (for the
// feature cards) whether they've been hovered flat.
//
// Every color in HeroScene.css is a direct swap of the reference's light
// "paper" palette for this app's existing dark/gold CSS variables (--ink ->
// --text-primary, --paper -> --wrapper-bg, --lime -> --dive-blue, etc.) — see
// the mapping comment at the top of that file. Structure, proportions, and
// the hover-to-flatten interaction are otherwise untouched from the
// reference; the flatten is pure CSS (:hover / :focus-visible), no JS state
// needed, since these are ordinary HTML elements where z-index just works
// (unlike the SVG version, which had to reorder the DOM to paint on top).
export default function HeroScene() {
  return (
    <section className="hero-scene" data-testid="hero-scene">
      {/* Same max-w-7xl/px-6/lg:px-10 container the rest of the page uses
          (header, feature rows, footer) — this section previously had no
          horizontal constraint of its own, so its content ran edge-to-edge
          while everything above and below it lined up to that container,
          making the hero visibly wider than the rest of the page. */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10 hs-inner">
        <div className="hs-copy">
          <span className="hs-eyebrow">Real diversification, measured &amp; fixed</span>
          <h1 className="hs-h1">
            Most portfolios only <em>look</em> diversified.
          </h1>
          <p className="hs-lede">
            Ten tickers can still move as one. Divve scores every holding by how independently it actually behaves — so you know if you're spread out, or just holding more of the same risk.
          </p>

          <div className="hs-proof-row">
            <div className="hs-proof-item"><b>60 sec</b> to your first score</div>
            <div className="hs-proof-item"><b>Read-only</b> account sync</div>
            <div className="hs-proof-item"><b>0</b> trades placed on your behalf</div>
          </div>
        </div>

        <div className="hs-visual-wrap">
          <div className="hs-visual">
            <svg className="hs-scene-lines" viewBox="0 0 700 700" aria-hidden="true">
              <defs>
                <linearGradient id="hsFade1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FAFAF7" stopOpacity="0" />
                  <stop offset="45%" stopColor="#FAFAF7" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#FAFAF7" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="hsFade2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FAFAF7" stopOpacity="0" />
                  <stop offset="55%" stopColor="#FAFAF7" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#FAFAF7" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="40" y1="560" x2="380" y2="230" stroke="url(#hsFade1)" strokeWidth="1" />
              <line x1="120" y1="640" x2="470" y2="300" stroke="url(#hsFade1)" strokeWidth="1" />
              <line x1="660" y1="470" x2="380" y2="720" stroke="url(#hsFade2)" strokeWidth="1" />
              <line x1="600" y1="120" x2="420" y2="270" stroke="url(#hsFade2)" strokeWidth="1" />
            </svg>

            <div className="hs-stage-el hs-phone" />

            <div className="hs-stage-el hs-card hs-card-portfolio">
              <div className="hs-card-title">Your Portfolio <span className="hs-badge-count">42 holdings</span></div>
              <div className="hs-insight-bubble">Top 5 holdings move together <b>71%</b> of the time.</div>
              <div className="hs-fake-input"><span className="hs-dot" /><span className="hs-dot" /> Ask Divve anything…</div>
            </div>

            <div className="hs-stage-el hs-card hs-card-checklist">
              <div className="hs-card-title">Coverage checklist</div>
              <div className="hs-check-row"><span className="hs-check-icon done" /><span className="hs-check-label">US Equities</span></div>
              <div className="hs-check-row filled"><span className="hs-check-icon pending" /><span className="hs-check-bar" /></div>
              <div className="hs-check-row"><span className="hs-check-icon pending" /><span className="hs-check-bar hs-check-bar-short" /></div>
            </div>

            <div className="hs-stage-el hs-card hs-feature-card hs-card-score" tabIndex={0} data-testid="hero-scene-card-score">
              <span className="hs-card-eyebrow">Divve Score</span>
              <div className="hs-card-title">Diversification</div>
              <div className="hs-score-scale">
                <div className="hs-score-tick" style={{ top: "0%" }}><span>100</span></div>
                <div className="hs-score-tick" style={{ top: "33%" }}><span>75</span></div>
                <div className="hs-score-tick" style={{ top: "66%" }}><span>50</span></div>
                <div className="hs-score-tick" style={{ top: "100%" }}><span>0</span></div>
                <div className="hs-score-marker" style={{ top: "27%" }} />
              </div>
              <div className="hs-score-pill">78 <small>/ 100</small></div>
            </div>

            <div className="hs-stage-el hs-card hs-feature-card hs-card-diversify" tabIndex={0} data-testid="hero-scene-card-diversify">
              <span className="hs-card-eyebrow">Apparent vs Real</span>
              <div className="hs-card-title">Diversification</div>
              <div className="hs-bars-row">
                <div className="hs-bar-col"><div className="hs-bar apparent" /><span>91%</span></div>
                <div className="hs-bar-col"><div className="hs-bar real" /><span>46%</span></div>
              </div>
              <div className="hs-diverge-callout">
                <div>
                  <div className="hs-diverge-number">46%</div>
                  <div className="hs-diverge-caption">true correlation-adjusted score</div>
                </div>
                <div className="hs-flag-icon" />
              </div>
            </div>
          </div>

          <div className="hs-dock">
            <div className="hs-dock-icon active"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="var(--wrapper-bg)" strokeWidth="1.6" /></svg></div>
            <div className="hs-dock-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M4 18V10M12 18V6M20 18V13" stroke="var(--text-primary)" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
            <div className="hs-dock-icon"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="var(--text-primary)" strokeWidth="1.6" /></svg></div>
            <div className="hs-dock-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M5 7h14M5 17h14" stroke="var(--text-primary)" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
          </div>

          <span className="hs-hint">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v13m0 0-4-4m4 4 4-4M6 21h12" stroke="var(--text-tertiary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Hover a highlighted card to explore
          </span>
        </div>
      </div>
    </section>
  );
}
