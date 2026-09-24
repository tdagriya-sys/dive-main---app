import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AdminShell from "./AdminShell";
import { useAdminAuth } from "./AdminAuthContext";

jest.mock("./AdminAuthContext", () => ({ useAdminAuth: jest.fn() }));

// Each screen has its own dedicated test suite (src/admin/screens/*.test.jsx)
// — this file is only about the SHELL: the sidebar, identity/logout, and
// that each nav path routes to the right screen, so every screen is mocked
// to a bare marker rather than exercising its real API calls here.
jest.mock("./screens/Dashboard", () => () => <div data-testid="mock-dashboard-screen" />);
jest.mock("./screens/UsersList", () => () => <div data-testid="mock-users-screen" />);
jest.mock("./screens/UserDetail", () => () => <div data-testid="mock-user-detail-screen" />);
jest.mock("./screens/AuditLog", () => () => <div data-testid="mock-audit-screen" />);
jest.mock("./screens/SystemHealth", () => () => <div data-testid="mock-system-screen" />);
jest.mock("./screens/Analytics", () => () => <div data-testid="mock-analytics-screen" />);
jest.mock("./screens/Revenue", () => () => <div data-testid="mock-revenue-screen" />);
jest.mock("./screens/Instruments", () => () => <div data-testid="mock-instruments-screen" />);
jest.mock("./screens/ScoringModel", () => () => <div data-testid="mock-scoring-model-screen" />);
jest.mock("./screens/ContextModel", () => () => <div data-testid="mock-context-model-screen" />);
jest.mock("./screens/SuggestionModel", () => () => <div data-testid="mock-suggestion-model-screen" />);
jest.mock("./screens/LookthroughModel", () => () => <div data-testid="mock-lookthrough-model-screen" />);
jest.mock("./screens/Employees", () => () => <div data-testid="mock-employees-screen" />);
jest.mock("./screens/Roles", () => () => <div data-testid="mock-roles-screen" />);
jest.mock("./screens/Tickets", () => () => <div data-testid="mock-tickets-screen" />);
jest.mock("./screens/TicketDetail", () => () => <div data-testid="mock-ticket-detail-screen" />);
jest.mock("./screens/TicketSettings", () => () => <div data-testid="mock-ticket-settings-screen" />);
jest.mock("./screens/Notifications", () => () => <div data-testid="mock-notifications-screen" />);
jest.mock("./screens/NotificationCampaignDetail", () => () => <div data-testid="mock-notification-campaign-detail-screen" />);
jest.mock("./screens/Subscriptions", () => () => <div data-testid="mock-subscriptions-screen" />);
jest.mock("./screens/FeatureFlags", () => () => <div data-testid="mock-feature-flags-screen" />);
jest.mock("./screens/DataRequests", () => () => <div data-testid="mock-data-requests-screen" />);

