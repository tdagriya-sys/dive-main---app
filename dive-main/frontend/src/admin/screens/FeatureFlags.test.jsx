import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import FeatureFlags from "./FeatureFlags";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const FLAGS = [
  { id: "f1", key: "new_dashboard", description: "New dashboard layout", enabled: true, rolloutPct: 50, enabledForUserIds: [], enabledForPlanKeys: [], updatedBy: "admin@example.com" },
];

function mockLoadOk(flags = FLAGS) {
  api.get.mockResolvedValue({ data: { flags } });
}

describe("FeatureFlags (admin)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the flags list", async () => {
    mockLoadOk();
    render(<FeatureFlags />);
    expect(screen.getByTestId("admin-flags-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-flags-row-f1")).toBeInTheDocument());
    expect(screen.getByText("new_dashboard")).toBeInTheDocument();
  });

  it("shows an empty state with no flags", async () => {
    mockLoadOk([]);
    render(<FeatureFlags />);
    await waitFor(() => expect(screen.getByTestId("admin-flags-empty")).toBeInTheDocument());
  });

  it("creates a new flag", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { flag: {} } });
    render(<FeatureFlags />);
    await waitFor(() => expect(screen.getByTestId("admin-flags-row-f1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-flags-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-flags-new-key-input"), { target: { value: "early_access" } });
    fireEvent.click(screen.getByTestId("admin-flags-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/feature-flags", { key: "early_access", description: undefined }));
  });

  it("toggles a flag's enabled state (no step-up)", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { flag: {} } });
    render(<FeatureFlags />);
    await waitFor(() => expect(screen.getByTestId("admin-flags-row-f1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-flags-enabled-toggle-f1"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/feature-flags/f1", { enabled: false }));
  });

  it("updates the rollout percentage on blur", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { flag: {} } });
    render(<FeatureFlags />);
    await waitFor(() => expect(screen.getByTestId("admin-flags-row-f1")).toBeInTheDocument());

    const input = screen.getByTestId("admin-flags-rollout-input-f1");
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/feature-flags/f1", { rolloutPct: 80 }));
  });

  it("shows an error state when loading fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<FeatureFlags />);
    await waitFor(() => expect(screen.getByTestId("admin-flags-error")).toBeInTheDocument());
  });
});
