import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../lib/api";
import TicketSettings from "./TicketSettings";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const CATEGORIES = [{ id: "c1", key: "general", label: "General", defaultPriority: "normal", slaHours: 48, isActive: true }];
const CANNED = [{ id: "r1", title: "Greeting", body: "Hello there!" }];

function renderComponent() {
  return render(
    <MemoryRouter>
      <TicketSettings />
    </MemoryRouter>
  );
}

function mockLoadOk() {
  api.get.mockImplementation((url) => {
    if (url === "/admin/ticket-categories") return Promise.resolve({ data: { categories: CATEGORIES } });
    if (url === "/admin/canned-responses") return Promise.resolve({ data: { cannedResponses: CANNED } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("TicketSettings", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows categories and canned responses once loaded", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-ticket-settings-category-row-c1")).toBeInTheDocument());
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("Greeting")).toBeInTheDocument();
  });

  it("creates a new category", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { category: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-ticket-settings-category-row-c1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-ticket-settings-new-category-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-ticket-settings-new-category-key-input"), { target: { value: "vip" } });
    fireEvent.change(screen.getByTestId("admin-ticket-settings-new-category-label-input"), { target: { value: "VIP" } });
    fireEvent.click(screen.getByTestId("admin-ticket-settings-new-category-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/ticket-categories", { key: "vip", label: "VIP" }));
  });

  it("edits a category's label once dirty, and saves it", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { category: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-ticket-settings-category-row-c1")).toBeInTheDocument());

    expect(screen.queryByTestId("admin-ticket-settings-category-save-btn-c1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("admin-ticket-settings-category-label-c1"), { target: { value: "General Support" } });
    fireEvent.click(screen.getByTestId("admin-ticket-settings-category-save-btn-c1"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/ticket-categories/c1", { label: "General Support", slaHours: 48, defaultPriority: "normal" }));
  });

  it("shows the backend's error when deleting a category still in use", async () => {
    mockLoadOk();
    api.delete.mockRejectedValue({ response: { data: { message: "1 ticket(s) still use this category." } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-ticket-settings-category-row-c1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-ticket-settings-category-delete-btn-c1"));
    await waitFor(() => expect(screen.getByTestId("admin-ticket-settings-error")).toHaveTextContent("still use this category"));
  });

  it("creates a new canned response", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { cannedResponse: {} } });
    renderComponent();
    await waitFor(() => expect(screen.getByText("Greeting")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-ticket-settings-new-canned-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-ticket-settings-new-canned-title-input"), { target: { value: "Follow-up" } });
    fireEvent.change(screen.getByTestId("admin-ticket-settings-new-canned-body-input"), { target: { value: "Following up on this." } });
    fireEvent.click(screen.getByTestId("admin-ticket-settings-new-canned-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/canned-responses", { title: "Follow-up", body: "Following up on this." }));
  });
});
