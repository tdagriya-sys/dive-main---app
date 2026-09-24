import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import Analytics from "./Analytics";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn() } }));

describe("admin Analytics", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads engagement, funnel and feature usage together", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/analytics/engagement") return Promise.resolve({ data: { dau: 3, wau: 10, mau: 40 } });
      if (path === "/admin/analytics/funnel")
        return Promise.resolve({
          data: {
            stages: [
              { type: "signup", distinctUsers: 40 },
              { type: "holding_added", distinctUsers: 30 },
              { type: "score_viewed", distinctUsers: 28 },
              { type: "report_purchased", distinctUsers: 5 },
            ],
          },
        });
      if (path === "/admin/analytics/feature-usage")
        return Promise.resolve({ data: { days: 30, usage: [{ type: "bot_scan", count: 12 }] } });
      if (path === "/admin/tickets/report") return Promise.reject(new Error("no tickets.view")); // best-effort — see the component's own comment
      return Promise.reject(new Error("unexpected path"));
    });

    render(<Analytics />);
    await waitFor(() => expect(screen.getByTestId("admin-analytics-screen")).toBeInTheDocument());
    expect(screen.getByTestId("admin-analytics-dau")).toHaveTextContent("3");
    expect(screen.getByTestId("admin-analytics-wau")).toHaveTextContent("10");
    expect(screen.getByTestId("admin-analytics-mau")).toHaveTextContent("40");
    expect(screen.getByTestId("admin-analytics-funnel")).toHaveTextContent("report_purchased");
    expect(screen.getByTestId("admin-analytics-usage")).toHaveTextContent("bot_scan");
    // The support/CSAT section is best-effort — a staff member without
    // tickets.view still sees the rest of Analytics just fine.
    expect(screen.queryByTestId("admin-analytics-csat")).not.toBeInTheDocument();
  });

  it("shows an error state when any request fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<Analytics />);
    await waitFor(() => expect(screen.getByTestId("admin-analytics-error")).toBeInTheDocument());
  });

  // Phase 7 of docs/ADMIN_PANEL_PLAN.md §11 — "CSAT/NPS dashboards", built on
  // top of the ticket report that already existed since Phase 4.
  it("shows the CSAT/support section when tickets.view is granted", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/analytics/engagement") return Promise.resolve({ data: { dau: 3, wau: 10, mau: 40 } });
      if (path === "/admin/analytics/funnel") return Promise.resolve({ data: { stages: [{ type: "signup", distinctUsers: 40 }] } });
      if (path === "/admin/analytics/feature-usage") return Promise.resolve({ data: { days: 30, usage: [] } });
      if (path === "/admin/tickets/report")
        // Mirrors the real shape ticketsController.ts's getReport actually
        // sends — `res.json({ report })`, not the report fields at the top
        // level. A prior version of this mock used the unwrapped shape,
        // which meant the component's `data.report` bug (every support
        // field silently `undefined` in real usage) passed this test anyway.
        return Promise.resolve({ data: { report: { totalOpen: 4, byStatus: {}, byPriority: {}, byCategory: {}, avgFirstResponseMinutes: 45, avgResolutionMinutes: 200, csatAverage: 4.5, csatCount: 12, slaBreached: 1 } } });
      return Promise.reject(new Error("unexpected path"));
    });

    render(<Analytics />);
    await waitFor(() => expect(screen.getByTestId("admin-analytics-csat")).toBeInTheDocument());
    expect(screen.getByTestId("admin-analytics-csat")).toHaveTextContent("4.5");
    expect(screen.getByTestId("admin-analytics-open-tickets")).toHaveTextContent("4");
    expect(screen.getByTestId("admin-analytics-sla-breached")).toHaveTextContent("1");
    expect(screen.getByTestId("admin-analytics-first-response")).toHaveTextContent("45m");
  });

  // jobs/activityRollup.cron.ts (docs/ADMIN_PANEL_PLAN.md §4.3/§12 decision
  // #10) keeps ActivityDailyRollup data alive past the raw 180-day TTL —
  // this confirms the admin UI actually reaches for a longer window instead
  // of the rollup mechanism being written and never read from anywhere.
  it("re-fetches feature usage with the selected days window", async () => {
    api.get.mockImplementation((path, config) => {
      if (path === "/admin/analytics/engagement") return Promise.resolve({ data: { dau: 3, wau: 10, mau: 40 } });
      if (path === "/admin/analytics/funnel") return Promise.resolve({ data: { stages: [{ type: "signup", distinctUsers: 40 }] } });
      if (path === "/admin/analytics/feature-usage") {
        const days = config?.params?.days ?? 30;
        return Promise.resolve({ data: { days, usage: [{ type: "bot_scan", count: days }] } });
      }
      if (path === "/admin/tickets/report") return Promise.reject(new Error("no tickets.view"));
      return Promise.reject(new Error("unexpected path"));
    });

    render(<Analytics />);
    await waitFor(() => expect(screen.getByTestId("admin-analytics-usage")).toHaveTextContent("Last 30 days"));

    fireEvent.change(screen.getByTestId("admin-analytics-usage-days"), { target: { value: "365" } });
    expect(api.get).toHaveBeenCalledWith("/admin/analytics/feature-usage", { params: { days: 365 } });
    await waitFor(() => expect(screen.getByTestId("admin-analytics-usage")).toHaveTextContent("Last 365 days"));
  });
});
