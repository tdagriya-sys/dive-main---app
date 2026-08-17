import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import XRay from "./XRay";
import { useDive } from "../context/DiveContext";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const baseContext = {
  setScreen: jest.fn(),
  goBack: jest.fn(),
  loadHoldings: jest.fn().mockResolvedValue([]),
  holdingsLoading: false,
  holdingsError: false,
  sims: [],
};

function holding(overrides) {
  return { id: overrides.name, amount: 0, lookthrough: [{ company: overrides.name, pct: 100 }], ...overrides };
}

// Bug report: the surface (segment-level) view always said "Looks nicely
// diversified across segments" verbatim — hardcoded, never actually derived
// from the segment data sitting right next to it — even for a portfolio
// 100% concentrated in one segment.
describe("XRay — surface view reflects real concentration, not a hardcoded message", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does NOT claim to be diverse when everything is in a single segment", () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [holding({ name: "Reliance Industries", segment: "Equity", amount: 100000 })],
    });
    render(<XRay />);

    expect(screen.queryByText(/looks nicely diversified/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("xray-surface-concentration-pct")).toHaveTextContent("100%");
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/100% of your portfolio/i);
  });

  it("flags heavy concentration even when technically spread across more than one segment", () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "Reliance Industries", segment: "Equity", amount: 70000 }),
        holding({ name: "Government Bond", segment: "Bonds", amount: 30000 }),
      ],
    });
    render(<XRay />);

    expect(screen.queryByText(/looks nicely diversified/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("xray-surface-concentration-pct")).toHaveTextContent("70%");
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/70% of your money is in Equity alone/i);
  });

  it("names the specific overlapping issuer when segments look balanced but the same company sits in more than one", () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "HDFC Bank", segment: "Equity", amount: 50000, lookthrough: [{ company: "HDFC Bank", pct: 100 }] }),
        holding({ name: "HDFC Bank Bonds", segment: "Bonds", amount: 50000, lookthrough: [{ company: "HDFC Bank Bonds", pct: 100 }] }),
      ],
    });
    render(<XRay />);

    // Segment split is a perfectly even 50/50 — must not be praised as
    // diverse while the same issuer quietly sits on both sides of it.
    expect(screen.queryByText(/looks nicely diversified/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/HDFC Bank shows up in both your Bonds and Equity/i);
  });

  it("only shows the reassuring message for a genuinely diverse, non-overlapping portfolio", () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "Reliance Industries", segment: "Equity", amount: 20000, lookthrough: [{ company: "Reliance Industries", pct: 100 }] }),
        holding({ name: "Government Bond", segment: "Bonds", amount: 20000, lookthrough: [{ company: "Government Bond", pct: 100 }] }),
        holding({ name: "Digital Gold", segment: "Gold/Silver", amount: 20000, lookthrough: [{ company: "Digital Gold", pct: 100 }] }),
        holding({ name: "Embassy REIT", segment: "REIT/InvIT", amount: 20000, lookthrough: [{ company: "Embassy REIT", pct: 100 }] }),
        holding({ name: "HDFC Flexi Cap", segment: "Mutual Funds", amount: 20000, lookthrough: [{ company: "HDFC Flexi Cap", pct: 100 }] }),
      ],
    });
    render(<XRay />);

    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/nicely spread across 5 segments/i);
    expect(screen.queryByTestId("xray-surface-concentration-pct")).not.toBeInTheDocument();
  });
});

