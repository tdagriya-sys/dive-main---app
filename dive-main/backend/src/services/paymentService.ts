import { randomUUID } from "crypto";
import Razorpay from "razorpay";
// Deep import of the SDK's own signature-verification helper — not
// re-exported off the main `Razorpay` class (unlike validateWebhookSignature,
// a static method there), but it's the same official implementation Razorpay's
// own docs point to, not a hand-rolled HMAC guess.
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import { env, isPlaceholder } from "../config/env";
import { User } from "../models/User";
import { Payment, PaymentPurpose } from "../models/Payment";
import { ApiError } from "../middleware/errorHandler";

/**
 * Razorpay integration for paid features (today: the resilience-score PDF,
 * Rs. 99 — see scoreController.ts's downloadReportPdf). See
 * docs/RAZORPAY_SETUP_GUIDE.md for how to get real keys.
 *
 * Mock mode: whenever env.razorpay.isPlaceholder (no real RAZORPAY_KEY_ID/
 * SECRET set), every function here runs against a fake, clearly-labeled
 * (isMock: true) order/payment instead of calling the real Razorpay API —
 * same "placeholder means dev/mock mode, never silently pretend to be real"
 * convention as finvuService.ts's sandbox mode and otpService.ts's on-screen
 * fallback code. This is what lets local dev and the test suite exercise the
 * FULL order → pay → verify → download pipeline without a real Razorpay
 * account, while being structurally incapable of marking a real order "paid"
 * without a real, signature-verified Razorpay payment (mock orders can only
 * ever match other mock orders — see verifyReportPayment below).
 */

let razorpayClient: Razorpay | null = null;
function getClient(): Razorpay {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return razorpayClient;
}

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string | null; // null in mock mode — frontend never loads real Checkout.js then
  mock: boolean;
}

export async function createReportOrder(userId: string): Promise<CreateOrderResult> {
  const amount = env.reportPricePaise;
  const currency = "INR";
  const purpose: PaymentPurpose = "SCORE_REPORT_PDF";

  if (env.razorpay.isPlaceholder) {
    const orderId = `mock_order_${randomUUID()}`;
    await Payment.create({ userId, purpose, amount, currency, razorpayOrderId: orderId, status: "created", isMock: true });
    return { orderId, amount, currency, keyId: null, mock: true };
  }

  // receipt is Razorpay's own "your reference for this order" field, capped
  // at 40 chars — userId (24 hex chars) + a timestamp comfortably fits.
  const order = await getClient().orders.create({
    amount,
    currency,
    receipt: `rpt_${userId}_${Date.now()}`,
    notes: { userId, purpose },
  });
  await Payment.create({ userId, purpose, amount, currency, razorpayOrderId: order.id, status: "created", isMock: false });
  return { orderId: order.id, amount, currency, keyId: env.razorpay.keyId ?? null, mock: false };
}

export interface VerifyPaymentInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function verifyReportPayment(userId: string, input: VerifyPaymentInput): Promise<void> {
  const payment = await Payment.findOne({ razorpayOrderId: input.razorpay_order_id, userId });
  if (!payment) {
    // Either a garbage/replayed order id or someone else's order — not
    // something a retry can fix.
    throw new ApiError(400, "INVALID_ORDER", "This order can't be verified. Please start the payment again.");
  }

  // Already settled — almost always the webhook (handleReportWebhookPaymentCaptured)
  // winning the race and getting here first, which is routine once a real
  // RAZORPAY_WEBHOOK_SECRET is configured: Razorpay fires the webhook
  // server-to-server the instant it captures the payment, frequently faster
  // than this browser round-trip (Checkout's own handler callback, then this
  // API call). Treat it as success rather than INVALID_ORDER as long as the
  // payment id genuinely matches what was actually captured — the whole
  // point of the webhook is to be a reliability net *alongside* this path,
  // not something that starts intermittently breaking it the moment it's
  // turned on. A mismatched payment id for an already-paid order is still
  // rejected below, same as any other invalid request.
  if (payment.status === "paid") {
    if (payment.razorpayPaymentId === input.razorpay_payment_id) return;
    throw new ApiError(400, "INVALID_ORDER", "This order can't be verified. Please start the payment again.");
  }

