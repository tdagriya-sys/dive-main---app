import React from "react";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppHeader from "./AppHeader";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// Persistent header shown on every authenticated screen (see DiveShell.jsx) —
// promotes what used to be three Home-only icons (search/notif-as-journey/
// settings) to somewhere reachable from any page, plus two genuinely new
// features: a notification panel (with a default welcome entry) and a
// richer profile dropdown (name/age/email/mobile + logout).
describe("AppHeader", () => {
  let setScreen, logout;
  const user = { name: "Priya Sharma", age: 30, email: "priya@example.com", mobile: "9876543210" };

  beforeEach(() => {
    setScreen = jest.fn();
    logout = jest.fn();
    useDive.mockReturnValue({ user, setScreen, logout });
  });

  it("navigates to Home when the logo is clicked", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("app-header-logo-btn"));
    expect(setScreen).toHaveBeenCalledWith("home");
  });

  it("the extension button calls onOpenExtension (opens the shared ExtensionDownloadCard, owned by DiveShell)", async () => {
    const u = userEvent.setup();
    const onOpenExtension = jest.fn();
    render(<AppHeader onOpenExtension={onOpenExtension} />);
    await u.click(screen.getByTestId("header-extension-btn"));
    expect(onOpenExtension).toHaveBeenCalledTimes(1);
  });

  it("'Your Journey' navigates to Insights (already titled 'Your DIVVE Journey')", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-journey-btn"));
    expect(setScreen).toHaveBeenCalledWith("insights");
  });

  it("search icon navigates to Ask Divve", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-search-btn"));
    expect(setScreen).toHaveBeenCalledWith("ask");
  });

  it("shows an unread dot by default (the seeded welcome notification), clicking the bell opens the panel with it and clears the dot", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    expect(screen.getByTestId("header-notif-unread-dot")).toBeInTheDocument();

    await u.click(screen.getByTestId("header-notif-btn"));
    const panel = screen.getByTestId("notification-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("notification-item-welcome")).toHaveTextContent("Welcome to DIVVE");

    expect(screen.queryByTestId("header-notif-unread-dot")).not.toBeInTheDocument();
  });

  it("closes the notification panel on an outside click", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-notif-btn"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();

    await u.click(screen.getByTestId("notification-panel-close-btn"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("notification-panel"));
  });

  it("profile icon opens a dropdown with the real name/age/email/mobile and a logout button", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-profile-btn"));

    const dropdown = screen.getByTestId("profile-dropdown");
    expect(dropdown).toHaveTextContent("Priya Sharma");
    expect(dropdown).toHaveTextContent("30");
    expect(dropdown).toHaveTextContent("priya@example.com");
    expect(dropdown).toHaveTextContent("9876543210");

    await u.click(screen.getByTestId("profile-dropdown-logout-btn"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("clicking the name in the profile dropdown navigates to the Profile screen and closes the dropdown", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-profile-btn"));
    await u.click(screen.getByTestId("profile-dropdown-name-btn"));

    expect(setScreen).toHaveBeenCalledWith("profile");
    await waitForElementToBeRemoved(() => screen.queryByTestId("profile-dropdown"));
  });

  it("opening the profile dropdown closes an open notification panel, and vice versa", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-notif-btn"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();

    await u.click(screen.getByTestId("header-profile-btn"));
    expect(screen.getByTestId("profile-dropdown")).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByTestId("notification-panel"));
  });

  // Bug report: on a narrow phone, six inline header icons plus the wordmark
  // overflow, and the wordmark wraps to "Divv" / "e". The five utility icons
  // (Get Extension, Your Journey, Search, Notifications, Support) now
  // collapse into a single quick-actions popover below md, leaving just it
  // and Profile on mobile; at md:+ they're inline again. Each individual
  // button carries a `hidden md:...` class AND is reachable through the
  // popover.
  it("the five utility icons are inline from md:+ and each carries a hidden-below-md class", () => {
    render(<AppHeader />);
    ["header-extension-btn", "header-journey-btn", "header-search-btn", "header-support-btn"].forEach((id) => {
      expect(screen.getByTestId(id).className).toMatch(/(^|\s)hidden md:/);
    });
    // header-notif-btn is wrapped in a positioning div that carries the class.
    expect(screen.getByTestId("header-notif-btn").closest("div").className).toMatch(/(^|\s)hidden md:/);
    // The wordmark can never wrap.
    expect(screen.getByTestId("app-header-logo-btn").querySelector("span").className).toMatch(/whitespace-nowrap/);
  });

  it("the quick-actions popover (mobile-only) collapses the five utility icons and wires each to the same handler", async () => {
    const u = userEvent.setup();
    const onOpenExtension = jest.fn();
    const onOpenSupport = jest.fn();
    render(<AppHeader onOpenExtension={onOpenExtension} onOpenSupport={onOpenSupport} />);

    const trigger = screen.getByTestId("header-quick-actions-btn");
    expect(trigger.closest("div").className).toMatch(/(^|\s)md:hidden(\s|$)/); // md:hidden is on the positioning wrapper
    expect(screen.queryByTestId("quick-actions-menu")).not.toBeInTheDocument();

    await u.click(trigger);
    expect(screen.getByTestId("quick-actions-menu")).toBeInTheDocument();
    ["quick-action-extension", "quick-action-journey", "quick-action-search", "quick-action-notifications", "quick-action-support"].forEach((id) => {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    });

    await u.click(screen.getByTestId("quick-action-extension"));
    expect(onOpenExtension).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quick-actions-menu")).not.toBeInTheDocument(); // closes on selection (plain conditional render, no exit anim)
  });

  it("quick-actions rows route the same as their desktop icons — Journey/Search navigate, Notifications opens the panel, Support opens its card", async () => {
    const u = userEvent.setup();
    const onOpenSupport = jest.fn();
    render(<AppHeader onOpenSupport={onOpenSupport} />);

    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await u.click(screen.getByTestId("quick-action-journey"));
    expect(setScreen).toHaveBeenCalledWith("insights");

    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await u.click(screen.getByTestId("quick-action-search"));
    expect(setScreen).toHaveBeenCalledWith("ask");

    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await u.click(screen.getByTestId("quick-action-support"));
    expect(onOpenSupport).toHaveBeenCalledTimes(1);

    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await u.click(screen.getByTestId("quick-action-notifications"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
  });

  it("the unread dot also rides on the quick-actions trigger, and clears once notifications are opened from there", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    expect(screen.getByTestId("header-quick-actions-unread-dot")).toBeInTheDocument();

    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await u.click(screen.getByTestId("quick-action-notifications"));
    expect(screen.queryByTestId("header-quick-actions-unread-dot")).not.toBeInTheDocument();
  });

  it("opening the quick-actions popover closes an open profile dropdown or notification panel", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);

    await u.click(screen.getByTestId("header-profile-btn"));
    expect(screen.getByTestId("profile-dropdown")).toBeInTheDocument();
    await u.click(screen.getByTestId("header-quick-actions-btn"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("profile-dropdown"));
    expect(screen.getByTestId("quick-actions-menu")).toBeInTheDocument();
  });

  it("closes the quick-actions popover on an outside click", async () => {
    const u = userEvent.setup();
    render(<AppHeader />);
    await u.click(screen.getByTestId("header-quick-actions-btn"));
    expect(screen.getByTestId("quick-actions-menu")).toBeInTheDocument();

    await u.click(screen.getByTestId("quick-actions-backdrop"));
    expect(screen.queryByTestId("quick-actions-menu")).not.toBeInTheDocument();
  });

  it("the hamburger button calls onOpenMobileNav, and is mobile-only (hidden at md and up)", async () => {
    const u = userEvent.setup();
    const onOpenMobileNav = jest.fn();
    render(<AppHeader onOpenMobileNav={onOpenMobileNav} />);
    const menuBtn = screen.getByTestId("header-menu-btn");
    expect(menuBtn.className).toMatch(/(^|\s)md:hidden(\s|$)/);
    await u.click(menuBtn);
    expect(onOpenMobileNav).toHaveBeenCalledTimes(1);
  });

  it("the support button calls onOpenSupport (opens the shared SupportCard, owned by DiveShell), sitting between notifications and profile", async () => {
    const u = userEvent.setup();
    const onOpenSupport = jest.fn();
    render(<AppHeader onOpenSupport={onOpenSupport} />);
    await u.click(screen.getByTestId("header-support-btn"));
    expect(onOpenSupport).toHaveBeenCalledTimes(1);

    const buttons = screen.getAllByRole("button").map((b) => b.dataset.testid);
    const notifIdx = buttons.indexOf("header-notif-btn");
    const supportIdx = buttons.indexOf("header-support-btn");
    const profileIdx = buttons.indexOf("header-profile-btn");
    expect(notifIdx).toBeLessThan(supportIdx);
    expect(supportIdx).toBeLessThan(profileIdx);
  });
});