// Follow-up: the deep ("True exposure") view had the mirror-image problem —
// top.pct/top.name were always real (computed live from look-through data),
// but the color and "you thought vs. you're actually" gotcha framing were
// fixed regardless of how concentrated that real number actually was. A
// genuinely low top-company exposure got the exact same red alarm as a real
// 70%+ concentration.
describe("XRay — deep view tiers its framing/color to the real top-company exposure", () => {
  beforeEach(() => jest.clearAllMocks());

  async function openDeepView() {
    const user = userEvent.setup();
    render(<XRay />);
    await user.click(screen.getByTestId("xray-look-deeper-btn"));
    // AnimatePresence mode="wait" (XRay.jsx) exits the surface view's
    // motion.div before the deep view's mounts — real animation timing, not
    // instant, even under jsdom — so the new content isn't there the instant
    // after the click.
    await waitFor(() => expect(screen.getByTestId("xray-deep-top-pct")).toBeInTheDocument());
  }

  it("uses the alarmed red 'gotcha' framing when real concentration is genuinely severe", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "Reliance Equity", segment: "Equity", amount: 60000, lookthrough: [{ company: "Reliance Industries", pct: 100 }] }),
        holding({ name: "Reliance Bonds", segment: "Bonds", amount: 40000, lookthrough: [{ company: "Reliance Industries", pct: 100 }] }),
      ],
    });
    await openDeepView();

    expect(screen.getByTestId("xray-deep-top-pct")).toHaveTextContent("100%");
    expect(screen.getByTestId("xray-deep-top-pct")).toHaveClass("text-[var(--red)]");
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(
      /You thought you spread across 2 categories\. You're actually 100% exposed to Reliance Industries alone\./i
    );
  });

  it("uses a softer amber note, not the alarm framing, for moderate real concentration", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "A", segment: "Equity", amount: 30000, lookthrough: [{ company: "Company A", pct: 100 }] }),
        holding({ name: "B", segment: "Bonds", amount: 25000, lookthrough: [{ company: "Company B", pct: 100 }] }),
        holding({ name: "C", segment: "Gold/Silver", amount: 25000, lookthrough: [{ company: "Company C", pct: 100 }] }),
        holding({ name: "D", segment: "Mutual Funds", amount: 20000, lookthrough: [{ company: "Company D", pct: 100 }] }),
      ],
    });
    await openDeepView();

    expect(screen.getByTestId("xray-deep-top-pct")).toHaveTextContent("30%");
    expect(screen.getByTestId("xray-deep-top-pct")).toHaveClass("text-[var(--amber)]");
    expect(screen.queryByText(/you thought you spread/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/Company A is your single largest real exposure at 30%/i);
  });

  it("gives a genuine reassurance, no red/amber alarm color, when real concentration is actually low", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [
        holding({ name: "A", segment: "Equity", amount: 20000, lookthrough: [{ company: "Company A", pct: 100 }] }),
        holding({ name: "B", segment: "Bonds", amount: 20000, lookthrough: [{ company: "Company B", pct: 100 }] }),
        holding({ name: "C", segment: "Gold/Silver", amount: 20000, lookthrough: [{ company: "Company C", pct: 100 }] }),
        holding({ name: "D", segment: "Mutual Funds", amount: 20000, lookthrough: [{ company: "Company D", pct: 100 }] }),
        holding({ name: "E", segment: "REIT/InvIT", amount: 20000, lookthrough: [{ company: "Company E", pct: 100 }] }),
      ],
    });
    await openDeepView();

    expect(screen.getByTestId("xray-deep-top-pct")).toHaveTextContent("20%");
    expect(screen.getByTestId("xray-deep-top-pct")).not.toHaveClass("text-[var(--red)]");
    expect(screen.getByTestId("xray-deep-top-pct")).not.toHaveClass("text-[var(--amber)]");
    expect(screen.queryByText(/you thought you spread/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("xray-insight-message")).toHaveTextContent(/Genuinely spread across 5 real companies/i);
  });
});

// Gap found while writing DIVE_SCORE_MODEL.md's documentation of this screen:
// the deep donut groups purely by literal holding name (every holding's
// lookthrough is flatly "100% to itself" client-side — see diveEngine.js's
// adaptHolding) so it can never see a mutual fund's real disclosed top
// holdings, sector affinity, or industry affinity the backend's real
// lookthroughService.ts detects. scoreBreakdown.connections is that same
// real detection, already trusted for realDiversificationPct and shown on
// Score Breakdown's "Why real is below apparent" — now also surfaced here.
describe("XRay — surfaces real backend-detected overlaps the by-name donut can't see", () => {
  beforeEach(() => jest.clearAllMocks());

  const connections = [
    { a: "h1", b: "h2", strength: 0.089, reason: "HDFC Flexi Cap Fund holds ~8.9% in HDFC Bank, which you also hold directly" },
  ];

  async function openDeepView() {
    const user = userEvent.setup();
    render(<XRay />);
    await user.click(screen.getByTestId("xray-look-deeper-btn"));
    await waitFor(() => expect(screen.getByTestId("xray-deep-top-pct")).toBeInTheDocument());
  }

  it("shows the real connection reason/strength in the deep view when the backend detected one", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [holding({ name: "A", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company A", pct: 100 }] })],
      scoreBreakdown: { hasHoldings: true, connections },
    });
    await openDeepView();

    expect(screen.getByTestId("xray-real-overlaps")).toBeInTheDocument();
    expect(screen.getByTestId("xray-overlap-0")).toHaveTextContent(/HDFC Flexi Cap Fund holds ~8.9% in HDFC Bank/i);
    expect(screen.getByTestId("xray-overlap-0")).toHaveTextContent("9% shared exposure");
  });

  it("does not show the overlaps section on the surface view, only the deep view", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [holding({ name: "A", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company A", pct: 100 }] })],
      scoreBreakdown: { hasHoldings: true, connections },
    });
    render(<XRay />);

    expect(screen.queryByTestId("xray-real-overlaps")).not.toBeInTheDocument();
  });

  it("does not show stale real-portfolio overlaps while a what-if simulation is active", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [holding({ name: "A", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company A", pct: 100 }] })],
      sims: [{ segment: "Gold/Silver", amount: 10000 }],
      scoreBreakdown: { hasHoldings: true, connections },
    });
    await openDeepView();

    expect(screen.queryByTestId("xray-real-overlaps")).not.toBeInTheDocument();
  });

  it("shows nothing when the backend found no real overlaps", async () => {
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [holding({ name: "A", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company A", pct: 100 }] })],
      scoreBreakdown: { hasHoldings: true, connections: [] },
    });
    await openDeepView();

    expect(screen.queryByTestId("xray-real-overlaps")).not.toBeInTheDocument();
  });
});