  if (payment.status !== "created") {
    // "failed" (signature verification genuinely failed before) — not
    // something a plain retry with the same payload can fix either.
    throw new ApiError(400, "INVALID_ORDER", "This order can't be verified. Please start the payment again.");
  }

  if (payment.isMock) {
    // Reachable ONLY when the order itself was created in mock mode (i.e.
    // env.razorpay.isPlaceholder was true at order-creation time) — a real
    // Razorpay order is never saved with isMock: true, so this branch can
    // never mark a real payment "paid" without real signature verification
    // below. Still requires a payment id shaped like the frontend's mock
    // confirm button actually sends, not a blank/missing value.
    if (!input.razorpay_payment_id?.startsWith("mock_payment_")) {
      throw new ApiError(400, "INVALID_MOCK_PAYMENT", "Malformed mock payment confirmation.");
    }
  } else {
    const valid = validatePaymentVerification(
      { order_id: input.razorpay_order_id, payment_id: input.razorpay_payment_id },
      input.razorpay_signature,
      env.razorpay.keySecret!
    );
    if (!valid) {
      payment.status = "failed";
      await payment.save();
      throw new ApiError(400, "PAYMENT_VERIFICATION_FAILED", "We couldn't verify this payment. If money was deducted, it will be auto-refunded by your bank/Razorpay if this wasn't legitimate.");
    }
  }

  const user = await User.findById(userId).select("portfolioVersion").lean();
  payment.status = "paid";
  payment.razorpayPaymentId = input.razorpay_payment_id;
  payment.portfolioVersionAtPayment = user?.portfolioVersion ?? 0;
  await payment.save();
}

// The gate scoreController.ts's downloadReportPdf checks before generating
// anything — true only if this exact user has a "paid" SCORE_REPORT_PDF
// payment whose portfolioVersionAtPayment snapshot still matches their
// CURRENT portfolioVersion (see models/User.ts's own comment) — i.e. nothing
// holdings/AA-sync/age-related has changed since they paid.
export async function hasPaidForReport(userId: string): Promise<boolean> {
  const user = await User.findById(userId).select("portfolioVersion").lean();
  if (!user) return false;
  const paid = await Payment.exists({
    userId,
    purpose: "SCORE_REPORT_PDF",
    status: "paid",
    portfolioVersionAtPayment: user.portfolioVersion,
  });
  return !!paid;
}

// Called alongside diveScoreService.ts's invalidateDiveScoreCache, at every
// one of its same call sites (holdingsController's create/update/delete,
// aaController's AA sync, userController's age change) — see User.ts's
// portfolioVersion field comment for why these two invalidations travel
// together but are kept as two separate function calls rather than merged
// into one: invalidateDiveScoreCache is an in-memory, unawaited, purely
// synchronous cache clear, while this is a real DB write that callers should
// await — merging them would force every existing call site to start
// awaiting a function that never used to need it.
export async function invalidateReportPurchase(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $inc: { portfolioVersion: 1 } });
}

// POST /api/payments/webhook — see paymentController.ts. Verifies the
// request genuinely came from Razorpay (HMAC over the RAW request body,
// keyed with the separate webhook secret — see env.razorpay.webhookSecret's
// own comment) before touching anything. This exists as a reliability net
// alongside verifyReportPayment above, not a replacement for it: the
// frontend's own post-checkout verify call is what unlocks the download in
// the common case, but if the user closes the tab / loses connectivity
// between a successful charge and that call firing, this webhook is what
// still marks the payment "paid" server-side.
export function isWebhookConfigured(): boolean {
  return !isPlaceholder(env.razorpay.webhookSecret);
}

export async function handleReportWebhookPaymentCaptured(orderId: string, paymentId: string): Promise<void> {
  const payment = await Payment.findOne({ razorpayOrderId: orderId, status: "created" });
  if (!payment) return; // already verified via the frontend path, or not one of ours — nothing to do, never an error
  const user = await User.findById(payment.userId).select("portfolioVersion").lean();
  payment.status = "paid";
  payment.razorpayPaymentId = paymentId;
  payment.portfolioVersionAtPayment = user?.portfolioVersion ?? 0;
  await payment.save();
}
