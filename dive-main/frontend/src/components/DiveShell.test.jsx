import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiveShell from "./DiveShell";
import { useDive } from "../context/DiveContext";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const baseContext = {
  authLoading: false,
  setScreen: jest.fn(),
  goBack: jest.fn(),
  holdings: [],
  holdingsLoading: false,
  holdingsError: false,
  loadHoldings: jest.fn().mockResolvedValue([]),
  user: { name: "Test" },
  sims: [],
  resetSims: jest.fn(),
  scoreBreakdown: null,
  loadScoreBreakdown: jest.fn(),
  logout: jest.fn(),
};

// Phase 3: nav'd, dashboard-like screens now get a desktop sidebar (shown
// via CSS at md:+, always present in the DOM under its own distinct
// testid so it can never collide with the pre-existing mobile bottom nav)
// alongside the unchanged mobile bottom nav. Forms/full-screen flows
// (chooseMethod, auth, Bot Scan, etc.) get neither — just a centered,
// width-capped column, since a sidebar doesn't make sense next to a form.
describe("DiveShell — responsive nav (Phase 3)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows both the sidebar nav and the bottom nav on a real nav'd screen (Home)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    render(<DiveShell />);

    expect(screen.getByTestId("sidebar-nav")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    ["home", "xray", "suggestions", "planner", "profile"].forEach((id) => {
      expect(screen.getByTestId(`sidebar-nav-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`nav-${id}`)).toBeInTheDocument();
    });
  });

  it("shows neither nav on a full-screen flow (chooseMethod) or during onboarding (signup)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "chooseMethod" });
    const { rerender } = render(<DiveShell />);
    expect(screen.queryByTestId("sidebar-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();

    useDive.mockReturnValue({ ...baseContext, screen: "signup" });
    rerender(<DiveShell />);
    expect(screen.queryByTestId("sidebar-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();
  });

  it("navigates when a sidebar item is clicked, same as the bottom nav", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", setScreen });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("sidebar-nav-xray"));
    expect(setScreen).toHaveBeenCalledWith("xray");
  });

  it("highlights the right sidebar item for screens that map to a different nav tab (e.g. Score Breakdown -> Home)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "scoreBreakdown" });
    render(<DiveShell />);

    expect(screen.getByTestId("sidebar-nav-home")).toHaveClass("text-[var(--dive-blue)]");
    expect(screen.getByTestId("sidebar-nav-xray")).not.toHaveClass("text-[var(--dive-blue)]");
  });

  it("shows a logout button at the bottom of the sidebar that calls logout when clicked", async () => {
    const logout = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", logout });
    const user = userEvent.setup();
    render(<DiveShell />);

    const logoutBtn = screen.getByTestId("sidebar-logout-btn");
    expect(logoutBtn).toBeInTheDocument();
    await user.click(logoutBtn);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
