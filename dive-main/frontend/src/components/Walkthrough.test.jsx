import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Walkthrough from "./Walkthrough";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// Real targets the tour points at (header/sidebar chrome + Home content) —
// rendered as plain elements with the real testids/text Walkthrough.jsx
// looks for via document.querySelector, standing in for AppHeader/DiveShell/
// Home's actual markup so the tour can find and measure real DOM elements
// the same way it will in the real app.
function ChromeStub({ withHoldings }) {
  return (
    <div>
      <button data-testid="app-header-logo-btn">logo</button>
      <button data-testid="header-extension-btn">ext</button>
      <button data-testid="header-journey-btn">journey</button>
      <button data-testid="header-search-btn">search</button>
      <button data-testid="header-notif-btn">notif</button>
      <button data-testid="header-profile-btn">profile</button>
      <button data-testid="sidebar-nav-xray">xray</button>
      <button data-testid="sidebar-nav-suggestions">suggest</button>
      <button data-testid="sidebar-nav-planner">planner</button>
      <button data-testid="sidebar-nav-profile">profile-nav</button>
      <button data-testid="sidebar-walkthrough-btn">walkthrough</button>
      {withHoldings ? (
        <>
          <div data-testid="home-score-ring-card">score</div>
          <button data-testid="home-download-report-btn">report</button>
        </>
      ) : (
        <button data-testid="home-empty-add-btn">add</button>
      )}
    </div>
  );
}

// jsdom has no real layout engine: getBoundingClientRect always returns an
// all-zero rect (irrelevant to what these tests check — step content/
// navigation/adaptiveness, not pixel positions), scrollIntoView isn't
// implemented at all, and offsetParent — Walkthrough.jsx's real, correct way
// to detect a genuinely CSS-hidden target in an actual browser (e.g. the
// header's `hidden sm:flex` buttons on a narrow viewport) — is always null
// regardless of real visibility, since jsdom never computes layout. All
// three need stubbing here so the tests exercise the tour's actual
// navigation/adaptiveness logic instead of jsdom's layout gaps.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    get() { return document.body; },
    configurable: true,
  });
});

describe("Walkthrough", () => {
  let onDone;

  beforeEach(() => {
    onDone = jest.fn();
    useDive.mockReturnValue({ holdings: [] });
  });

  it("starts on the welcome step (no spotlight, centered card)", () => {
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);
    const tooltip = screen.getByTestId("walkthrough-tooltip");
    expect(tooltip).toHaveTextContent("Hi there!");
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("1 of");
  });

  it("Next moves to the next step, Back returns to the previous one", async () => {
    const user = userEvent.setup();
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);

    await user.click(screen.getByTestId("walkthrough-next-btn"));
    expect(screen.getByTestId("walkthrough-tooltip")).toHaveTextContent("The Divve logo");

    await user.click(screen.getByTestId("walkthrough-back-btn"));
    expect(screen.getByTestId("walkthrough-tooltip")).toHaveTextContent("Hi there!");
  });

  it("'Skip tour' calls onDone immediately, from any step", async () => {
    const user = userEvent.setup();
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);

    await user.click(screen.getByTestId("walkthrough-next-btn"));
    await user.click(screen.getByTestId("walkthrough-skip-link"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("the X button also calls onDone", async () => {
    const user = userEvent.setup();
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);
    await user.click(screen.getByTestId("walkthrough-skip-btn"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reaching the final step and clicking 'Done' calls onDone", async () => {
    const user = userEvent.setup();
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);

    // Click through every step to the end — however many there are.
    let guard = 0;
    while (!screen.queryByText(/^Done$/) && guard < 30) {
      await user.click(screen.getByTestId("walkthrough-next-btn"));
      guard++;
    }
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("walkthrough-next-btn")); // final "Done" click
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("zero-holdings shows the empty-state 'Add investments' step, not the score-card ones", async () => {
    useDive.mockReturnValue({ holdings: [] });
    const user = userEvent.setup();
    render(<ChromeStub withHoldings={false} />);
    render(<Walkthrough onDone={onDone} />);

    const titles = [];
    let guard = 0;
    while (guard < 30) {
      titles.push(screen.getByTestId("walkthrough-tooltip").textContent);
      if (screen.queryByText(/^Done$/)) break;
      await user.click(screen.getByTestId("walkthrough-next-btn"));
      guard++;
    }
    expect(titles.some((t) => t.includes("Add investments"))).toBe(true);
    expect(titles.some((t) => t.includes("Your Divve Score"))).toBe(false);
  });

  it("has-holdings shows the real score-card/report steps, not the empty-state one", async () => {
    useDive.mockReturnValue({ holdings: [{ id: "h1", segment: "Equity", amount: 1000 }] });
    const user = userEvent.setup();
    render(<ChromeStub withHoldings />);
    render(<Walkthrough onDone={onDone} />);

    const titles = [];
    let guard = 0;
    while (guard < 30) {
      titles.push(screen.getByTestId("walkthrough-tooltip").textContent);
      if (screen.queryByText(/^Done$/)) break;
      await user.click(screen.getByTestId("walkthrough-next-btn"));
      guard++;
    }
    expect(titles.some((t) => t.includes("Your Divve Score"))).toBe(true);
    expect(titles.some((t) => t.includes("Add investments"))).toBe(false);
  });
});
