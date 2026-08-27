import React from "react";
import { render, screen, within } from "@testing-library/react";
import FeatureShowcaseSections from "./FeatureShowcase";

// jsdom doesn't implement matchMedia — FeatureShowcaseScrolly's scroll-linked
// 3D flip (SECTION 2) reads it on mount to branch between the desktop
// scroll-jacked flip and the mobile static fallback. Default to "desktop"
// (matches: true) so the existing scroll-flip wiring is exercised the same
// way it is in a real >=901px browser; individual tests override matches to
// simulate mobile.
// framer-motion's `whileInView` (used by DiveBotShowcase's SECTION 3 visual)
// needs a real IntersectionObserver to mount; jsdom doesn't implement one.
// A no-op stub is enough — the tests below only assert on structure/text,
// never on the reveal animation actually firing.
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mockMatchMedia(matches) {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(), // deprecated API some libs still call
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe("FeatureShowcaseSections", () => {
  beforeEach(() => {
    mockMatchMedia(true);
    window.IntersectionObserver = MockIntersectionObserver;
  });

  it("renders all three USP accordion panels, including the corrected Planner month", () => {
    render(<FeatureShowcaseSections />);
    const accordion = screen.getByTestId("usp-accordion");

    expect(screen.getByTestId("usp-panel-xray")).toBeInTheDocument();
    expect(screen.getByTestId("usp-panel-suggest")).toBeInTheDocument();
    expect(screen.getByTestId("usp-panel-planner")).toBeInTheDocument();

    // Regression guard for the Planner sub-section text fix: the stat
    // banner ("120 months mapped out") is a separate, unrelated number from
    // the individual plan-row month, which should read 67, not 120.
    expect(within(accordion).getByText("120")).toBeInTheDocument();
    expect(within(accordion).getByText(/months mapped out/)).toBeInTheDocument();
    expect(within(accordion).getByText(/Month 67:/)).toBeInTheDocument();
    expect(within(accordion).queryByText(/Month 120:/)).not.toBeInTheDocument();
  });

  it("renders the desktop scroll-linked flip stage with all four features represented", () => {
    render(<FeatureShowcaseSections />);

    expect(screen.getByTestId("feature-scrolly")).toBeInTheDocument();
    expect(screen.getByTestId("scrolly-flip-3d")).toBeInTheDocument();
    // Starts on the first feature before any scroll happens. Scoped to the
    // desktop content pane specifically — "Divve Score" also appears in the
    // (always-rendered, CSS-hidden-on-desktop) mobile fallback list below.
    const contentPane = screen.getByTestId("scrolly-content-pane");
    expect(screen.getByTestId("scrolly-feat-index")).toHaveTextContent("01 / 04");
    expect(within(contentPane).getByText("Divve Score")).toBeInTheDocument();
  });

  it("renders a mobile fallback list with all four features (no scroll-jacked flip)", () => {
    // Mounts regardless of the matchMedia result above — the mobile list is
    // plain unconditional JSX, gated visually via CSS (`.fs-stage` /
    // `.fs-scrolly-mobile-list` display swap at the 900px breakpoint) rather
    // than by JS branching, precisely so it can never get stuck showing only
    // the first feature the way the old mobile scroll-flip branch did.
    render(<FeatureShowcaseSections />);
    const list = screen.getByTestId("scrolly-mobile-list");

    const expectedTitles = ["Divve Score", "Ask Divve", "Personalization", "Connect everything"];
    expectedTitles.forEach((title, i) => {
      const card = within(list).getByTestId(`scrolly-mobile-card-${i}`);
      expect(within(card).getByText(title)).toBeInTheDocument();
      // The index label ("01 / 04") is built from adjacent JSX expressions,
      // so it lands in the DOM as sibling text nodes rather than one string
      // — assert on the rendered span's aggregate text instead of getByText.
      expect(card.querySelector(".fs-feat-index")).toHaveTextContent(`0${i + 1} / 04`);
    });

    // Sanity-check each card actually carries its own distinct mock content
    // rather than all four repeating the first feature's.
    expect(within(list).getByText("Fit for you")).toBeInTheDocument(); // Ask Divve
    expect(within(list).getByText("Risk appetite")).toBeInTheDocument(); // Personalization
    expect(within(list).getByText("Account Aggregator")).toBeInTheDocument(); // Connect everything
  });

  it("renders the Divve Bot section", () => {
    render(<FeatureShowcaseSections />);
    expect(screen.getByTestId("divebot-showcase")).toBeInTheDocument();
  });
});
