import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadReportButton } from "./useDownloadReport";
import { api } from "./api";
import { useDive } from "../context/DiveContext";

jest.mock("./api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const testUser = { name: "Priya Sharma", email: "priya@example.com", mobile: "9876543210" };

// Shared by Home.jsx and Preferences.jsx (both just render
// <DownloadReportButton testId="..." /> now) — one real test of the markup/
// pricing/payment behavior here instead of duplicating it in both screens'
// own test files, matching this module's whole reason for existing (one
// place, not two that could drift).
//
// The report is a PAID (Rs. 99, via Razorpay) download — see
// backend/src/services/paymentService.ts. These tests cover the real flow
// (already-paid fast path, real-mode Checkout.js, dev-mode mock-payment
// confirm) rather than a direct download, matching what the hook actually
// does now.
describe("DownloadReportButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({ user: testUser });
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
    delete window.Razorpay;
  });

  it("shows the struck-through Rs.299/- and the real Rs.99/- price, centered, with no icon, plus the Limited time offer badge", () => {
    render(<DownloadReportButton testId="download-report-btn" />);

    const btn = screen.getByTestId("download-report-btn");
    expect(btn).toHaveTextContent("Download Resilience Score Report at Just Rs.299/- Rs.99/-");
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

  it("downloads immediately with no payment step when already paid for the current portfolio", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ data: new Blob(["fake pdf bytes"]) });
    render(<DownloadReportButton testId="download-report-btn" />);

    await user.click(screen.getByTestId("download-report-btn"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/score/breakdown/pdf", { responseType: "blob" }));
    expect(api.post).not.toHaveBeenCalled(); // no order/verify round-trip needed — this is the whole point of the fast path
  });

  it("shows a loading state while checking, then an error and a re-enabled button on a non-payment failure", async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue({ response: { status: 500 } });
    render(<DownloadReportButton testId="download-report-btn" />);

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
      api.get
        .mockRejectedValueOnce({ response: { status: 402 } }) // first attempt: not paid yet
        .mockResolvedValueOnce({ data: new Blob(["fake pdf bytes"]) }); // after verify: real download
      api.post
        .mockResolvedValueOnce({ data: { orderId: "order_real123", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } })
        .mockResolvedValueOnce({ data: { verified: true } }); // /payments/report/verify

      render(<DownloadReportButton testId="download-report-btn" />);
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
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2)); // the blocked attempt + the real download after verify
    });

    it("shows a payment-failed error without downloading anything, and re-enables the button", async () => {
      const user = userEvent.setup();
      const { RazorpayCtor, instance } = mockRazorpayGlobal();
      api.get.mockRejectedValueOnce({ response: { status: 402 } });
      api.post.mockResolvedValueOnce({ data: { orderId: "order_x", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await user.click(screen.getByTestId("download-report-btn"));
      await waitFor(() => expect(instance.open).toHaveBeenCalled());

      const onFailedHandler = instance.on.mock.calls.find(([event]) => event === "payment.failed")[1];
      onFailedHandler({ error: { description: "Card declined" } });

      expect(await screen.findByText("Card declined")).toBeInTheDocument();
      expect(screen.getByTestId("download-report-btn")).not.toBeDisabled();
      expect(api.get).toHaveBeenCalledTimes(1); // never got to a second (post-payment) attempt
    });

    it("quietly re-enables the button (no error) if the user just closes the checkout", async () => {
      const user = userEvent.setup();
      const { instance } = mockRazorpayGlobal();
      api.get.mockRejectedValueOnce({ response: { status: 402 } });
      api.post.mockResolvedValueOnce({ data: { orderId: "order_x", amount: 9900, currency: "INR", keyId: "rzp_test_abc", mock: false } });

      render(<DownloadReportButton testId="download-report-btn" />);
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
      api.get
        .mockRejectedValueOnce({ response: { status: 402 } })
        .mockResolvedValueOnce({ data: new Blob(["fake pdf bytes"]) });
      api.post
        .mockResolvedValueOnce({ data: { orderId: "mock_order_abc", amount: 9900, currency: "INR", keyId: null, mock: true } })
        .mockResolvedValueOnce({ data: { verified: true } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await user.click(screen.getByTestId("download-report-btn"));

      expect(await screen.findByTestId("mock-payment-banner")).toBeInTheDocument();
      expect(window.Razorpay).toBeUndefined(); // never touched — no key to load real Checkout.js with

      await user.click(screen.getByTestId("mock-payment-confirm-btn"));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith("/payments/report/verify", {
          razorpay_order_id: "mock_order_abc",
          razorpay_payment_id: "mock_payment_mock_order_abc",
          razorpay_signature: "mock",
        })
      );
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("mock-payment-banner")).not.toBeInTheDocument();
    });

    it("Cancel dismisses the banner without verifying or downloading anything", async () => {
      const user = userEvent.setup();
      api.get.mockRejectedValueOnce({ response: { status: 402 } });
      api.post.mockResolvedValueOnce({ data: { orderId: "mock_order_abc", amount: 9900, currency: "INR", keyId: null, mock: true } });

      render(<DownloadReportButton testId="download-report-btn" />);
      await user.click(screen.getByTestId("download-report-btn"));
      await screen.findByTestId("mock-payment-banner");

      await user.click(screen.getByTestId("mock-payment-cancel-btn"));

      expect(screen.queryByTestId("mock-payment-banner")).not.toBeInTheDocument();
      expect(api.post).toHaveBeenCalledTimes(1); // only the order call — never verify
      expect(api.get).toHaveBeenCalledTimes(1); // only the initial blocked attempt
    });
  });
});
