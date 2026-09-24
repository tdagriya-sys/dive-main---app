import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../lib/api";
import Employees from "./Employees";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const EMPLOYEES_DATA = {
  staff: [
    { id: "u1", name: "Ada Admin", email: "ada@example.com", staffRole: "admin", status: "active", totpEnabled: true, lastAdminLoginAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "u2", name: "Boss", email: "boss@example.com", staffRole: "superadmin", status: "active", totpEnabled: true, createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  invites: [{ id: "i1", email: "invited@example.com", staffRole: "admin", status: "pending", expiresAt: "2026-02-01T00:00:00.000Z" }],
};
const ROLES_DATA = { roles: [{ _id: "r1", label: "Support Agent" }] };

function renderComponent() {
  return render(
    <MemoryRouter>
      <Employees />
    </MemoryRouter>
  );
}

describe("Employees", () => {
  afterEach(() => jest.clearAllMocks());

  function mockLoadOk() {
    api.get.mockImplementation((url) => {
      if (url === "/admin/employees") return Promise.resolve({ data: EMPLOYEES_DATA });
      if (url === "/admin/roles") return Promise.resolve({ data: ROLES_DATA });
      return Promise.reject(new Error("unexpected " + url));
    });
  }

  it("shows a loading state then the staff table and pending invites", async () => {
    mockLoadOk();
    renderComponent();
    expect(screen.getByTestId("admin-employees-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-error")).toBeInTheDocument());
  });

  it("never shows a Suspend/Reactivate action for a superadmin row", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-employees-status-btn-u2")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-employees-status-btn-u1")).toBeInTheDocument();
  });

  it("links each staff row to their filtered activity in the Audit Log", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());
    const link = screen.getByTestId("admin-employees-activity-link-u1");
    expect(link).toHaveAttribute("href", "/admin/audit?actorId=u1&actorLabel=ada%40example.com");
  });

  it("invites a new admin, showing the dev invite link when returned", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { invite: { id: "i2" }, devInviteLink: "http://localhost:3000/admin/accept-invite?token=abc" } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-employees-invite-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-employees-invite-email-input"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByTestId("admin-employees-invite-send-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-employees-invite-devlink")).toHaveTextContent("abc"));
    expect(api.post).toHaveBeenCalledWith("/admin/employees/invite", { email: "new@example.com", staffRole: "admin" }, expect.anything());
  });

  it("requires a role selection before Send invite is enabled for an employee invite", async () => {
    mockLoadOk();
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-employees-invite-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-employees-invite-email-input"), { target: { value: "e@example.com" } });
    fireEvent.change(screen.getByTestId("admin-employees-invite-role-select"), { target: { value: "employee" } });

    expect(screen.getByTestId("admin-employees-invite-send-btn")).toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-employees-invite-roleid-select"), { target: { value: "r1" } });
    expect(screen.getByTestId("admin-employees-invite-send-btn")).not.toBeDisabled();
  });

  it("revokes a pending invite", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { invite: { id: "i1", status: "revoked" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-employees-revoke-btn-i1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/employees/invites/i1/revoke", {}, expect.anything()));
  });

  it("toggles an active employee to suspended", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { employee: { id: "u1", status: "suspended" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-employees-status-btn-u1"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/employees/u1", { status: "suspended" }, expect.anything()));
  });

  it("opens the step-up modal when a mutation requires it", async () => {
    mockLoadOk();
    api.patch.mockRejectedValue({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
    renderComponent();
    await waitFor(() => expect(screen.getByTestId("admin-employees-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-employees-status-btn-u1"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });
});
