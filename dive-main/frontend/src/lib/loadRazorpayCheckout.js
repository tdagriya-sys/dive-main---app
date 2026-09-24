// Loads Razorpay's Checkout.js exactly once no matter how many separate
// features on the page need it (the resilience-report one-off payment in
// useDownloadReport.js, and the Premium subscription checkout in
// screens/Subscription.jsx) — a second call while the first is still
// loading, or after it already loaded, reuses the same promise/global
// instead of injecting a second <script> tag.
let razorpayScriptPromise = null;
export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = () => {
        razorpayScriptPromise = null; // let a retry actually retry, not resolve to a permanently-broken cached failure
        reject(new Error("Failed to load Razorpay checkout"));
      };
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}
