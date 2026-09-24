import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Preferences from "./Preferences";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));
jest.mock("../lib/api", () => ({ api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));

// Preferences' resilience-score PDF download now shares its fetch/blob/
// download logic and label with Home.jsx via lib/useDownloadReport.js —
// regression guard that the rename and the shared hook both actually work
// here too, not just on Home.
describe("Preferences — resilience score report download", () => {
  const baseContext = {
    user: { name: "Test User", age: 30, email: "test@example.com", mobile: "9876543210" },
    prefs: { risk: "Balanced", returnExpectation: "Moderate", diversificationPriority: "Medium", preferred: [], excluded: [] },
    savePrefs: jest.fn(),
    logout: jest.fn(),
    setScreen: jest.fn(),
    deleteAccount: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    refreshEntitlements: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue(baseContext);
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  // The button's own markup/pricing copy/badge is tested once, thoroughly,
  // in lib/useDownloadReport.test.js (DownloadReportButton) — this just
  // confirms Preferences actually renders that shared component and it's
  // wired to a real download here too, not a copy that could drift.
  it("renders the shared DownloadReportButton and downloads the real PDF", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: new Blob(["fake pdf bytes"]) });
    render(<Preferences />);

    await user.click(screen.getByTestId("prefs-download-report-btn"));
    expect(api.get).toHaveBeenCalledWith("/score/breakdown/pdf", { responseType: "blob" });
  });

  it("shows an error and re-enables the button when the download fails", async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue(new Error("network error"));
    render(<Preferences />);

    await user.click(screen.getByTestId("prefs-download-report-btn"));
    expect(await screen.findByText(/Couldn't generate your report/i)).toBeInTheDocument();
    expect(screen.getByTestId("prefs-download-report-btn")).not.toBeDisabled();
  });
});

// Phase 5 of docs/ADMIN_PANEL_PLAN.md — the notification-preferences
// section, backed by GET/PATCH /notifications/preferences.
describe("Preferences — notification preferences", () => {
  const baseContext = {
    user: { name: "Test User", age: 30, email: "test@example.com", mobile: "9876543210" },
    prefs: { risk: "Balanced", returnExpectation: "Moderate", diversificationPriority: "Medium", preferred: [], excluded: [] },
    savePrefs: jest.fn(),
    logout: jest.fn(),
    setScreen: jest.fn(),
    deleteAccount: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    refreshEntitlements: jest.fn(),
  };
  const PREFS = [
    { categoryKey: "account", label: "Account", userOptOutAllowed: false, channels: [{ channel: "in_app", enabled: true }, { channel: "email", enabled: true }] },
    { categoryKey: "marketing", label: "Marketing", userOptOutAllowed: true, channels: [{ channel: "in_app", enabled: true }, { channel: "email", enabled: true }, { channel: "popup", enabled: false }] },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue(baseContext);
    api.get.mockImplementation((url) => {
      if (url === "/notifications/preferences") return Promise.resolve({ data: { preferences: PREFS } });
      return Promise.resolve({ data: new Blob(["x"]) });
    });
  });

  it("renders every category, locking the toggle for one that doesn't allow opt-out", async () => {
    render(<Preferences />);
    await screen.findByTestId("notification-pref-row-account");
    expect(screen.getByTestId("notification-pref-account-email")).toBeDisabled();
    expect(screen.getByTestId("notification-pref-marketing-email")).not.toBeDisabled();
  });

  it("toggling a channel calls PATCH with the right payload", async () => {
    const user = userEvent.setup();
    api.patch.mockResolvedValue({ data: { ok: true } });
    render(<Preferences />);
    await screen.findByTestId("notification-pref-row-marketing");

    await user.click(screen.getByTestId("notification-pref-marketing-email"));
    expect(api.patch).toHaveBeenCalledWith("/notifications/preferences", { categoryKey: "marketing", channel: "email", enabled: false });
  });

  it("labels the popup channel distinctly and can opt into it", async () => {
    const user = userEvent.setup();
    api.patch.mockResolvedValue({ data: { ok: true } });
    render(<Preferences />);
    await screen.findByTestId("notification-pref-row-marketing");

    const popupToggle = screen.getByTestId("notification-pref-marketing-popup");
    expect(popupToggle).not.toBeChecked();
    expect(popupToggle.closest("label")).toHaveTextContent("Pop-up");

    await user.click(popupToggle);
    expect(api.patch).toHaveBeenCalledWith("/notifications/preferences", { categoryKey: "marketing", channel: "popup", enabled: true });
  });

  it("reverts the toggle and shows an error if the save fails", async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValue(new Error("network error"));
    render(<Preferences />);
    await screen.findByTestId("notification-pref-row-marketing");

    await user.click(screen.getByTestId("notification-pref-marketing-email"));
    await screen.findByTestId("notification-prefs-error");
    expect(screen.getByTestId("notification-pref-marketing-email")).toBeChecked();
  });
});

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §7 — the entry point into the new
// Subscription screen.
describe("Preferences — manage subscription button", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue({ data: { preferences: [] } });
  });

  it("navigates to the Subscription screen", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({
      user: { name: "Test User", age: 30, email: "test@example.com", mobile: "9876543210" },
      prefs: { risk: "Balanced", returnExpectation: "Moderate", diversificationPriority: "Medium", preferred: [], excluded: [] },
      savePrefs: jest.fn(),
      logout: jest.fn(),
      setScreen,
      deleteAccount: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
    refreshEntitlements: jest.fn(),
    });
    const user = userEvent.setup();
    render(<Preferences />);
    await user.click(screen.getByTestId("prefs-manage-subscription-btn"));
    expect(setScreen).toHaveBeenCalledWith("subscription");
  });
});

// Phase 7 of docs/ADMIN_PANEL_PLAN.md §4.6/§11 — DPDP data-export request.
describe("Preferences — request my data export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue({ data: { preferences: [] } });
    useDive.mockReturnValue({
      user: { name: "Test User", age: 30, email: "test@example.com", mobile: "9876543210" },
      prefs: { risk: "Balanced", returnExpectation: "Moderate", diversificationPriority: "Medium", preferred: [], excluded: [] },
      savePrefs: jest.fn(),
      logout: jest.fn(),
      setScreen: jest.fn(),
      deleteAccount: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
    refreshEntitlements: jest.fn(),
    });
  });

  it("submits a request and shows a confirmation instead of the button", async () => {
    api.post.mockResolvedValue({ data: { id: "r1", status: "pending" } });
    const user = userEvent.setup();
    render(<Preferences />);
    await user.click(screen.getByTestId("request-data-export-btn"));
    expect(api.post).toHaveBeenCalledWith("/users/me/data-export-request");
    expect(await screen.findByTestId("data-export-requested-note")).toBeInTheDocument();
    expect(screen.queryByTestId("request-data-export-btn")).not.toBeInTheDocument();
  });

  it("shows an error if the request fails", async () => {
    api.post.mockRejectedValue({ response: { data: { message: "You already have a pending data export request." } } });
    const user = userEvent.setup();
    render(<Preferences />);
    await user.click(screen.getByTestId("request-data-export-btn"));
    expect(await screen.findByText("You already have a pending data export request.")).toBeInTheDocument();
  });
});
