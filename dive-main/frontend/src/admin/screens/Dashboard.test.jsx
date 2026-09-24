import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { api } from "../../lib/api";
import Dashboard from "./Dashboard";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn() } }));

const SAMPLE = {
  users: { total: 120, newSignups7d: 4, newSignups30d: 18, active30d: 55, staffCount: 2 },
  portfolios: { totalHoldings: 340, totalHoldingsValue: 12345678 },
  revenue: { paidReportsCount: 9, totalRevenuePaise: 891000 },
};

describe("admin Dashboard", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state, then the real KPI numbers", async () => {
    api.get.mockResolvedValue({ data: SAMPLE });
    render(<Dashboard />);
    expect(screen.getByTestId("admin-dashboard-loading")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("admin-dashboard-screen")).toBeInTheDocument());
    expect(screen.getByTestId("kpi-total-users")).toHaveTextContent("120");
    expect(screen.getByTestId("kpi-new-signups")).toHaveTextContent("18");
    expect(screen.getByTestId("kpi-active-users")).toHaveTextContent("55");
    expect(screen.getByTestId("kpi-staff-count")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-total-holdings")).toHaveTextContent("340");
    expect(screen.getByTestId("kpi-paid-reports")).toHaveTextContent("9");
    // ₹8,910 = 891000 paise / 100
    expect(screen.getByTestId("kpi-total-revenue")).toHaveTextContent("8,910");
  });

  it("shows an error state when the request fails", async () => {
    api.get.mockRejectedValue(new Error("network down"));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByTestId("admin-dashboard-error")).toBeInTheDocument());
  });
});
