import { randomUUID } from "crypto";
import Razorpay from "razorpay";
// Deep import of the SDK's own signature-verification helper — not
// re-exported off the main `Razorpay` class (unlike validateWebhookSignature,
// a static method there), but it's the same official implementation Razorpay's
// own docs point to, not a hand-rolled HMAC guess.
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import { env, isPlaceholder } from "../config/env";
import { User } from "../models/User";
import { Payment, PaymentPurpose, IPayment } from "../models/Payment";
import { UsageGrant } from "../models/UsageGrant";
import { ApiError } from "../middleware/errorHandler";
import { generateInvoiceForPayment } from "./invoiceService";
import { getReportPricing } from "./adminSettingService";
import { getPlan } from "./entitlementService";
import { logger } from "../lib/logger";

// Best-effort — a payment that already succeeded must never be undone by a
// failure to generate its GST invoice; the invoice can always be regenerated
// on demand later (invoiceService.ts::generateInvoiceForPayment is
// idempotent per payment) if this ever needs a manual retry.
async function generateInvoiceBestEffort(payment: IPayment): Promise<void> {
  try {
    await generateInvoiceForPayment(payment);
  } catch (err) {
    logger.error({ err, paymentId: String(payment._id) }, "[invoiceService] failed to generate invoice");
  }
}

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

// Thin re-export so paymentController.ts (which only imports `* as
// paymentService`, never adminSettingService directly) has one place to get
// both the price it actually charges and the price it displays.
export async function getReportPricingForDisplay() {
  return getReportPricing();
}

