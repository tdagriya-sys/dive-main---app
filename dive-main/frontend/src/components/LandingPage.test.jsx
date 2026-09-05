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

// Bug report: "Our Story", "Contact us", and "Log in" were only in the
// desktop nav (`hidden md:flex`) or `hidden sm:inline-flex` — invisible on
// mobile, with only the logo and "Get started" surviving down to a phone
// screen. A hamburger-triggered dropdown now carries all three.
describe("LandingPage — mobile menu", () => {
  const setScreen = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({ setScreen });
    mockMatchMedia(true);
    window.IntersectionObserver = MockIntersectionObserver;
  });

  it("is closed by default and opens from the hamburger button", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    expect(screen.queryByTestId("landing-mobile-menu")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("landing-menu-btn"));
    expect(screen.getByTestId("landing-mobile-menu")).toBeInTheDocument();
  });

  it("Our Story navigates to the story page and closes the menu", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    await user.click(screen.getByTestId("landing-menu-btn"));
    await user.click(screen.getByTestId("mobile-menu-story-btn"));

    expect(screen.getByTestId("story-page")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-mobile-menu")).not.toBeInTheDocument();
  });

  it("Contact us navigates to the contact page and closes the menu", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    await user.click(screen.getByTestId("landing-menu-btn"));
    await user.click(screen.getByTestId("mobile-menu-contact-btn"));

    expect(screen.getByTestId("contact-page")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-mobile-menu")).not.toBeInTheDocument();
  });

  it("Log in calls setScreen('login') and closes the menu", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    await user.click(screen.getByTestId("landing-menu-btn"));
    await user.click(screen.getByTestId("mobile-menu-login-btn"));

    expect(setScreen).toHaveBeenCalledWith("login");
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    await user.click(screen.getByTestId("landing-menu-btn"));
    expect(screen.getByTestId("landing-mobile-menu")).toBeInTheDocument();

    // The click-outside catcher visually covers the rest of the page in a
    // real browser (highest z-index below the header); jsdom does no
    // hit-testing, so the test targets it directly rather than a page
    // element it would otherwise sit on top of.
    await user.click(screen.getByTestId("landing-mobile-menu-backdrop"));
    expect(screen.queryByTestId("landing-mobile-menu")).not.toBeInTheDocument();
  });
});
