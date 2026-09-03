import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Preferences from "./Preferences";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));
jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));

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
