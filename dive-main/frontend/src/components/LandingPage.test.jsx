import React from "react";
import { render, screen } from "@testing-library/react";
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
