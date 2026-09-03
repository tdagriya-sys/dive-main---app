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
});
