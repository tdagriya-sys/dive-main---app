import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminApp from "./AdminApp";
import { useAdminAuth } from "./AdminAuthContext";

jest.mock("./AdminAuthContext", () => {
  const actual = jest.requireActual("./AdminAuthContext");
  return { ...actual, useAdminAuth: jest.fn() };
});
jest.mock("./AdminLogin", () => () => <div data-testid="mock-admin-login" />);
jest.mock("./AdminShell", () => () => <div data-testid="mock-admin-shell" />);
jest.mock("./AcceptInvite", () => () => <div data-testid="mock-accept-invite" />);

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminApp />
    </MemoryRouter>
  );
}

describe("AdminApp", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading placeholder while the session restore is in flight", () => {
    useAdminAuth.mockReturnValue({ authLoading: true, staffUser: null });
    renderAt("/admin");
    expect(screen.getByTestId("admin-auth-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-admin-login")).not.toBeInTheDocument();
  });

  it("shows AdminLogin once loaded with no staff session", () => {
    useAdminAuth.mockReturnValue({ authLoading: false, staffUser: null });
    renderAt("/admin");
    expect(screen.getByTestId("mock-admin-login")).toBeInTheDocument();
  });

  it("shows AdminShell once loaded with a staff session", () => {
    useAdminAuth.mockReturnValue({ authLoading: false, staffUser: { email: "boss@divve.in", staffRole: "superadmin" } });
    renderAt("/admin");
    expect(screen.getByTestId("mock-admin-shell")).toBeInTheDocument();
  });

  it("shows AcceptInvite at /admin/accept-invite regardless of auth state, never the login/loading screens", () => {
    useAdminAuth.mockReturnValue({ authLoading: true, staffUser: null });
    renderAt("/admin/accept-invite?token=abc123");
    expect(screen.getByTestId("mock-accept-invite")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-auth-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-admin-login")).not.toBeInTheDocument();
  });
});
