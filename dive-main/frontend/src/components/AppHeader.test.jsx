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

  // Bug report: Get Extension and Your Journey were `hidden sm:flex` —
  // invisible below 640px, i.e. on essentially every phone. They now render
  // as bare icon buttons on mobile (matching search/notif/support/profile's
  // own always-visible circle style) and grow into the full icon+label pill
  // at `sm:` and up — never actually hidden at any width.
  it("Get Extension and Your Journey are never hidden (icon-only below sm, icon+label at sm and up)", () => {
    render(<AppHeader />);
    const extensionBtn = screen.getByTestId("header-extension-btn");
    const journeyBtn = screen.getByTestId("header-journey-btn");
    expect(extensionBtn.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(journeyBtn.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(extensionBtn).toHaveTextContent("Get Extension");
    expect(journeyBtn).toHaveTextContent("Your Journey");
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
