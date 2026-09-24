import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import DataRequests from "./DataRequests";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const PENDING_EXPORT = { id: "r1", userEmailSnapshot: "user@example.com", type: "export", status: "pending", requestedAt: "2026-01-01T00:00:00.000Z" };
const PENDING_DELETE = { id: "r2", userEmailSnapshot: "user2@example.com", type: "delete", status: "pending", requestedAt: "2026-01-02T00:00:00.000Z" };

function mockLoadOk(requests = [PENDING_EXPORT]) {
  api.get.mockResolvedValue({ data: { requests } });
}

describe("DataRequests (admin)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the requests table", async () => {
    mockLoadOk();
    render(<DataRequests />);
    expect(screen.getByTestId("admin-datarequests-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("shows an empty state with no requests", async () => {
    mockLoadOk([]);
    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-empty")).toBeInTheDocument());
  });

  it("fulfils an export, prompting for step-up when required", async () => {
    mockLoadOk();
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }).mockResolvedValueOnce({ data: { profile: {} } });
    // jsdom has no real Blob/URL.createObjectURL by default in this test env
    window.URL.createObjectURL = jest.fn(() => "blob:mock");
    window.URL.revokeObjectURL = jest.fn();

    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-datarequests-fulfil-export-btn-r1"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("fulfils a deletion request with step-up", async () => {
    mockLoadOk([PENDING_DELETE]);
    api.post.mockResolvedValue({ data: { request: { id: "r2", status: "fulfilled" } } });
    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-datarequests-fulfil-delete-btn-r2"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/data-requests/r2/fulfil-delete", {}, expect.anything()));
  });

  it("rejects a pending request after prompting for a reason", async () => {
    mockLoadOk();
    window.prompt = jest.fn(() => "Could not verify identity");
    api.post.mockResolvedValue({ data: { request: { id: "r1", status: "rejected" } } });
    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-datarequests-reject-btn-r1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/data-requests/r1/reject", { reason: "Could not verify identity" }));
  });

  it("does not reject when the prompt is cancelled", async () => {
    mockLoadOk();
    window.prompt = jest.fn(() => null);
    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-datarequests-reject-btn-r1"));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("filters by status", async () => {
    mockLoadOk();
    render(<DataRequests />);
    await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-datarequests-status-filter"), { target: { value: "fulfilled" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/data-requests", { params: { status: "fulfilled" } }));
  });

  // Fixes a real gap: fulfilDeleteRequest previously had no reachable path
  // (nothing ever created a pending "delete" row for a request that arrived
  // outside the app, e.g. by email) — this form is that missing entry point.
  describe("logging a request that arrived outside the app", () => {
    it("submits email + type and reloads the list", async () => {
      mockLoadOk();
      api.post.mockResolvedValue({ data: { request: { id: "r3", status: "pending" } } });
      render(<DataRequests />);
      await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-datarequests-log-toggle-btn"));
      fireEvent.change(screen.getByTestId("admin-datarequests-log-email-input"), { target: { value: "someone@example.com" } });
      fireEvent.change(screen.getByTestId("admin-datarequests-log-type-select"), { target: { value: "delete" } });
      fireEvent.click(screen.getByTestId("admin-datarequests-log-submit-btn"));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/data-requests", { email: "someone@example.com", type: "delete" }));
      // Reloaded the list, closing the form.
      await waitFor(() => expect(screen.queryByTestId("admin-datarequests-log-email-input")).not.toBeInTheDocument());
    });

    it("shows an error and keeps the form open when logging fails", async () => {
      mockLoadOk();
      api.post.mockRejectedValue({ response: { data: { message: "No account found with that email." } } });
      render(<DataRequests />);
      await waitFor(() => expect(screen.getByTestId("admin-datarequests-table")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-datarequests-log-toggle-btn"));
      fireEvent.change(screen.getByTestId("admin-datarequests-log-email-input"), { target: { value: "nobody@example.com" } });
      fireEvent.click(screen.getByTestId("admin-datarequests-log-submit-btn"));

      expect(await screen.findByText("No account found with that email.")).toBeInTheDocument();
      expect(screen.getByTestId("admin-datarequests-log-email-input")).toBeInTheDocument();
    });
  });
});