export async function createReportOrder(userId: string): Promise<CreateOrderResult> {
  const { pricePaise: amount } = await getReportPricing();
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
  await generateInvoiceBestEffort(payment);
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

// Shared by ensureReportAccess and getReportComplimentaryStatus below — the
// total number of complimentary report unlocks this user gets across their
// current plan's `complimentaryReportDownloads` (SubscriptionPlan.
// entitlements — an admin-set benefit) plus a standing per-user UsageGrant
// (key "score_report", admin-grantable independent of plan — see
// UsageGrant.ts's own comment), or `null` for unlimited.
//
// `undefined` (a SubscriptionPlan document persisted before this field
// existed — Mongoose's schema `default: 0` only applies to documents
// created/saved after the field was added, never retroactively to existing
// ones read back via find/findOne) must be treated as 0, NOT passed through
// as-is: `undefined + grant.bonusTotal` is `NaN`, and `count >= NaN` is
// always false, which silently granted EVERY plan unlimited free downloads
// until this was caught live. A genuinely stored `null` (an admin explicitly
// chose "unlimited" through the admin UI, only possible on a document saved
// after this field existed) is the only thing that should mean unlimited.
async function totalComplimentaryReportAllowance(userId: string): Promise<number | null> {
  const [plan, grant] = await Promise.all([getPlan(userId), UsageGrant.findOne({ userId, key: "score_report" }).lean()]);
  const rawPlanLimit = plan.entitlements.complimentaryReportDownloads;
  const planLimit = rawPlanLimit === null ? null : rawPlanLimit ?? 0;
  if (planLimit === null) return null;
  return planLimit + (grant?.bonusTotal ?? 0);
}

// The gate scoreController.ts::downloadReportPdf actually calls — a superset
// of hasPaidForReport above that also unlocks a genuinely FREE download when
// the user is entitled to one (see totalComplimentaryReportAllowance). The
// limit counts distinct portfolio-version unlocks, never raw downloads:
// re-fetching an already-unlocked report never consumes it (hasPaidForReport
// already covers that for free, above), only a NEW portfolio change that
// would otherwise demand a fresh ₹-payment does — exactly mirroring how a
// real purchase behaves, just free. Each granted free unlock is recorded as
// a genuine ₹0 `Payment` row (isComplimentary: true) rather than a separate
// counter, so hasPaidForReport's existing query picks it up unchanged and
// the admin Revenue ledger sees it too.
export async function ensureReportAccess(userId: string): Promise<boolean> {
  if (await hasPaidForReport(userId)) return true;

  const [totalAllowance, complimentaryUsed, user] = await Promise.all([
    totalComplimentaryReportAllowance(userId),
    Payment.countDocuments({ userId, purpose: "SCORE_REPORT_PDF", status: "paid", isComplimentary: true }),
    User.findById(userId).select("portfolioVersion").lean(),
  ]);
  if (!user) return false;
  if (totalAllowance !== null && complimentaryUsed >= totalAllowance) return false; // exhausted — falls back to a real payment

  await Payment.create({
    userId,
    purpose: "SCORE_REPORT_PDF",
    amount: 0,
    currency: "INR",
    razorpayOrderId: `comp_${randomUUID()}`,
    status: "paid",
    isMock: false,
    isComplimentary: true,
    portfolioVersionAtPayment: user.portfolioVersion,
  });
  return true;
}

export interface ReportComplimentaryStatus {
  // null = unlimited on this plan/grant combination.
  total: number | null;
  used: number;
  // total - used, floored at 0; null when total is unlimited.
  remaining: number | null;
  // True when a download RIGHT NOW would succeed for free with no new
  // complimentary unit consumed at all — either a real prior payment or an
  // already-granted complimentary unlock for the CURRENT portfolio version.
  unlockedForCurrentPortfolio: boolean;
}

// Surfaced via GET /me/entitlements (subscriptionsController.ts) so the
// Subscription screen can show real complimentary-download status instead
// of nothing, and useDownloadReport.js can decide whether the download
// button should show a price at all — see both callers' own comments.
export async function getReportComplimentaryStatus(userId: string): Promise<ReportComplimentaryStatus> {
  const [total, used, unlockedForCurrentPortfolio] = await Promise.all([
    totalComplimentaryReportAllowance(userId),
    Payment.countDocuments({ userId, purpose: "SCORE_REPORT_PDF", status: "paid", isComplimentary: true }),
    hasPaidForReport(userId),
  ]);
  const remaining = total === null ? null : Math.max(0, total - used);
  return { total, used, remaining, unlockedForCurrentPortfolio };
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
  await generateInvoiceBestEffort(payment);
}

// Refunds (Phase 6b of docs/ADMIN_PANEL_PLAN.md §5.3) — generic over every
// `Payment` purpose (the one-off report PDF and both subscription charge
// types alike), gated by `subscriptions.refund` + step-up at the route level
// (adminSubscriptionsController — same bar as cancel/change-plan/grant since
// this moves real money). A partial refund is allowed (amountPaise below the
// payment's own `amount`); omitting it refunds the full remaining amount.
// Mirrors every other mock/real split in this file: a mock payment has no
// real Razorpay payment to refund against, so it's recorded locally only.
export async function refundPayment(paymentId: string, amountPaise?: number): Promise<IPayment> {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.status !== "paid") throw new ApiError(400, "PAYMENT_NOT_REFUNDABLE", "Only a paid payment can be refunded.");

  const alreadyRefunded = payment.refundedAmountPaise ?? 0;
  const remaining = payment.amount - alreadyRefunded;
  const amount = amountPaise ?? remaining;
  if (amount <= 0 || amount > remaining) {
    throw new ApiError(400, "INVALID_REFUND_AMOUNT", `Refund amount must be between 1 and ${remaining} paise (the remaining unrefunded balance).`);
  }

  let refundId: string;
  if (payment.isMock || env.razorpay.isPlaceholder) {
    refundId = `mock_refund_${randomUUID()}`;
  } else {
    if (!payment.razorpayPaymentId) throw new ApiError(400, "NO_RAZORPAY_PAYMENT", "This payment has no Razorpay payment id to refund.");
    const refund = await getClient().payments.refund(payment.razorpayPaymentId, { amount });
    refundId = refund.id;
  }

  payment.refundedAmountPaise = alreadyRefunded + amount;
  payment.refundIds = [...(payment.refundIds ?? []), refundId];
  await payment.save();
  return payment;
}
