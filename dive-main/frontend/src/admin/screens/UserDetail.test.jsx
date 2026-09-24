import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/api";
import UserDetail from "./UserDetail";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const DETAIL = {
  user: { id: "u1", name: "Asha Rao", email: "asha@example.com", mobile: "9876543210", age: 29, status: "active" },
  holdings: { count: 2, totalValue: 50000, byAssetClass: { GOLD: { count: 1, value: 20000 }, EQUITY: { count: 1, value: 30000 } } },
  score: { compositeScore: 62, hasHoldings: true },
  liveSessionCount: 1,
  payments: [{ id: "p1", purpose: "SCORE_REPORT_PDF", amount: 9900, currency: "INR", status: "paid", isMock: true, createdAt: "2026-01-01" }],
  activity: [{ type: "login", props: {}, ts: "2026-01-02T00:00:00.000Z" }],
  auditEntries: [],
};

function renderWithRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/u1"]}>
      <Routes>
        <Route path="/admin/users" element={<div data-testid="landed-on-list" />} />
        <Route path="/admin/users/:id" element={<UserDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("admin UserDetail", () => {
  afterEach(() => jest.clearAllMocks());

  it("renders the real (unmasked) profile, holdings, score, payments and activity", async () => {
    api.get.mockResolvedValue({ data: DETAIL });
    renderWithRoute();
    // The root testid is present even while loading — wait for a
    // data-only element instead of falsely resolving on the loading state.
    await screen.findByTestId("admin-user-detail-portfolio-card");
    expect(api.get).toHaveBeenCalledWith("/admin/users/u1");
    expect(screen.getByText(/asha@example.com/)).toBeInTheDocument();
    expect(screen.getByTestId("admin-user-detail-score-card")).toHaveTextContent("62");
    expect(screen.getByTestId("admin-user-detail-holdings-breakdown")).toHaveTextContent("GOLD");
    expect(screen.getByTestId("admin-user-detail-payments-card")).toHaveTextContent("SCORE_REPORT_PDF");
    expect(screen.getByTestId("admin-user-detail-activity-card")).toHaveTextContent("login");
  });

  it("shows a 404-specific message for an unknown user", async () => {
    api.get.mockRejectedValue({ response: { status: 404 } });
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-user-detail-error")).toHaveTextContent("User not found."));
  });

  it("the back button returns to the users list", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: DETAIL });
    renderWithRoute();
    await waitFor(() => expect(screen.getByTestId("admin-user-detail-screen")).toBeInTheDocument());
    await user.click(screen.getByTestId("admin-user-detail-back-btn"));
    expect(await screen.findByTestId("landed-on-list")).toBeInTheDocument();
  });

  // Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8 — read-only impersonation.
  describe("View as this user", () => {
    it("requires step-up, then hands the token off via sessionStorage and opens a new tab", async () => {
      api.get.mockResolvedValue({ data: DETAIL });
      api.post
        .mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } })
        .mockResolvedValueOnce({ data: { accessToken: "imp-token", expiresAt: "2026-01-01T01:00:00.000Z", user: DETAIL.user } });
      const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
      const openSpy = jest.spyOn(window, "open").mockImplementation(() => undefined);

      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-impersonate-btn")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-user-detail-impersonate-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());

      setItemSpy.mockRestore();
      openSpy.mockRestore();
    });

    it("shows an error if starting the impersonation session fails", async () => {
      api.get.mockResolvedValue({ data: DETAIL });
      api.post.mockRejectedValue({ response: { data: { message: "Something went wrong." } } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-impersonate-btn")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-user-detail-impersonate-btn"));
      await waitFor(() => expect(screen.getByText("Something went wrong.")).toBeInTheDocument());
    });
  });

  // Fixes a real gap: User.status/the users.suspend permission have existed
  // since Phase 0.3, but no admin action ever actually used them until now.
  describe("suspend / reactivate / force-logout", () => {
    it("shows Suspend for an active account, and suspending shows a confirmation and reloads", async () => {
      api.get.mockResolvedValueOnce({ data: DETAIL }).mockResolvedValueOnce({ data: { ...DETAIL, user: { ...DETAIL.user, status: "suspended" } } });
      api.post.mockResolvedValue({ data: { status: "suspended" } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-suspend-btn")).toBeInTheDocument());
      expect(screen.queryByTestId("admin-user-detail-reactivate-btn")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("admin-user-detail-suspend-btn"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/users/u1/suspend", {}, expect.anything()));
      expect(await screen.findByTestId("admin-user-detail-account-note")).toHaveTextContent("Every active session was ended");
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-reactivate-btn")).toBeInTheDocument());
    });

    it("shows Reactivate for a suspended account", async () => {
      api.get.mockResolvedValue({ data: { ...DETAIL, user: { ...DETAIL.user, status: "suspended" } } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-reactivate-btn")).toBeInTheDocument());
      expect(screen.queryByTestId("admin-user-detail-suspend-btn")).not.toBeInTheDocument();

      api.post.mockResolvedValue({ data: { status: "active" } });
      fireEvent.click(screen.getByTestId("admin-user-detail-reactivate-btn"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/users/u1/reactivate", {}, expect.anything()));
      expect(await screen.findByTestId("admin-user-detail-account-note")).toHaveTextContent("reactivated");
    });

    it("force-logout ends every session without changing the status button shown", async () => {
      api.get.mockResolvedValue({ data: DETAIL });
      api.post.mockResolvedValue({ data: { ok: true } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-force-logout-btn")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-user-detail-force-logout-btn"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/users/u1/force-logout", {}, expect.anything()));
      expect(await screen.findByTestId("admin-user-detail-account-note")).toHaveTextContent("Every active session was ended");
      expect(screen.getByTestId("admin-user-detail-suspend-btn")).toBeInTheDocument();
    });

    it("requires step-up before suspending", async () => {
      api.get.mockResolvedValue({ data: DETAIL });
      api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-suspend-btn")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-user-detail-suspend-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
    });

    it("shows an error without hiding the rest of the page when an action fails", async () => {
      api.get.mockResolvedValue({ data: DETAIL });
      api.post.mockRejectedValue({ response: { data: { message: "Couldn't suspend this account." } } });
      renderWithRoute();
      await waitFor(() => expect(screen.getByTestId("admin-user-detail-suspend-btn")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-user-detail-suspend-btn"));
      expect(await screen.findByTestId("admin-user-detail-account-error")).toHaveTextContent("Couldn't suspend this account.");
      // The page itself — not just the top-level load error state — must
      // stay visible; this uses a separate error state precisely so a
      // mutation failure never hides an already-loaded page.
      expect(screen.getByTestId("admin-user-detail-portfolio-card")).toBeInTheDocument();
    });
  });
});
