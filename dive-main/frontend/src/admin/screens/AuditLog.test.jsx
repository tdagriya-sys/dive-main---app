import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { api } from "../../lib/api";
import AuditLog from "./AuditLog";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn() } }));

const PAGE = {
  entries: [
    { action: "scoring_config.publish", actorLabel: "boss@divve.in", resourceType: "ScoringConfig", resourceId: "v2", ts: "2026-01-01T00:00:00.000Z" },
  ],
  page: 1,
  limit: 50,
  total: 1,
  totalPages: 1,
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/audit" element={<AuditLog />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("admin AuditLog", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads and renders audit entries", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    renderAt("/admin/audit");
    await waitFor(() => expect(screen.getByTestId("admin-audit-table")).toBeInTheDocument());
    expect(screen.getByText("scoring_config.publish")).toBeInTheDocument();
    expect(screen.getByText("boss@divve.in")).toBeInTheDocument();
  });

  it("shows an empty state with no entries", async () => {
    api.get.mockResolvedValue({ data: { entries: [], page: 1, limit: 50, total: 0, totalPages: 1 } });
    renderAt("/admin/audit");
    await waitFor(() => expect(screen.getByTestId("admin-audit-empty")).toBeInTheDocument());
  });

  it("shows an error state when the request fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    renderAt("/admin/audit");
    await waitFor(() => expect(screen.getByTestId("admin-audit-error")).toBeInTheDocument());
  });

  it("passes no actorId param when the URL has none", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    renderAt("/admin/audit");
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith("/admin/audit", { params: { page: 1, limit: 50, actorId: undefined } });
  });

  it("filters by actorId from the URL and shows a clear-filter banner with the actor label", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    renderAt("/admin/audit?actorId=u1&actorLabel=someone%40example.com");
    await waitFor(() => expect(screen.getByTestId("admin-audit-actor-filter")).toBeInTheDocument());
    expect(screen.getByTestId("admin-audit-actor-filter")).toHaveTextContent("someone@example.com");
    expect(api.get).toHaveBeenCalledWith("/admin/audit", { params: { page: 1, limit: 50, actorId: "u1" } });
  });

  it("clearing the actor filter navigates back to the unfiltered audit log", async () => {
    api.get.mockResolvedValue({ data: PAGE });
    renderAt("/admin/audit?actorId=u1&actorLabel=someone%40example.com");
    await waitFor(() => expect(screen.getByTestId("admin-audit-clear-actor-btn")).toBeInTheDocument());

    api.get.mockClear();
    fireEvent.click(screen.getByTestId("admin-audit-clear-actor-btn"));

    await waitFor(() => expect(screen.queryByTestId("admin-audit-actor-filter")).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith("/admin/audit", { params: { page: 1, limit: 50, actorId: undefined } });
  });
});
