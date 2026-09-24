import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import SystemHealth from "./SystemHealth";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), patch: jest.fn() } }));

const SETTINGS = { announcement: { text: "", level: "info", enabled: false, dismissible: true }, maintenance: { enabled: false, message: "" } };

function mockLoadOk(overrides = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/admin/system/health") return Promise.resolve({ data: { status: "ok", db: "connected", redis: "connected", uptimeSeconds: 600 } });
    if (path === "/admin/system/integrations") return Promise.resolve({ data: { email: "live", openai: "mock", razorpay: "mock" } });
    if (path === "/admin/system/jobs")
      return Promise.resolve({
        data: { latestPerJob: [{ job: "instrumentRefresh", startedAt: "2026-01-01T00:00:00.000Z", ok: true }], recentRuns: [] },
      });
    if (path === "/admin/system/webhooks") return Promise.resolve({ data: { events: [{ eventType: "payment.captured", processedOk: true }] } });
    if (path === "/admin/system/settings") return Promise.resolve({ data: overrides.settings || SETTINGS });
    return Promise.reject(new Error("unexpected path " + path));
  });
}

describe("admin SystemHealth", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads all sections (health, integrations, jobs, webhooks, settings) in parallel", async () => {
    mockLoadOk();
    render(<SystemHealth />);
    await waitFor(() => expect(screen.getByTestId("admin-system-screen")).toBeInTheDocument());
    expect(screen.getByTestId("admin-system-health-card")).toHaveTextContent("DB: connected");
    expect(screen.getByTestId("admin-system-integrations-card")).toHaveTextContent("openai: mock");
    expect(screen.getByTestId("admin-system-jobs-card")).toHaveTextContent("instrumentRefresh");
    expect(screen.getByTestId("admin-system-webhooks-card")).toHaveTextContent("payment.captured");
  });

  it("shows an error state if any request fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<SystemHealth />);
    await waitFor(() => expect(screen.getByTestId("admin-system-error")).toBeInTheDocument());
  });

  it("saves an updated announcement", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { announcement: { text: "Hello", level: "warning", enabled: true, dismissible: true } } });
    render(<SystemHealth />);
    await waitFor(() => expect(screen.getByTestId("admin-system-announcement-card")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-announcement-text-input"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByTestId("admin-announcement-level-select"), { target: { value: "warning" } });
    fireEvent.click(screen.getByTestId("admin-announcement-enabled-toggle"));
    fireEvent.click(screen.getByTestId("admin-announcement-save-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/system/settings/announcement", { text: "Hello", level: "warning", enabled: true, dismissible: true }));
  });

  it("saves an updated maintenance setting", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { maintenance: { enabled: true, message: "Down for a bit" } } });
    render(<SystemHealth />);
    await waitFor(() => expect(screen.getByTestId("admin-system-maintenance-card")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-maintenance-message-input"), { target: { value: "Down for a bit" } });
    fireEvent.click(screen.getByTestId("admin-maintenance-enabled-toggle"));
    fireEvent.click(screen.getByTestId("admin-maintenance-save-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/system/settings/maintenance", { enabled: true, message: "Down for a bit" }));
  });
});
