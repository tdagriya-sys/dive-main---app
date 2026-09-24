import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../lib/api";
import AppSettingsGate from "./AppSettingsGate";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));

describe("AppSettingsGate", () => {
  afterEach(() => jest.clearAllMocks());

  it("renders children while settings are still loading", () => {
    api.get.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });

  it("renders children plainly when both are off", async () => {
    api.get.mockResolvedValue({ data: { announcement: { enabled: false, text: "", level: "info", dismissible: true }, maintenance: { enabled: false, message: "" } } });
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/app-settings"));
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.queryByTestId("announcement-banner")).not.toBeInTheDocument();
  });

  it("shows the maintenance gate INSTEAD of children when maintenance is enabled", async () => {
    api.get.mockResolvedValue({ data: { announcement: { enabled: false, text: "", level: "info", dismissible: true }, maintenance: { enabled: true, message: "Back soon." } } });
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    await waitFor(() => expect(screen.getByTestId("maintenance-gate")).toBeInTheDocument());
    expect(screen.getByText("Back soon.")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });

  it("shows a dismissible announcement banner above the children", async () => {
    api.get.mockResolvedValue({ data: { announcement: { enabled: true, text: "New feature!", level: "info", dismissible: true }, maintenance: { enabled: false, message: "" } } });
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    await waitFor(() => expect(screen.getByTestId("announcement-banner")).toBeInTheDocument());
    expect(screen.getByText("New feature!")).toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("announcement-dismiss-btn"));
    expect(screen.queryByTestId("announcement-banner")).not.toBeInTheDocument();
  });

  it("hides the dismiss button when the announcement isn't dismissible", async () => {
    api.get.mockResolvedValue({ data: { announcement: { enabled: true, text: "Mandatory notice", level: "critical", dismissible: false }, maintenance: { enabled: false, message: "" } } });
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    await waitFor(() => expect(screen.getByTestId("announcement-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("announcement-dismiss-btn")).not.toBeInTheDocument();
  });

  it("renders children normally if the settings fetch fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<AppSettingsGate><div data-testid="app-content" /></AppSettingsGate>);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });
});