// AdminShell's own <Routes> uses paths RELATIVE to "/admin" ("users",
// "system", ...) — that only resolves correctly when there's an ancestor
// Route establishing "/admin/*" as the base, exactly like the real app does
// (src/AppRoot.jsx -> AdminApp -> AdminShell). Rendering AdminShell directly
// under a bare MemoryRouter with no such ancestor was a real bug in this test
// itself (found live: every path silently rendered blank content) — this
// mirrors the real nesting instead.
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminShell />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminShell", () => {
  afterEach(() => jest.clearAllMocks());

  // Regression: the outer shell used `min-h-screen`, which lets the
  // container grow TALLER than the viewport the moment a routed screen's
  // content is longer than one page — dragging the sidebar along with it (a
  // normal flex child, stretched to match), so the whole page scrolled
  // together and the logout button at the bottom of the sidebar ended up
  // wherever the bottom of that long page happened to land. Fixed to a
  // bounded `h-screen`+`overflow-hidden`, with the sidebar owning its own
  // `overflow-y-auto` (mirrors DiveShell.test.jsx's identical check for the
  // main app's sidebar).
  it("the shell is a bounded viewport height, and the sidebar scrolls its own overflow independently of the main content", () => {
    useAdminAuth.mockReturnValue({ staffUser: { email: "boss@divve.in", staffRole: "superadmin" }, logout: jest.fn() });
    renderAt("/admin");
    expect(screen.getByTestId("admin-shell").className).toMatch(/h-screen/);
    expect(screen.getByTestId("admin-shell").className).not.toMatch(/min-h-screen/);
    expect(screen.getByTestId("admin-shell").className).toMatch(/overflow-hidden/);
    const sidebar = screen.getByTestId("admin-nav-dashboard").closest("aside");
    expect(sidebar.className).toMatch(/overflow-y-auto/);
  });

  it("shows the signed-in staff member's email and role", () => {
    useAdminAuth.mockReturnValue({ staffUser: { email: "boss@divve.in", staffRole: "superadmin" }, logout: jest.fn() });
    renderAt("/admin");
    expect(screen.getByTestId("admin-shell-identity")).toHaveTextContent("boss@divve.in");
    expect(screen.getByText("superadmin")).toBeInTheDocument();
  });

  it("calls logout when the log-out button is clicked", async () => {
    const user = userEvent.setup();
    const logout = jest.fn();
    useAdminAuth.mockReturnValue({ staffUser: { email: "boss@divve.in", staffRole: "admin" }, logout });
    renderAt("/admin");
    await user.click(screen.getByTestId("admin-shell-logout-btn"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/admin", "mock-dashboard-screen"],
    ["/admin/users", "mock-users-screen"],
    ["/admin/users/abc123", "mock-user-detail-screen"],
    ["/admin/analytics", "mock-analytics-screen"],
    ["/admin/revenue", "mock-revenue-screen"],
    ["/admin/subscriptions", "mock-subscriptions-screen"],
    ["/admin/instruments", "mock-instruments-screen"],
    ["/admin/scoring-model", "mock-scoring-model-screen"],
    ["/admin/context-model", "mock-context-model-screen"],
    ["/admin/suggestion-model", "mock-suggestion-model-screen"],
    ["/admin/lookthrough-model", "mock-lookthrough-model-screen"],
    ["/admin/employees", "mock-employees-screen"],
    ["/admin/roles", "mock-roles-screen"],
    ["/admin/tickets", "mock-tickets-screen"],
    ["/admin/tickets/abc123", "mock-ticket-detail-screen"],
    ["/admin/ticket-settings", "mock-ticket-settings-screen"],
    ["/admin/notifications", "mock-notifications-screen"],
    ["/admin/notifications/campaigns/abc123", "mock-notification-campaign-detail-screen"],
    ["/admin/feature-flags", "mock-feature-flags-screen"],
    ["/admin/data-requests", "mock-data-requests-screen"],
    ["/admin/audit", "mock-audit-screen"],
    ["/admin/system", "mock-system-screen"],
  ])("routes %s to the right screen", (path, expectedTestId) => {
    useAdminAuth.mockReturnValue({ staffUser: { email: "boss@divve.in", staffRole: "superadmin" }, logout: jest.fn() });
    renderAt(path);
    expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
  });

  it("renders all eighteen nav links for a superadmin", () => {
    useAdminAuth.mockReturnValue({ staffUser: { email: "boss@divve.in", staffRole: "superadmin" }, logout: jest.fn() });
    renderAt("/admin");
    expect(screen.getByTestId("admin-nav-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-users")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-analytics")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-revenue")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-subscriptions")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-instruments")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-scoring-model")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-context-model")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-suggestion-model")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-look-through-model")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-tickets")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-notifications")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-employees")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-roles")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-feature-flags")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-data-requests")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-audit-log")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-system")).toBeInTheDocument();
  });

  it.each(["admin", "employee"])("hides Employees/Roles nav links for a non-superadmin (%s)", (staffRole) => {
    useAdminAuth.mockReturnValue({ staffUser: { email: "someone@divve.in", staffRole }, logout: jest.fn() });
    renderAt("/admin");
    expect(screen.queryByTestId("admin-nav-employees")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-nav-roles")).not.toBeInTheDocument();
  });
});
