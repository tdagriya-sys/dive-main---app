import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppRoot from "./AppRoot";

// App and the lazy-loaded AdminApp are both mocked to a bare marker div —
// this test is only about the ROUTE SPLIT itself (Phase 0.4 of
// docs/ADMIN_PANEL_PLAN.md: "/admin/*" -> the admin tree, everything else ->
// the existing app, unchanged), not either tree's own internals, which have
// their own dedicated test suites (App has none directly — see its own
// screens' tests; the admin tree's are in src/admin/*.test.jsx).
jest.mock("./App", () => () => <div data-testid="mock-user-app" />);
jest.mock("./admin/AdminApp", () => () => <div data-testid="mock-admin-app" />);

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoot />
    </MemoryRouter>
  );
}

describe("AppRoot routing", () => {
  it("renders the normal app at /", () => {
    renderAt("/");
    expect(screen.getByTestId("mock-user-app")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-admin-app")).not.toBeInTheDocument();
  });

  it("renders the normal app for an arbitrary non-admin path (its own internal screen-state routing takes over)", () => {
    renderAt("/whatever-the-user-app-does-internally");
    expect(screen.getByTestId("mock-user-app")).toBeInTheDocument();
  });

  it("renders the (lazily-loaded) admin app at /admin", async () => {
    renderAt("/admin");
    expect(await screen.findByTestId("mock-admin-app")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-user-app")).not.toBeInTheDocument();
  });

  it("renders the admin app for a nested /admin/* path too", async () => {
    renderAt("/admin/users");
    expect(await screen.findByTestId("mock-admin-app")).toBeInTheDocument();
  });
});
