import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import Revenue from "./Revenue";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const SUMMARY = {
  real: { count: 2, amountPaise: 19800 },
  mock: { count: 1, amountPaise: 9900 },
  totalCount: 3,
  totalAmountPaise: 29700,
  last30dByDay: [{ date: "2026-01-01", count: 3, amountPaise: 29700 }],
};
const PAYMENTS = {
  payments: [
    { id: "p1", userName: "Asha Rao", userEmail: "asha@example.com", purpose: "SCORE_REPORT_PDF", amount: 9900, status: "paid", isMock: false, refundedAmountPaise: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
};
const MRR_SUMMARY = { mrrPaise: 23800, arrPaise: 285600, arpuPaise: 11900, activePayingCount: 2, trialingCount: 1, pastDueCount: 0, churnRatePct: 5, estimatedLtvPaise: 238000 };
const PLAN_PERFORMANCE = { plans: [{ planKey: "premium_monthly", planName: "Premium (Monthly)", payingCount: 2, trialingCount: 1, mrrPaise: 23800 }] };
const MRR_MOVEMENT = { movement: [{ month: "2026-01", newPaise: 11900, expansionPaise: 0, contractionPaise: 0, churnedPaise: 0, netPaise: 11900 }] };
const FAILED_PAYMENTS = { payments: [] };
const REPORT_PRICING = { pricePaise: 9900, originalPricePaise: 29900 };

function mockLoadOk(overrides = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/admin/revenue/summary") return Promise.resolve({ data: overrides.summary || SUMMARY });
    if (path === "/admin/revenue/payments") return Promise.resolve({ data: overrides.payments || PAYMENTS });
    if (path === "/admin/revenue/mrr-summary") return Promise.resolve({ data: overrides.mrrSummary || MRR_SUMMARY });
    if (path === "/admin/revenue/plan-performance") return Promise.resolve({ data: overrides.planPerformance || PLAN_PERFORMANCE });
    if (path === "/admin/revenue/mrr-movement") return Promise.resolve({ data: overrides.mrrMovement || MRR_MOVEMENT });
    if (path === "/admin/revenue/failed-payments") return Promise.resolve({ data: overrides.failedPayments || FAILED_PAYMENTS });
    if (path === "/admin/revenue/report-pricing") return Promise.resolve({ data: overrides.reportPricing || REPORT_PRICING });
    return Promise.reject(new Error("unexpected path " + path));
  });
}

