import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { api } from "../../lib/api";
import TicketDetail from "./TicketDetail";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const DETAIL = {
  ticket: {
    id: "t1",
    refNo: "DIV-000001",
    subject: "Can't log in",
    status: "open",
    priority: "normal",
    requesterName: "Ada",
    requesterEmail: "ada@example.com",
    requesterMobile: "9876543210",
    assigneeId: undefined,
    tags: ["urgent-case"],
    slaDueAt: new Date(Date.now() - 1000).toISOString(),
    callbackRequested: { mobile: "9876543210", preferredWindow: "Evening", done: false },
  },
  messages: [
    { id: "m1", authorType: "requester", authorLabel: "Ada", body: "Help please", isInternalNote: false, createdAt: new Date().toISOString() },
  ],
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/tickets/:id" element={<TicketDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockLoadOk(overrides = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/tickets/t1") return Promise.resolve({ data: { ...DETAIL, ...overrides } });
    if (url === "/admin/tickets/staff") return Promise.resolve({ data: { staff: [{ id: "s1", name: "Staffer", email: "staff@example.com" }] } });
    if (url === "/admin/canned-responses") return Promise.resolve({ data: { cannedResponses: [{ id: "c1", title: "Greeting", body: "Hello there!" }] } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("TicketDetail (admin)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the ticket, its SLA-overdue badge, and the callback banner", async () => {
    mockLoadOk();
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByText("DIV-000001")).toBeInTheDocument());
    expect(screen.getByTestId("admin-ticket-detail-sla-breach")).toBeInTheDocument();
    expect(screen.getByTestId("admin-ticket-detail-callback-banner")).toHaveTextContent("9876543210");
  });

  it("sends a reply", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { message: { id: "m2" } } });
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-reply-input")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-ticket-detail-reply-input"), { target: { value: "We're looking into it." } });
    fireEvent.click(screen.getByTestId("admin-ticket-detail-send-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/tickets/t1/messages", { body: "We're looking into it.", isInternalNote: false }));
  });

  it("inserts a canned response into the reply box", async () => {
    mockLoadOk();
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-canned-select")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("admin-ticket-detail-canned-select"), { target: { value: "c1" } });
    expect(screen.getByTestId("admin-ticket-detail-reply-input")).toHaveValue("Hello there!");
  });

  it("changes status, priority, and assignee", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: {} });
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-status-resolved-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-ticket-detail-status-resolved-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/tickets/t1", { status: "resolved" }));

    fireEvent.change(screen.getByTestId("admin-ticket-detail-priority-select"), { target: { value: "urgent" } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/tickets/t1", { priority: "urgent" }));

    fireEvent.change(screen.getByTestId("admin-ticket-detail-assignee-select"), { target: { value: "s1" } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/tickets/t1", { assigneeId: "s1" }));
  });

  it("shows an inline error when assignment is forbidden (missing tickets.assign)", async () => {
    mockLoadOk();
    api.patch.mockRejectedValue({ response: { data: { message: "Missing permission: tickets.assign" } } });
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-assignee-select")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("admin-ticket-detail-assignee-select"), { target: { value: "s1" } });
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-action-error")).toHaveTextContent("tickets.assign"));
  });

  it("marks a callback request done", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { callbackRequested: { done: true } } });
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-callback-done-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-ticket-detail-callback-done-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/tickets/t1/callback/done", { done: true }));
  });

  it("merges into another ticket and navigates to it", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { source: {}, target: {} } });
    renderAt("/admin/tickets/t1");
    await waitFor(() => expect(screen.getByTestId("admin-ticket-detail-merge-input")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("admin-ticket-detail-merge-input"), { target: { value: "t2" } });
    fireEvent.click(screen.getByTestId("admin-ticket-detail-merge-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/tickets/t1/merge", { targetTicketId: "t2" }));
  });
});
