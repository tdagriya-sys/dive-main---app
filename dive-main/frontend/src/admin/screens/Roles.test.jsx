import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../../lib/api";
import Roles from "./Roles";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const ROLES = [{ _id: "r1", key: "support_agent", label: "Support Agent", description: "", permissions: ["tickets.view"] }];

describe("Roles", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the role list", async () => {
    api.get.mockResolvedValue({ data: { roles: ROLES } });
    render(<Roles />);
    expect(screen.getByTestId("admin-roles-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-roles-row-r1")).toBeInTheDocument());
    expect(screen.getByText("Support Agent")).toBeInTheDocument();
    expect(screen.getByText("support_agent")).toBeInTheDocument();
  });

  it("shows an empty state with no roles", async () => {
    api.get.mockResolvedValue({ data: { roles: [] } });
    render(<Roles />);
    await waitFor(() => expect(screen.getByTestId("admin-roles-empty")).toBeInTheDocument());
  });

  it("creates a new role, prompting for step-up when required", async () => {
    api.get.mockResolvedValue({ data: { roles: ROLES } });
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }).mockResolvedValueOnce({ data: { role: {} } });
    render(<Roles />);
    await waitFor(() => expect(screen.getByTestId("admin-roles-row-r1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-roles-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-roles-new-key-input"), { target: { value: "content_editor" } });
    fireEvent.change(screen.getByTestId("admin-roles-new-label-input"), { target: { value: "Content Editor" } });
    fireEvent.click(screen.getByTestId("admin-roles-new-permission-tickets.respond"));
    fireEvent.click(screen.getByTestId("admin-roles-new-create-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("edits an existing role's permissions once dirty, and calls the update endpoint", async () => {
    api.get.mockResolvedValue({ data: { roles: ROLES } });
    api.patch.mockResolvedValue({ data: { role: {} } }); // succeeds on the first attempt — no step-up prompt needed
    render(<Roles />);
    await waitFor(() => expect(screen.getByTestId("admin-roles-row-r1")).toBeInTheDocument());

    expect(screen.queryByTestId("admin-roles-save-btn-r1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("admin-roles-permission-r1-tickets.respond"));
    expect(screen.getByTestId("admin-roles-save-btn-r1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-roles-save-btn-r1"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/roles/r1", { permissions: ["tickets.view", "tickets.respond"] }, expect.anything())
    );
  });

  it("deletes a role and shows the backend's error message on failure", async () => {
    api.get.mockResolvedValue({ data: { roles: ROLES } });
    api.delete.mockRejectedValue({ response: { data: { message: "1 employee(s) still have this role assigned" } } });
    render(<Roles />);
    await waitFor(() => expect(screen.getByTestId("admin-roles-row-r1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-roles-delete-btn-r1"));
    await waitFor(() => expect(screen.getByTestId("admin-roles-error")).toHaveTextContent("1 employee(s) still have this role assigned"));
  });
});
