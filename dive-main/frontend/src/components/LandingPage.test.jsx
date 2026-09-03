import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LandingPage from "./LandingPage";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// LandingPage renders FeatureShowcaseSections (see FeatureShowcase.test.jsx),
// which needs both of these jsdom gaps stubbed or it throws — same setup
// used there.
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
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

// Regression guard for a real bug: the landing page's "Asset classes
// covered" stat was left at 11 (a hard-coded literal, not derived from any
// shared constant — see the comment above it in LandingPage.jsx) after PF
// became the 12th asset class, until a user caught it. This test exists
// specifically so the next asset-class addition can't silently repeat that.
describe("LandingPage — asset-class coverage claims", () => {
  beforeEach(() => {
    useDive.mockReturnValue({ setScreen: jest.fn() });
    mockMatchMedia(true);
    window.IntersectionObserver = MockIntersectionObserver;
  });

  it("shows 12 asset classes covered in the hero stat row, not the pre-PF count of 11", () => {
    render(<LandingPage />);
    const stat = screen.getByText("Asset classes covered").previousElementSibling;
    expect(stat).toHaveTextContent("12");
  });

  it("mentions the provident fund category in the 'Track' step's investment-type list", () => {
    render(<LandingPage />);
    expect(screen.getByText(/provident fund/i)).toBeInTheDocument();
  });
});

// Refund Policy — required alongside Terms/Privacy for Razorpay's website/app
// approval on the paid resilience-score report (see docs/RAZORPAY_SETUP_GUIDE.md
// and PROTOTYPE_LIMITATIONS.md §9). Reachable from the footer, same pattern
// as the existing Terms & Conditions / Privacy Policy links.
describe("LandingPage — Refund Policy", () => {
  beforeEach(() => {
    useDive.mockReturnValue({ setScreen: jest.fn() });
    mockMatchMedia(true);
    window.IntersectionObserver = MockIntersectionObserver;
  });

  it("is reachable from the footer, replacing the landing page with the refund policy content", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    expect(screen.getByTestId("footer-refund-btn")).toHaveTextContent("Refund Policy");
    await user.click(screen.getByTestId("footer-refund-btn"));

    expect(screen.getByTestId("legal-page-refund-policy")).toBeInTheDocument();
    expect(screen.getByText(/Rs\. 99 resilience score PDF report/i)).toBeInTheDocument();
    // The digital-delivery / no-refund-for-change-of-mind stance and the
    // genuine-failure carve-out are the two things this policy actually
    // needs to say — regression guard against either silently disappearing.
    expect(screen.getByText(/don't offer refunds for a report that was generated and downloaded correctly/i)).toBeInTheDocument();
    expect(screen.getByText(/report never downloaded/i)).toBeInTheDocument();
  });

  it("Back returns to the landing page itself", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    await user.click(screen.getByTestId("footer-refund-btn"));
    expect(screen.getByTestId("legal-page-refund-policy")).toBeInTheDocument();

    await user.click(screen.getByTestId("subpage-back-btn"));
    expect(screen.queryByTestId("legal-page-refund-policy")).not.toBeInTheDocument();
    expect(screen.getByTestId("footer-refund-btn")).toBeInTheDocument(); // back on the real landing page, footer visible again
  });
});