describe("admin Revenue", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the revenue summary and payments table", async () => {
    mockLoadOk();
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-screen")).toBeInTheDocument());
    expect(screen.getByTestId("admin-revenue-total")).toHaveTextContent("297"); // ₹297 = 29700 paise
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
  });

  it("shows an empty state with no payments", async () => {
    mockLoadOk({ payments: { payments: [], page: 1, limit: 25, total: 0, totalPages: 1 } });
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-empty")).toBeInTheDocument());
  });

  it("shows an error state when a request fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-error")).toBeInTheDocument());
  });

  it("shows MRR/ARR/ARPU/churn KPIs and estimated LTV", async () => {
    mockLoadOk();
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-mrr")).toHaveTextContent("238"));
    expect(screen.getByTestId("admin-revenue-arr")).toHaveTextContent("2,856");
    expect(screen.getByTestId("admin-revenue-arpu")).toHaveTextContent("119");
    expect(screen.getByTestId("admin-revenue-churn")).toHaveTextContent("5.0%");
  });

  it("shows plan performance and MRR movement tables", async () => {
    mockLoadOk();
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-plan-performance-table")).toBeInTheDocument());
    expect(screen.getByText("Premium (Monthly)")).toBeInTheDocument();
    expect(screen.getByTestId("admin-revenue-mrr-movement-table")).toHaveTextContent("2026-01");
  });

  it("shows a failed-payments queue when there are failures", async () => {
    mockLoadOk({ failedPayments: { payments: [{ id: "fp1", userName: "Bad Card", userEmail: "bad@example.com", amountPaise: 11900, failureReason: "Card declined", subscriptionStatus: "past_due", createdAt: "2026-01-02T00:00:00.000Z" }] } });
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-failed-payments-table")).toBeInTheDocument());
    expect(screen.getByText("Card declined")).toBeInTheDocument();
  });

  it("does not render the failed-payments section when there are none", async () => {
    mockLoadOk();
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-revenue-failed-payments-table")).not.toBeInTheDocument();
  });

  it("refunds a paid payment, prompting for step-up when required", async () => {
    mockLoadOk();
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }).mockResolvedValueOnce({ data: { payment: { id: "p1", refundedAmountPaise: 9900, refundIds: ["mock_refund_1"] } } });
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-refund-btn-p1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-revenue-refund-btn-p1"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("hides the refund button once a payment is fully refunded", async () => {
    mockLoadOk({ payments: { payments: [{ ...PAYMENTS.payments[0], refundedAmountPaise: 9900 }], page: 1, limit: 25, total: 1, totalPages: 1 } });
    render(<Revenue />);
    await waitFor(() => expect(screen.getByTestId("admin-revenue-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-revenue-refund-btn-p1")).not.toBeInTheDocument();
  });

  // Requirement: the resilience-report PDF's price is admin-editable
  // (previously hardcoded on the download button).
  describe("report pricing", () => {
    it("shows the current price and strikethrough 'was' price in rupees", async () => {
      mockLoadOk();
      render(<Revenue />);
      await waitFor(() => expect(screen.getByTestId("admin-report-pricing-price-input")).toHaveValue(99));
      expect(screen.getByTestId("admin-report-pricing-original-input")).toHaveValue(299);
    });

    it("Save starts disabled (nothing changed yet)", async () => {
      mockLoadOk();
      render(<Revenue />);
      await waitFor(() => expect(screen.getByTestId("admin-report-pricing-save-btn")).toBeDisabled());
    });

    it("editing the price enables Save, and saving PATCHes paise and shows a Saved confirmation", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: { pricePaise: 4900, originalPricePaise: 29900 } });
      render(<Revenue />);
      await waitFor(() => expect(screen.getByTestId("admin-report-pricing-price-input")).toHaveValue(99));

      fireEvent.change(screen.getByTestId("admin-report-pricing-price-input"), { target: { value: "49" } });
      expect(screen.getByTestId("admin-report-pricing-save-btn")).not.toBeDisabled();

      fireEvent.click(screen.getByTestId("admin-report-pricing-save-btn"));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/revenue/report-pricing", { pricePaise: 4900, originalPricePaise: 29900 }));
      await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
      expect(screen.getByTestId("admin-report-pricing-save-btn")).toBeDisabled();
    });

    it("clearing the strikethrough price saves it as null (no discount shown)", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: { pricePaise: 9900, originalPricePaise: null } });
      render(<Revenue />);
      await waitFor(() => expect(screen.getByTestId("admin-report-pricing-original-input")).toHaveValue(299));

      fireEvent.change(screen.getByTestId("admin-report-pricing-original-input"), { target: { value: "" } });
      fireEvent.click(screen.getByTestId("admin-report-pricing-save-btn"));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/revenue/report-pricing", { pricePaise: 9900, originalPricePaise: null }));
    });

    it("shows an error if the update fails", async () => {
      mockLoadOk();
      api.patch.mockRejectedValue({ response: { data: { message: "Couldn't update the report price." } } });
      render(<Revenue />);
      await waitFor(() => expect(screen.getByTestId("admin-report-pricing-price-input")).toHaveValue(99));

      fireEvent.change(screen.getByTestId("admin-report-pricing-price-input"), { target: { value: "79" } });
      fireEvent.click(screen.getByTestId("admin-report-pricing-save-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-revenue-mutation-error")).toHaveTextContent("Couldn't update the report price."));
    });
  });
});
