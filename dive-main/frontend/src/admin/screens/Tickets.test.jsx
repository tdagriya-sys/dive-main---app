import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../lib/api";
import Tickets from "./Tickets";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn() } }));

const TICKETS = [
  { id: "t1", refNo: "DIV-000001", subject: "Can't log in", requesterName: "Ada", priority: "high", status: "open", slaBreached: true, callbackRequested: { done: false } },
  { id: "t2", refNo: "DIV-000002", subject: "Billing question", requesterName: "Bob", priority: "normal", status: "resolved", slaBreached: false },
];

function renderComponent() {
  return render(
    <MemoryRouter>
      <Tickets />
    </MemoryRouter>
  );
}

describe("Tickets (admin inbox)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the ticket table", async () => {
    api.get.mockResolvedValue({ data: { tickets: TICKETS } });
    renderComponent();
    expect(screen.getByTestId("admin-tickets-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-tickets-table")).toBeInTheDocument());
    expect(screen.getByText("Can't log in")).toBeInTheDocument();
    expect(screen.getByText("Billing question")).toBeInTheDocument();
  });

  it("shows an SLA-overdue flag and a callback flag where relevant", async () => {
    api.get.mockResolvedValue({ data: { tickets: TICKETS } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-tickets-table")).toBeInTheDocument());
    expect(screen.getByTestId("admin-tickets-sla-breach-t1")).toBeInTheDocument();
    expect(screen.getByTestId("admin-tickets-callback-flag-t1")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-tickets-sla-breach-t2")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    api.get.mockResolvedValue({ data: { tickets: [] } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-tickets-empty")).toBeInTheDocument());
  });

  it("re-queries with the selected status filter", async () => {
    api.get.mockResolvedValue({ data: { tickets: TICKETS } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-tickets-table")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-tickets-status-filter"), { target: { value: "resolved" } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/admin/tickets", { params: { status: "resolved" } }));
  });

  it("links to the categories & canned responses settings screen", async () => {
    api.get.mockResolvedValue({ data: { tickets: [] } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-tickets-empty")).toBeInTheDocument());
    expect(screen.getByTestId("admin-tickets-settings-link")).toHaveAttribute("href", "/admin/ticket-settings");
  });
});
