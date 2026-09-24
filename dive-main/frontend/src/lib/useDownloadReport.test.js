import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadReportButton } from "./useDownloadReport";
import { api } from "./api";
import { useDive } from "../context/DiveContext";

jest.mock("./api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const testUser = { name: "Priya Sharma", email: "priya@example.com", mobile: "9876543210" };

// Matches the old hardcoded Rs.299/Rs.99 — used as the default fixture so
// most tests below read the same as before the price became fetched
// (admin-editable) instead of hardcoded.
const DEFAULT_PRICE = { pricePaise: 9900, originalPricePaise: 29900 };

// Shared by Home.jsx and Preferences.jsx (both just render
// <DownloadReportButton testId="..." /> now) — one real test of the markup/
// pricing/payment behavior here instead of duplicating it in both screens'
// own test files, matching this module's whole reason for existing (one
// place, not two that could drift).
//
// The report is a PAID (admin-editable price, via Razorpay) download — see
// backend/src/services/paymentService.ts. These tests cover the real flow
// (already-paid fast path, real-mode Checkout.js, dev-mode mock-payment
// confirm) rather than a direct download, matching what the hook actually
// does now.
//
// `api.get` now serves two different endpoints from this hook (the price
// fetch on mount, and the report-download check on click), so every test
// mocks it by URL rather than by call order — mockApiGet below.
function mockApiGet({ price = DEFAULT_PRICE, pdfResponses = [] } = {}) {
  let pdfCallIndex = 0;
  api.get.mockImplementation((url) => {
    if (url === "/payments/report/price") {
      return price === "error" ? Promise.reject(new Error("price fetch failed")) : Promise.resolve({ data: price });
    }
    if (url === "/score/breakdown/pdf") {
      const next = pdfResponses[Math.min(pdfCallIndex, pdfResponses.length - 1)];
      pdfCallIndex += 1;
      return next.ok ? Promise.resolve({ data: next.data }) : Promise.reject(next.error);
    }
    return Promise.reject(new Error("unexpected GET " + url));
  });
}
const okBlob = { ok: true, data: new Blob(["fake pdf bytes"]) };
const blocked402 = { ok: false, error: { response: { status: 402 } } };

// Exhausted (remaining: 0, not already unlocked) — the default for most
// tests below, since they're testing the paid flow, not the free one.
// See the "complimentary downloads" describe block for willBeFree: true cases.
const EXHAUSTED_REPORT_ACCESS = { total: 0, used: 0, remaining: 0, unlockedForCurrentPortfolio: false };

describe("DownloadReportButton", () => {
  let refreshEntitlements;
  beforeEach(() => {
    jest.clearAllMocks();
    refreshEntitlements = jest.fn();
    useDive.mockReturnValue({ user: testUser, entitlements: { reportAccess: EXHAUSTED_REPORT_ACCESS }, refreshEntitlements });
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
    delete window.Razorpay;
  });

  it("fetches the real price and shows the struck-through original + current price, centered, with no icon, plus the Limited time offer badge when there's a discount", async () => {
    mockApiGet({ price: DEFAULT_PRICE });
    render(<DownloadReportButton testId="download-report-btn" />);

    const btn = screen.getByTestId("download-report-btn");
    await waitFor(() => expect(btn).toHaveTextContent("Download Resilience Score Report at Just Rs.299/- Rs.99/-"));
    expect(btn.className).toContain("justify-center");
    expect(btn.className).toContain("text-center");
    // No lucide FileDown icon anymore — the button's only child content is
    // plain text, no leading <svg>.
    expect(btn.querySelector("svg")).not.toBeInTheDocument();

    // Rs.299/- specifically carries the strikethrough, not the whole string.
    const oldPrice = screen.getByText("Rs.299/-");
    expect(oldPrice.className).toContain("line-through");
    expect(oldPrice.className).toContain("decoration-[var(--red)]");

    expect(screen.getByText("Limited time offer")).toBeInTheDocument();
  });

  it("shows just the plain price, no strikethrough or badge, when the admin hasn't set a higher original price", async () => {
    mockApiGet({ price: { pricePaise: 4900, originalPricePaise: null } });
    render(<DownloadReportButton testId="download-report-btn" />);

    const btn = screen.getByTestId("download-report-btn");
    await waitFor(() => expect(btn).toHaveTextContent("Download Resilience Score Report for Rs.49/-"));
    expect(screen.queryByText("Limited time offer")).not.toBeInTheDocument();
  });

  it("shows generic text with no price while the price fetch is still pending or fails", async () => {
    mockApiGet({ price: "error" });
    render(<DownloadReportButton testId="download-report-btn" />);

    expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Download Resilience Score Report");
    // Give the failed fetch a tick to settle, then confirm it stayed generic.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/payments/report/price"));
    expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Download Resilience Score Report");
    expect(screen.queryByText("Limited time offer")).not.toBeInTheDocument();
  });

  it("downloads immediately with no payment step when already paid for the current portfolio", async () => {
    const user = userEvent.setup();
    mockApiGet({ pdfResponses: [okBlob] });
    render(<DownloadReportButton testId="download-report-btn" />);
    await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));

    await user.click(screen.getByTestId("download-report-btn"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/score/breakdown/pdf", { responseType: "blob" }));
    expect(api.post).not.toHaveBeenCalled(); // no order/verify round-trip needed — this is the whole point of the fast path
    // Refreshes reportAccess after a successful download so a just-consumed
    // complimentary unit (or a newly-unlocked portfolio) shows up elsewhere
    // (the usage screen) without a remount.
    await waitFor(() => expect(refreshEntitlements).toHaveBeenCalled());
  });

  // Requirement: a user who still has a free download available (plan
  // benefit or admin grant, already merged into reportAccess — see
  // useDownloadReport.js's own comment) must never see a price at all.
  describe("complimentary downloads available — no price shown", () => {
    it("shows no price when the current portfolio is already unlocked for free", async () => {
      useDive.mockReturnValue({
        user: testUser,
        entitlements: { reportAccess: { total: 3, used: 1, remaining: 2, unlockedForCurrentPortfolio: true } },
        refreshEntitlements,
      });
      mockApiGet({ pdfResponses: [okBlob] });
      render(<DownloadReportButton testId="download-report-btn" />);

      await waitFor(() => expect(api.get).toHaveBeenCalledWith("/payments/report/price"));
      const btn = screen.getByTestId("download-report-btn");
      expect(btn).toHaveTextContent("Download Resilience Score Report");
      expect(btn).not.toHaveTextContent("Rs.");
      expect(screen.queryByText("Limited time offer")).not.toBeInTheDocument();
    });

    it("shows no price when a finite number of complimentary downloads remain", async () => {
      useDive.mockReturnValue({
        user: testUser,
        entitlements: { reportAccess: { total: 3, used: 2, remaining: 1, unlockedForCurrentPortfolio: false } },
        refreshEntitlements,
      });
      mockApiGet({ pdfResponses: [okBlob] });
      render(<DownloadReportButton testId="download-report-btn" />);

      await waitFor(() => expect(api.get).toHaveBeenCalledWith("/payments/report/price"));
      expect(screen.getByTestId("download-report-btn")).not.toHaveTextContent("Rs.");
    });

    it("shows no price when complimentary downloads are unlimited on the current plan", async () => {
      useDive.mockReturnValue({
        user: testUser,
        entitlements: { reportAccess: { total: null, used: 5, remaining: null, unlockedForCurrentPortfolio: false } },
        refreshEntitlements,
      });
      mockApiGet({ pdfResponses: [okBlob] });
      render(<DownloadReportButton testId="download-report-btn" />);

      await waitFor(() => expect(api.get).toHaveBeenCalledWith("/payments/report/price"));
      expect(screen.getByTestId("download-report-btn")).not.toHaveTextContent("Rs.");
    });

    it("shows the price once complimentary downloads are exhausted (remaining: 0, not unlocked)", async () => {
      useDive.mockReturnValue({
        user: testUser,
        entitlements: { reportAccess: EXHAUSTED_REPORT_ACCESS },
        refreshEntitlements,
      });
      mockApiGet({ price: DEFAULT_PRICE });
      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
    });
  });

  it("shows a loading state while checking, then an error and a re-enabled button on a non-payment failure", async () => {
    const user = userEvent.setup();
    mockApiGet({ pdfResponses: [{ ok: false, error: { response: { status: 500 } } }] });
    render(<DownloadReportButton testId="download-report-btn" />);
    await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));

    await user.click(screen.getByTestId("download-report-btn"));
    expect(await screen.findByText(/Couldn't generate your report/i)).toBeInTheDocument();
    expect(screen.getByTestId("download-report-btn")).not.toBeDisabled();
  });

  describe("real Razorpay checkout (RAZORPAY_KEY_ID/SECRET configured on the backend)", () => {
    function mockRazorpayGlobal() {
      const instance = { open: jest.fn(), on: jest.fn() };
      window.Razorpay = jest.fn(() => instance);
      return { RazorpayCtor: window.Razorpay, instance };
    }

    it("creates a real order, opens Checkout with the right options, and downloads once the handler fires", async () => {
      const user = userEvent.setup();
      const { RazorpayCtor, instance } = mockRazorpayGlobal();
      mockApiGet({ pdfResponses: [blocked402, okBlob] });
      api.post
        .mockResolvedValueOnce({ data: { orderId: "order_real123", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } })
        .mockResolvedValueOnce({ data: { verified: true } }); // /payments/report/verify

      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
      await user.click(screen.getByTestId("download-report-btn"));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/payments/report/order"));
      await waitFor(() => expect(RazorpayCtor).toHaveBeenCalled());
      const options = RazorpayCtor.mock.calls[0][0];
      expect(options.order_id).toBe("order_real123");
      expect(options.key).toBe("rzp_test_abc");
      expect(options.amount).toBe(9900);
      expect(options.currency).toBe("INR");
      expect(options.prefill).toEqual({ name: testUser.name, email: testUser.email, contact: testUser.mobile });
      expect(instance.open).toHaveBeenCalledTimes(1);

      // Simulate Razorpay's own checkout succeeding and calling our handler.
      options.handler({ razorpay_order_id: "order_real123", razorpay_payment_id: "pay_real456", razorpay_signature: "sig_real789" });

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith("/payments/report/verify", {
          razorpay_order_id: "order_real123",
          razorpay_payment_id: "pay_real456",
          razorpay_signature: "sig_real789",
        })
      );
      await waitFor(() => expect(api.get).toHaveBeenCalledWith("/score/breakdown/pdf", { responseType: "blob" }));
    });

    it("shows a payment-failed error without downloading anything, and re-enables the button", async () => {
      const user = userEvent.setup();
      const { RazorpayCtor, instance } = mockRazorpayGlobal();
      mockApiGet({ pdfResponses: [blocked402] });
      api.post.mockResolvedValueOnce({ data: { orderId: "order_x", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
      await user.click(screen.getByTestId("download-report-btn"));
      await waitFor(() => expect(instance.open).toHaveBeenCalled());

      const onFailedHandler = instance.on.mock.calls.find(([event]) => event === "payment.failed")[1];
      onFailedHandler({ error: { description: "Card declined" } });

      expect(await screen.findByText("Card declined")).toBeInTheDocument();
      expect(screen.getByTestId("download-report-btn")).not.toBeDisabled();
      // Only the one blocked PDF attempt — never got to a second (post-payment) one.
      expect(api.get.mock.calls.filter(([url]) => url === "/score/breakdown/pdf")).toHaveLength(1);
    });

    it("quietly re-enables the button (no error) if the user just closes the checkout", async () => {
      const user = userEvent.setup();
      const { instance } = mockRazorpayGlobal();
      mockApiGet({ pdfResponses: [blocked402] });
      api.post.mockResolvedValueOnce({ data: { orderId: "order_x", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
      await user.click(screen.getByTestId("download-report-btn"));
      await waitFor(() => expect(instance.open).toHaveBeenCalled());

      const rzpOptions = window.Razorpay.mock.calls[0][0];
      rzpOptions.modal.ondismiss();

      await waitFor(() => expect(screen.getByTestId("download-report-btn")).not.toBeDisabled());
      expect(screen.queryByText(/couldn't/i)).not.toBeInTheDocument();
    });
  });

  describe("mock-payment mode (no real Razorpay keys configured on the backend)", () => {
    it("shows a Dev Mode confirm banner instead of loading real Checkout.js, and downloads after simulating payment", async () => {
      const user = userEvent.setup();
      mockApiGet({ pdfResponses: [blocked402, okBlob] });
      api.post
        .mockResolvedValueOnce({ data: { orderId: "mock_order_abc", amount: 9900, currency: "INR", keyId: null, mock: true } })
        .mockResolvedValueOnce({ data: { verified: true } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
      await user.click(screen.getByTestId("download-report-btn"));

      expect(await screen.findByTestId("mock-payment-banner")).toBeInTheDocument();
      expect(screen.getByTestId("mock-payment-banner")).toHaveTextContent("Simulate a successful Rs.99/- payment");
      expect(window.Razorpay).toBeUndefined(); // never touched — no key to load real Checkout.js with

      await user.click(screen.getByTestId("mock-payment-confirm-btn"));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith("/payments/report/verify", {
          razorpay_order_id: "mock_order_abc",
          razorpay_payment_id: "mock_payment_mock_order_abc",
          razorpay_signature: "mock",
        })
      );
      await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === "/score/breakdown/pdf")).toHaveLength(2));
      expect(screen.queryByTestId("mock-payment-banner")).not.toBeInTheDocument();
    });

    it("Cancel dismisses the banner without verifying or downloading anything", async () => {
      const user = userEvent.setup();
      mockApiGet({ pdfResponses: [blocked402] });
      api.post.mockResolvedValueOnce({ data: { orderId: "mock_order_abc", amount: 9900, currency: "INR", keyId: null, mock: true } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await waitFor(() => expect(screen.getByTestId("download-report-btn")).toHaveTextContent("Rs.99/-"));
      await user.click(screen.getByTestId("download-report-btn"));
      await screen.findByTestId("mock-payment-banner");

      await user.click(screen.getByTestId("mock-payment-cancel-btn"));

      expect(screen.queryByTestId("mock-payment-banner")).not.toBeInTheDocument();
      expect(api.post).toHaveBeenCalledTimes(1); // only the order call — never verify
      expect(api.get.mock.calls.filter(([url]) => url === "/score/breakdown/pdf")).toHaveLength(1); // only the initial blocked attempt
    });
  });
});
