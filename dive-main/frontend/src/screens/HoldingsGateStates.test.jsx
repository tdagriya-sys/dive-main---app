import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "./Home";
import Suggestions from "./Suggestions";
import XRay from "./XRay";
import { useDive } from "../context/DiveContext";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// P3 #28 — Home/Suggestions/X-Ray used to `return null` for a loading or
// genuinely-empty portfolio, indistinguishable from a crash. Every one of
// these states (including a logged-out demo-mode visitor, whose
// holdings/holdingsLoading/holdingsError all sit at their DiveContext
// defaults — same as the "genuinely empty" row below) must render something
// visible instead of a blank screen.
describe.each([
  ["Home", Home, "home"],
  ["Suggestions", Suggestions, "suggestions"],
  ["X-Ray", XRay, "xray"],
])("%s — no more blank return null", (_name, Screen, prefix) => {
  const baseContext = {
    setScreen: jest.fn(),
    goBack: jest.fn(),
    loadHoldings: jest.fn().mockResolvedValue([]),
    sims: [],
    ranges: {},
    prefs: { risk: "Balanced", excluded: [] },
    setAskInstrument: jest.fn(),
    addSim: jest.fn(),
    resetSims: jest.fn(),
    scoreBreakdown: null,
    user: { name: "Test" },
  };

  it("shows a visible loading state, not a blank screen, while holdings are loading", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], holdingsLoading: true, holdingsError: false });
    const { container } = render(<Screen />);
    expect(screen.getByTestId(`${prefix}-loading-state`)).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("shows a retryable error state, not a blank screen, when loading failed", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], holdingsLoading: false, holdingsError: true });
    render(<Screen />);
    expect(screen.getByTestId(`${prefix}-load-error-state`)).toBeInTheDocument();
    expect(screen.getByTestId(`${prefix}-load-error-retry-btn`)).toBeInTheDocument();
  });

  it("shows a friendly empty state, not a blank screen, on a genuinely empty portfolio (including a logged-out demo visitor)", () => {
    // Same shape DiveContext starts with for a visitor who never logged in —
    // this is exactly the "scrolling the demo phone-frame" case reported.
    useDive.mockReturnValue({ ...baseContext, holdings: [], holdingsLoading: false, holdingsError: false, user: null });
    const { container } = render(<Screen />);
    expect(screen.getByTestId(`${prefix}-empty-state`)).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });
});
