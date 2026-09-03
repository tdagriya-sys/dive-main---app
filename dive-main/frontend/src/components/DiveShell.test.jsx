import React from "react";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
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
  // hasSeenWalkthrough: true by default so the new auto-start effect doesn't
  // fire (and isn't asserted on) in every other test in this file that
  // isn't specifically about the walkthrough — see the dedicated describe
  // block below for the auto-start behavior itself.
  user: { id: "u1", name: "Test", hasSeenWalkthrough: true },
  sims: [],
  resetSims: jest.fn(),
  scoreBreakdown: null,
  loadScoreBreakdown: jest.fn(),
  logout: jest.fn(),
  walkthroughOpen: false,
  setWalkthroughOpen: jest.fn(),
  markWalkthroughSeen: jest.fn(),
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

  // Regression guard: a screen's own `absolute inset-0` overlay (e.g. Home's
  // GetStartedPopup) must bind to just this content column, not bubble up to
  // the outer wrapper and center itself across the sidebar's width too.
  it("gives the content column its own `relative` positioning context, separate from the sidebar", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    render(<DiveShell />);
    const contentColumn = screen.getByTestId("sidebar-nav").nextElementSibling;
    expect(contentColumn.className).toContain("relative");
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

// AppHeader (components/AppHeader.jsx) — shown on every authenticated screen,
// including the full-screen add-investment flows, but never during
// onboarding (no real session/user data to show in it yet).
describe("DiveShell — global app header", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the header on a real nav'd screen (Home)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    render(<DiveShell />);
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });

  it("shows the header on a full-screen flow (chooseMethod) too — reachable from any page", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "chooseMethod" });
    render(<DiveShell />);
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });

  it("does NOT show the header during onboarding (signup)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "signup" });
    render(<DiveShell />);
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
  });
});

// ExtensionDownloadCard — same popup, opened from either the header button
// (AppHeader) or the sidebar button (DiveShell's own nav column), so its
// open/close state lives here in their shared parent.
describe("DiveShell — extension download card", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens from the sidebar button", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    expect(screen.queryByTestId("extension-download-card")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sidebar-extension-btn"));
    expect(screen.getByTestId("extension-download-card")).toBeInTheDocument();
  });

  it("opens from the header button too", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("header-extension-btn"));
    expect(screen.getByTestId("extension-download-card")).toBeInTheDocument();
  });

  it("closes on its own close button", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("sidebar-extension-btn"));
    await user.click(screen.getByTestId("extension-download-close-btn"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("extension-download-card"));
  });
});

// Walkthrough (components/Walkthrough.jsx) — auto-starts exactly once ever
// per account (backend-persisted hasSeenWalkthrough, not session/localStorage
// — see User.ts), and is always replayable from the sidebar.
describe("DiveShell — guided walkthrough", () => {
  beforeEach(() => jest.clearAllMocks());

  it("auto-opens on first Home landing when the account has never seen it", () => {
    const setWalkthroughOpen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", setWalkthroughOpen, user: { id: "u1", name: "Test", hasSeenWalkthrough: false } });
    render(<DiveShell />);
    expect(setWalkthroughOpen).toHaveBeenCalledWith(true);
  });

  it("does NOT auto-open once the account has already seen it", () => {
    const setWalkthroughOpen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", setWalkthroughOpen, user: { id: "u1", name: "Test", hasSeenWalkthrough: true } });
    render(<DiveShell />);
    expect(setWalkthroughOpen).not.toHaveBeenCalled();
  });

  it("does NOT auto-open on a screen other than Home", () => {
    const setWalkthroughOpen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "xray", setWalkthroughOpen, user: { id: "u1", name: "Test", hasSeenWalkthrough: false } });
    render(<DiveShell />);
    expect(setWalkthroughOpen).not.toHaveBeenCalled();
  });

  it("the sidebar 'Walkthrough' button opens it manually", async () => {
    const setWalkthroughOpen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", setWalkthroughOpen });
    const user = userEvent.setup();
    render(<DiveShell />);
    await user.click(screen.getByTestId("sidebar-walkthrough-btn"));
    expect(setWalkthroughOpen).toHaveBeenCalledWith(true);
  });

  it("renders <Walkthrough> when walkthroughOpen is true, and finishing/skipping it marks the account seen", async () => {
    const setWalkthroughOpen = jest.fn();
    const markWalkthroughSeen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", holdings: [], walkthroughOpen: true, setWalkthroughOpen, markWalkthroughSeen });
    const user = userEvent.setup();
    render(<DiveShell />);

    expect(screen.getByTestId("walkthrough")).toBeInTheDocument();
    await user.click(screen.getByTestId("walkthrough-skip-btn"));
    expect(markWalkthroughSeen).toHaveBeenCalledTimes(1);
    expect(setWalkthroughOpen).toHaveBeenCalledWith(false);
  });
});
