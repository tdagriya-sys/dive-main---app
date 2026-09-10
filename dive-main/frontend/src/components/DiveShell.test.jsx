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

  it("shows the sidebar nav and the mobile menu hamburger on a real nav'd screen (Home)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    render(<DiveShell />);

    expect(screen.getByTestId("sidebar-nav")).toBeInTheDocument();
    expect(screen.getByTestId("header-menu-btn")).toBeInTheDocument();
    ["home", "xray", "suggestions", "planner", "profile"].forEach((id) => {
      expect(screen.getByTestId(`sidebar-nav-${id}`)).toBeInTheDocument();
    });
  });

  // Regression guard: a screen's own `absolute inset-0` overlay must bind to
  // just this content column, not bubble up to the outer wrapper and center
  // itself across the sidebar's width too. (Full-screen SHEETS — WhatIfSheet,
  // MarketStressSheet, ShareCard, GetStartedPopup, ExtensionDownloadCard —
  // no longer rely on this at all; they're portaled to `document.body` and
  // fixed-positioned there instead, precisely because this column's own
  // scrolling would otherwise drag them along even as `position: fixed`.)
  it("gives the content column its own `relative` positioning context, separate from the sidebar", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    render(<DiveShell />);
    const contentColumn = screen.getByTestId("sidebar-nav").nextElementSibling;
    expect(contentColumn.className).toContain("relative");
  });

  // On a short viewport (landscape phone/tablet, shrunk desktop window) the
  // nav items + the Walkthrough/Get Extension/Support/Log out buttons below
  // them can exceed the column height — both the sidebar and the mobile
  // drawer must scroll rather than clip "Log out" off the bottom.
  it("the sidebar scrolls its own overflow instead of clipping the bottom action buttons", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);
    expect(screen.getByTestId("sidebar-nav").className).toMatch(/overflow-y-auto/);
    await user.click(screen.getByTestId("header-menu-btn"));
    expect(screen.getByTestId("mobile-nav-drawer").className).toMatch(/overflow-y-auto/);
  });

  it("shows no sidebar on a full-screen flow (chooseMethod) or during onboarding (signup)", () => {
    useDive.mockReturnValue({ ...baseContext, screen: "chooseMethod" });
    const { rerender } = render(<DiveShell />);
    expect(screen.queryByTestId("sidebar-nav")).not.toBeInTheDocument();

    useDive.mockReturnValue({ ...baseContext, screen: "signup" });
    rerender(<DiveShell />);
    expect(screen.queryByTestId("sidebar-nav")).not.toBeInTheDocument();
  });

  it("navigates when a sidebar item is clicked", async () => {
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

// Mobile off-canvas nav drawer (Phase 4) — replaces the old bottom nav bar,
// which only ever showed ~20-30% of itself above the real fold on a phone
// browser (a `h-screen`/100vh viewport bug, fixed separately in App.js) and
// had no room for anything beyond the 5 NAV items anyway. Opened from
// AppHeader's hamburger (header-menu-btn), it carries the exact same links
// as the desktop sidebar, plus Walkthrough/Get Extension/Support/Log out.
describe("DiveShell — mobile nav drawer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is closed by default and opens from the header hamburger button", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    expect(screen.queryByTestId("mobile-nav-drawer")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("header-menu-btn"));
    expect(screen.getByTestId("mobile-nav-drawer")).toBeInTheDocument();
  });

  it("carries every nav link and action the desktop sidebar has", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);
    await user.click(screen.getByTestId("header-menu-btn"));

    ["home", "xray", "suggestions", "planner", "profile"].forEach((id) => {
      expect(screen.getByTestId(`mobile-nav-${id}`)).toBeInTheDocument();
    });
    ["walkthrough", "extension", "support", "logout"].forEach((action) => {
      expect(screen.getByTestId(`mobile-${action}-btn`)).toBeInTheDocument();
    });
  });

  it("navigating from the drawer changes screen and closes it", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", setScreen });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("header-menu-btn"));
    await user.click(screen.getByTestId("mobile-nav-xray"));

    expect(setScreen).toHaveBeenCalledWith("xray");
    await waitForElementToBeRemoved(() => screen.queryByTestId("mobile-nav-drawer"));
  });

  it("closes on its own close button and on a backdrop click", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("header-menu-btn"));
    await user.click(screen.getByTestId("mobile-nav-close-btn"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("mobile-nav-drawer"));

    await user.click(screen.getByTestId("header-menu-btn"));
    await user.click(screen.getByTestId("mobile-nav-backdrop"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("mobile-nav-drawer"));
  });

  it("logging out from the drawer calls logout the same as the desktop sidebar", async () => {
    const logout = jest.fn();
    useDive.mockReturnValue({ ...baseContext, screen: "home", logout });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("header-menu-btn"));
    await user.click(screen.getByTestId("mobile-logout-btn"));
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

// SupportCard — same popup, opened from either the header button
// (AppHeader) or the sidebar button (DiveShell's own nav column), so its
// open/close state lives here in their shared parent (same pattern as
// ExtensionDownloadCard above).
describe("DiveShell — support card", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens from the sidebar button", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    expect(screen.queryByTestId("support-card")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sidebar-support-btn"));
    expect(screen.getByTestId("support-card")).toBeInTheDocument();
  });

  it("opens from the header button too", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("header-support-btn"));
    expect(screen.getByTestId("support-card")).toBeInTheDocument();
  });

  it("closes on its own close button", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "home" });
    const user = userEvent.setup();
    render(<DiveShell />);

    await user.click(screen.getByTestId("sidebar-support-btn"));
    await user.click(screen.getByTestId("support-close-btn"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("support-card"));
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
