import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "./api";
import { useDive } from "../context/DiveContext";
import { loadRazorpayCheckout } from "./loadRazorpayCheckout";

function fmtRs(paise) {
  return `Rs.${Math.round((paise || 0) / 100)}/-`;
}

async function triggerBlobDownload(res) {
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "divve-resilience-report.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Shared by Home.jsx and Preferences.jsx — both offer the exact same paid
// (admin-editable price, via Razorpay) resilience-score PDF download, so the
// whole pay -> verify -> fetch-blob -> trigger-download pipeline and its
// loading/error state live in one place instead of two copies that could
// quietly drift (endpoint, error copy, Razorpay options) out of sync.
//
// Flow, each call to download():
//   1. Try the download directly first (GET /score/breakdown/pdf). If this
//      user already paid for the CURRENT portfolio (see backend's
//      paymentService.ts — stays valid until holdings/age change), this
//      succeeds immediately with no payment step at all — critical so a
//      user who already paid, then navigates away and back (losing this
//      hook's local state) and clicks the button again, is never charged
//      twice just because the frontend forgot it already unlocked.
//   2. Only on a 402 PAYMENT_REQUIRED does this create a Razorpay order and
//      open Checkout. See backend/src/services/paymentService.ts's own
//      "mock mode" comment for what happens with no real Razorpay keys set —
//      this hook mirrors that with an inline "Dev Mode" confirm step instead
//      of loading real Checkout.js (there's no real key to load it with).
//   3. On a successful real payment, Razorpay's handler callback fires with
//      the order/payment id + signature; POSTing those to /payments/report/verify
//      is what actually flips the purchase to "paid" server-side. Only then
//      is the PDF fetched again (which now succeeds).
export function useDownloadReport() {
  const { entitlements, refreshEntitlements } = useDive();
  const [phase, setPhase] = useState("idle"); // idle | checking | awaiting-payment | verifying | downloading
  const [error, setError] = useState("");
  const [mockOrder, setMockOrder] = useState(null); // { orderId } while a dev-mode "simulate payment" confirmation is pending
  // { pricePaise, originalPricePaise } | null while loading — admin-editable
  // (see backend/src/services/adminSettingService.ts::getReportPricing), so
  // the button's price text is fetched rather than hardcoded.
  const [price, setPrice] = useState(null);

  // { total, used, remaining, unlockedForCurrentPortfolio } | undefined —
  // rides on the app-wide entitlements fetch (DiveContext.js), not a
  // separate call. Drives whether the button shows a price at all: a user
  // who's already unlocked the current portfolio, or still has a
  // complimentary unit left (remaining null = unlimited, or > 0), sees no
  // charge whatsoever — only someone with nothing left to fall back on sees
  // the real price. `undefined` while entitlements haven't loaded yet is
  // treated as "unknown", same as `willBeFree: false`, so the button falls
  // back to the plain no-price label rather than guessing either way.
  const reportAccess = entitlements?.reportAccess;
  const willBeFree = reportAccess ? reportAccess.unlockedForCurrentPortfolio || reportAccess.remaining === null || reportAccess.remaining > 0 : false;

  useEffect(() => {
    let cancelled = false;
    api
      .get("/payments/report/price")
      .then(({ data }) => {
        if (!cancelled) setPrice(data);
      })
      // Best-effort — a failed price fetch just means the button shows no
      // price text until a retry/remount; download() itself is unaffected
      // and will surface its own error if the actual payment flow fails.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAndSavePdf = async () => {
    setPhase("downloading");
    const res = await api.get("/score/breakdown/pdf", { responseType: "blob" });
    await triggerBlobDownload(res);
    // Refreshes reportAccess (a just-consumed complimentary unit, or a
    // newly-true unlockedForCurrentPortfolio) so the button/usage screen
    // reflect it without needing a full remount.
    refreshEntitlements();
  };

  const verifyAndDownload = async (payload) => {
    setPhase("verifying");
    await api.post("/payments/report/verify", payload);
    await fetchAndSavePdf();
  };

  const startPayment = async (user) => {
    setPhase("checking");
    const order = await api.post("/payments/report/order");
    const { orderId, amount, currency, keyId, mock } = order.data;

    if (mock) {
      // No real RAZORPAY_KEY_ID/SECRET configured on the backend — see
      // paymentService.ts. Surface the dev-mode confirm UI (rendered by
      // DownloadReportButton below) instead of trying to load real
      // Checkout.js with a null key.
      setMockOrder({ orderId });
      setPhase("idle");
      return;
    }

    await loadRazorpayCheckout();
    setPhase("awaiting-payment");
    const rzp = new window.Razorpay({
      key: keyId,
      order_id: orderId,
      amount,
      currency,
      name: "DIVVE",
      description: "Resilience Score Report",
      prefill: { name: user?.name, email: user?.email, contact: user?.mobile },
      theme: { color: "#E3B856" },
      handler: (response) => {
        verifyAndDownload({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }).catch(() => {
          setError("Payment succeeded, but we couldn't verify it just now. Try downloading again from Profile — it won't charge you a second time.");
          setPhase("idle");
        });
      },
      modal: {
        // Not an error — the user just closed the checkout without paying.
        ondismiss: () => setPhase("idle"),
      },
    });
    rzp.on("payment.failed", (resp) => {
      setError(resp?.error?.description || "Payment failed. Please try again.");
      setPhase("idle");
    });
    rzp.open();
  };

  const download = async (user) => {
    setError("");
    setMockOrder(null);
    setPhase("checking");
    try {
      await fetchAndSavePdf(); // fast path: already paid for the current portfolio
      setPhase("idle");
    } catch (err) {
      if (err?.response?.status === 402) {
        try {
          await startPayment(user);
        } catch (payErr) {
          setError("Couldn't start the payment. Please try again.");
          setPhase("idle");
        }
      } else {
        setError("Couldn't generate your report. Please try again.");
        setPhase("idle");
      }
    }
  };

  const confirmMockPayment = async () => {
    if (!mockOrder) return;
    setError("");
    try {
      await verifyAndDownload({
        razorpay_order_id: mockOrder.orderId,
        razorpay_payment_id: `mock_payment_${mockOrder.orderId}`,
        razorpay_signature: "mock",
      });
      setMockOrder(null);
      setPhase("idle");
    } catch (err) {
      setError("Couldn't complete the simulated payment.");
      setPhase("idle");
    }
  };

  const cancelMockPayment = () => setMockOrder(null);

  return {
    downloading: phase !== "idle",
    phase,
    error,
    mockOrder,
    price,
    willBeFree,
    download, // takes the current user object (name/email/mobile) for Razorpay's checkout prefill
    confirmMockPayment,
    cancelMockPayment,
  };
}

const PHASE_LABEL = {
  checking: "Preparing…",
  "awaiting-payment": "Complete payment…",
  verifying: "Verifying payment…",
  downloading: "Preparing report…",
};

// Shared button, not just shared logic/copy — Home.jsx and Preferences.jsx
// both offer the exact same download, and this markup (struck-through price,
// badge) is involved enough now that duplicating it in two places risked the
// same drift the hook above was already written to avoid. The price itself
// is fetched (useDownloadReport's own `price` state), not hardcoded — see
// backend/src/services/adminSettingService.ts::getReportPricing — so an
// admin-set price change shows up here with no frontend redeploy needed.
export function DownloadReportButton({ testId }) {
  const { user } = useDive();
  const { downloading, phase, error, mockOrder, price, willBeFree, download, confirmMockPayment, cancelMockPayment } = useDownloadReport();
  // Only show a price at all once we know it won't be free — a user with a
  // complimentary download available (plan benefit or admin grant, already
  // merged — see useDownloadReport's own comment) sees no charge whatsoever.
  const showPrice = Boolean(price) && !willBeFree;
  // Only frame this as a discount (strikethrough + badge) when the admin
  // actually set a higher "was" price — otherwise it's just a plain price,
  // never an invented "was ₹X" that doesn't reflect anything real.
  const hasDiscount = showPrice && price?.originalPricePaise != null && price.originalPricePaise > price.pricePaise;
  return (
    <div className="w-full md:max-w-sm md:mx-auto">
      {error && <p className="text-xs text-[var(--red)] font-semibold mb-3 text-center">{error}</p>}

      {mockOrder ? (
        // Dev Mode — the backend has no real Razorpay keys configured (see
        // paymentService.ts). This still exercises the real order -> verify
        // -> download pipeline end to end, just without a real Checkout.js
        // modal or real money, and is clearly labeled as such so it's never
        // mistaken for the real flow.
        <div className="rounded-2xl border border-dashed border-[var(--dive-blue)]/40 bg-[var(--dive-blue)]/10 p-4 text-center" data-testid="mock-payment-banner">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--dive-blue-dark)] mb-1">🧪 Dev Mode — Razorpay isn't configured</p>
          <p className="text-xs text-[var(--text-secondary)] mb-3">No real payment will happen. Simulate a successful {price ? fmtRs(price.pricePaise) : ""} payment to test the download?</p>
          <div className="flex gap-2">
            <button data-testid="mock-payment-confirm-btn" onClick={confirmMockPayment} disabled={downloading}
              className="flex-1 gold-btn rounded-full py-2.5 text-sm font-bold disabled:opacity-60">
              {downloading ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Simulate payment"}
            </button>
            <button data-testid="mock-payment-cancel-btn" onClick={cancelMockPayment} disabled={downloading}
              className="flex-1 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-2.5 text-sm font-bold disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          {/* Top-right badge — half-overlapping the button's own top-right
              corner is the standard "sale sticker" placement, not floating
              free above it. */}
          {hasDiscount && (
            <span className="absolute -top-2.5 -right-2 z-10 bg-[var(--red)] text-white text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full shadow-md whitespace-nowrap">
              Limited time offer
            </span>
          )}
          <button data-testid={testId} onClick={() => download(user)} disabled={downloading}
            className="w-full gold-btn rounded-full py-3.5 font-bold flex items-center justify-center text-center disabled:opacity-60 transition-colors">
            {downloading ? (
              <span className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> {PHASE_LABEL[phase] || "Preparing…"}</span>
            ) : !showPrice ? (
              <span>Download Resilience Score Report</span>
            ) : hasDiscount ? (
              <span>
                Download Resilience Score Report at Just{" "}
                <span className="line-through decoration-[var(--red)] decoration-2 opacity-70">{fmtRs(price.originalPricePaise)}</span>{" "}
                {fmtRs(price.pricePaise)}
              </span>
            ) : (
              <span>Download Resilience Score Report for {fmtRs(price.pricePaise)}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
