import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupportCard from "./SupportCard";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));
jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// Phase 4 of docs/ADMIN_PANEL_PLAN.md — SupportCard now creates a real
// Ticket (POST /tickets) and lets the user follow/reply to it, replacing
// the earlier mailto-only design (see the component's own comment).
describe("SupportCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({ user: { name: "Priya Sharma", email: "priya@example.com", mobile: "9876543210" } });
  });

  it("submits a new ticket and shows the confirmation with its refNo", async () => {
    api.post.mockResolvedValue({ data: { ticket: { id: "t1", refNo: "DIV-000001", status: "open" } } });
    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);

    await u.type(screen.getByTestId("support-subject-input"), "Can't connect my broker");
    await u.type(screen.getByTestId("support-description-input"), "It just spins forever.");
    await u.click(screen.getByTestId("support-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("support-ticket-success")).toBeInTheDocument());
    expect(screen.getByText("Ticket DIV-000001 created")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/tickets", expect.objectContaining({ subject: "Can't connect my broker", description: "It just spins forever.", requestCallback: false }));
  });

  it("requires a mobile number before submitting when requesting a callback, and prefills it from the user", async () => {
    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.click(screen.getByTestId("support-callback-checkbox"));
    expect(screen.getByTestId("support-callback-mobile-input")).toHaveValue("9876543210");
  });

  it("shows the backend's error message on a failed submission", async () => {
    api.post.mockRejectedValue({ response: { data: { message: "Something went wrong" } } });
    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.type(screen.getByTestId("support-subject-input"), "Subject");
    await u.type(screen.getByTestId("support-description-input"), "Description");
    await u.click(screen.getByTestId("support-submit-btn"));
    await waitFor(() => expect(screen.getByTestId("support-error")).toHaveTextContent("Something went wrong"));
  });

  it("switches to My tickets and lists the caller's own tickets", async () => {
    api.get.mockResolvedValue({ data: { tickets: [{ id: "t1", refNo: "DIV-000001", subject: "Help", status: "pending" }] } });
    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.click(screen.getByTestId("support-tab-mine-btn"));
    await waitFor(() => expect(screen.getByTestId("support-my-tickets-list")).toBeInTheDocument());
    expect(screen.getByText("DIV-000001")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tickets yet", async () => {
    api.get.mockResolvedValue({ data: { tickets: [] } });
    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.click(screen.getByTestId("support-tab-mine-btn"));
    await waitFor(() => expect(screen.getByTestId("support-my-tickets-empty")).toBeInTheDocument());
  });

  it("opens a ticket's conversation, sends a reply, and never shows a rating panel while still open", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/tickets") return Promise.resolve({ data: { tickets: [{ id: "t1", refNo: "DIV-000001", subject: "Help", status: "open" }] } });
      return Promise.resolve({
        data: {
          ticket: { id: "t1", refNo: "DIV-000001", subject: "Help", status: "open", csatScore: null },
          messages: [{ id: "m1", authorType: "requester", authorLabel: "You", body: "Original message", createdAt: new Date().toISOString() }],
        },
      });
    });
    api.post.mockResolvedValue({ data: { message: { id: "m2" } } });

    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.click(screen.getByTestId("support-tab-mine-btn"));
    await waitFor(() => screen.getByTestId("support-ticket-row-t1"));
    await u.click(screen.getByTestId("support-ticket-row-t1"));

    await waitFor(() => expect(screen.getByTestId("support-ticket-detail")).toBeInTheDocument());
    expect(screen.queryByTestId("support-csat-panel")).not.toBeInTheDocument();

    await u.type(screen.getByTestId("support-reply-input"), "Any update?");
    await u.click(screen.getByTestId("support-reply-send-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/tickets/t1/messages", { body: "Any update?" }));
  });

  it("shows a rating panel for a resolved ticket that hasn't been rated yet", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/tickets") return Promise.resolve({ data: { tickets: [{ id: "t1", refNo: "DIV-000001", subject: "Help", status: "resolved" }] } });
      return Promise.resolve({
        data: {
          ticket: { id: "t1", refNo: "DIV-000001", subject: "Help", status: "resolved", csatScore: null },
          messages: [],
        },
      });
    });

    const u = userEvent.setup();
    render(<SupportCard onClose={jest.fn()} />);
    await u.click(screen.getByTestId("support-tab-mine-btn"));
    await waitFor(() => screen.getByTestId("support-ticket-row-t1"));
    await u.click(screen.getByTestId("support-ticket-row-t1"));
    await waitFor(() => expect(screen.getByTestId("support-csat-panel")).toBeInTheDocument());

    expect(screen.getByTestId("support-csat-submit-btn")).toBeDisabled();
    await u.click(screen.getByTestId("support-csat-star-4"));
    expect(screen.getByTestId("support-csat-submit-btn")).not.toBeDisabled();
  });

  it("closes on the X button", async () => {
    const onClose = jest.fn();
    const u = userEvent.setup();
    render(<SupportCard onClose={onClose} />);
    await u.click(screen.getByTestId("support-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
