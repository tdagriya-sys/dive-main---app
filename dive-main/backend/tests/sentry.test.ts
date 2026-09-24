import { initSentry, captureException } from "../src/lib/sentry";

// Phase 0.2 of docs/ADMIN_PANEL_PLAN.md — lib/sentry.ts. Both functions are
// gated to a no-op without SENTRY_DSN, and unconditionally under
// NODE_ENV=test (tests/setupEnv.ts always blanks SENTRY_DSN too) — so what's
// verifiable here is exactly that: neither ever throws, regardless of what's
// passed. Exercising a REAL Sentry.init/captureException call would need a
// live DSN, out of scope for an automated test the same way real Resend/
// Razorpay delivery is.
describe("sentry (no-op under NODE_ENV=test / without SENTRY_DSN)", () => {
  it("initSentry does not throw", () => {
    expect(() => initSentry()).not.toThrow();
  });

  it("captureException does not throw for an Error with extra context", () => {
    expect(() => captureException(new Error("boom"), { path: "/x", method: "GET" })).not.toThrow();
  });

  it("captureException does not throw for a non-Error value", () => {
    expect(() => captureException("a plain string rejection")).not.toThrow();
  });
});
