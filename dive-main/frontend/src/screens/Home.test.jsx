import React from "react";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./Home";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));
jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));

// GetStartedPopup — a first-run nudge shown on Home whenever the portfolio is
// genuinely empty (fresh signup, or a login/session-restore that found no
// saved holdings — see DiveContext.js's session-restore effect and login()).
// Those now land on Home instead of being dropped straight into the
// fetch-method chooser with no dashboard in sight.
describe("Home — GetStartedPopup", () => {
  let setScreen;

  const baseContext = {
    holdingsLoading: false,
    holdingsError: false,
    loadHoldings: jest.fn(),
    user: { id: "u1", name: "Test" },
    sims: [],
    resetSims: jest.fn(),
    scoreBreakdown: null,
    loadScoreBreakdown: jest.fn(),
    walkthroughOpen: false,
  };

  beforeEach(() => {
    setScreen = jest.fn();
    sessionStorage.clear();
  });

  it("shows the popup alongside the existing empty-state screen (additive, not a replacement) when the portfolio is genuinely empty", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    render(<Home />);
    expect(screen.getByTestId("home-empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("get-started-popup")).toBeInTheDocument();
  });

  it("renders at the larger max-w-xl size, not the original max-w-md", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    render(<Home />);
    const popup = screen.getByTestId("get-started-popup");
    expect(popup.className).toContain("max-w-xl");
    expect(popup.className).not.toContain("max-w-md");
  });

  it("does NOT show the popup once the user has real holdings", () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [{ id: "h1", name: "Test Equity Holding", segment: "Equity", amount: 100000, lookthrough: [{ company: "Test Co", pct: 100 }] }],
      setScreen,
    });
    render(<Home />);
    expect(screen.queryByTestId("get-started-popup")).not.toBeInTheDocument();
  });

  it("closes on the X button, leaving the existing empty-state screen (and its own CTA) visible and usable underneath", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    render(<Home />);

    await user.click(screen.getByTestId("get-started-close-btn"));
    // AnimatePresence's exit animation keeps the node mounted mid-fade for a
    // moment after the close click — wait for it to actually leave the DOM
    // rather than asserting immediately (same pattern as Suggestions.test.jsx).
    await waitForElementToBeRemoved(() => screen.queryByTestId("get-started-popup"));

    expect(screen.getByTestId("home-empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("home-empty-add-btn")).toBeInTheDocument();
  });

  it("'Fetch my investments' navigates to the method chooser", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    render(<Home />);
    await user.click(screen.getByTestId("get-started-fetch-btn"));
    expect(setScreen).toHaveBeenCalledWith("chooseMethod");
  });

  it("'Start my investment journey' navigates to Divve Planner", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    render(<Home />);
    await user.click(screen.getByTestId("get-started-planner-btn"));
    expect(setScreen).toHaveBeenCalledWith("planner");
  });

  it("shows only once per session — a second Home mount (e.g. navigating away and back) does NOT show it again, even without ever dismissing it", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen });
    const first = render(<Home />);
    expect(screen.getByTestId("get-started-popup")).toBeInTheDocument();
    first.unmount(); // simulates navigating to a different screen

    render(<Home />); // simulates navigating back to Home
    expect(screen.queryByTestId("get-started-popup")).not.toBeInTheDocument();
  });

  it("shows again for a genuinely different user in the same browser tab (shared/kiosk-browser case) — not keyed on a flat, user-agnostic flag", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen, user: { id: "u1", name: "First Person" } });
    const first = render(<Home />);
    expect(screen.getByTestId("get-started-popup")).toBeInTheDocument();
    first.unmount();

    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen, user: { id: "u2", name: "Second Person" } });
    render(<Home />);
    expect(screen.getByTestId("get-started-popup")).toBeInTheDocument();
  });

  it("does NOT show while the guided walkthrough is open, even with zero holdings — avoids stacking two overlays on a brand-new user", () => {
    useDive.mockReturnValue({ ...baseContext, holdings: [], setScreen, walkthroughOpen: true });
    render(<Home />);
    expect(screen.queryByTestId("get-started-popup")).not.toBeInTheDocument();
  });
});

// Score Breakdown is deliberately held back from direct site access for now
// (already offered as the paid PDF report below) — the donut card is
// display-only, not a link into ScoreBreakdown.jsx, until that comes back
// post-subscription-plans. Regression guard against either the click
// re-appearing or the "See the full breakdown" text coming back accidentally.
describe("Home — Score card (no link to Score Breakdown) & report download", () => {
  const holdings = [{ id: "h1", name: "Test Equity Holding", segment: "Equity", amount: 100000, lookthrough: [{ company: "Test Co", pct: 100 }] }];
  let setScreen;

  const baseContext = {
    holdings,
    holdingsLoading: false,
    holdingsError: false,
    loadHoldings: jest.fn(),
    user: { name: "Test" },
    sims: [],
    resetSims: jest.fn(),
    scoreBreakdown: null,
    loadScoreBreakdown: jest.fn(),
    walkthroughOpen: false,
  };

  beforeEach(() => {
    setScreen = jest.fn();
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  it("the score card no longer navigates to Score Breakdown, and the old 'See the full breakdown' link is gone", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({ ...baseContext, setScreen });
    render(<Home />);

    expect(screen.queryByText(/See the full breakdown/i)).not.toBeInTheDocument();
    const card = screen.getByTestId("home-score-ring-card");
    expect(card.tagName).not.toBe("BUTTON"); // display-only now, not a button
    await user.click(card);
    expect(setScreen).not.toHaveBeenCalledWith("scoreBreakdown");
  });

  // The button's own markup/pricing copy/badge is tested once, thoroughly,
  // in lib/useDownloadReport.test.js (DownloadReportButton) — this just
  // confirms Home actually renders that shared component, centered at the
  // bottom of the page, and it's wired to a real download here.
  it("renders the shared DownloadReportButton, centered at the bottom of the page, and it downloads the real PDF", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({ ...baseContext, setScreen });
    api.get.mockResolvedValue({ data: new Blob(["fake pdf bytes"]) });
    render(<Home />);

    await user.click(screen.getByTestId("home-download-report-btn"));
    expect(api.get).toHaveBeenCalledWith("/score/breakdown/pdf", { responseType: "blob" });
  });
});
