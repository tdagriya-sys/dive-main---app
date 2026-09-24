import { Response, Request } from "express";
import Razorpay from "razorpay";
import { AuthedRequest } from "../middleware/auth";
import { verifyReportPaymentSchema } from "../validators/payments";
import { env } from "../config/env";
import * as paymentService from "../services/paymentService";
import { handleSubscriptionWebhookEvent } from "../services/subscriptionService";
import { emitActivity } from "../services/activityLog";
import { WebhookEvent } from "../models/WebhookEvent";

// Lets the frontend render the real, current price (DownloadReportButton)
// instead of a hardcoded figure — see adminSettingService.ts::getReportPricing.
export async function getReportPrice(_req: AuthedRequest, res: Response) {
  const pricing = await paymentService.getReportPricingForDisplay();
  res.status(200).json(pricing);
}

export async function createReportOrder(req: AuthedRequest, res: Response) {
  const order = await paymentService.createReportOrder(String(req.userId));
  res.status(201).json(order);
}

export async function verifyReportPayment(req: AuthedRequest, res: Response) {
  const input = verifyReportPaymentSchema.parse(req.body);
  await paymentService.verifyReportPayment(String(req.userId), input);
  emitActivity("report_purchased", { userId: req.userId, req });
  res.status(200).json({ verified: true });
}

// Express Request with the raw body Buffer app.ts's express.json({ verify })
// callback stashes on every request — webhook signature verification needs
// the exact original bytes Razorpay signed, not a re-serialized copy of the
// parsed JSON (whitespace/key-order can differ byte-for-byte from the
// original even for an object that deep-equals it, which would silently
// break signature verification for a real, legitimate webhook call).
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// POST /api/payments/webhook — deliberately public (no requireAuth):
// Razorpay calls this directly, server-to-server, with no user session at
// all. Authenticity comes entirely from the signature check below, not from
// who's calling. See docs/RAZORPAY_SETUP_GUIDE.md §5 for how to point a real
// Razorpay account at this endpoint and where RAZORPAY_WEBHOOK_SECRET comes
// from. Not configuring this is fine — see paymentService.ts's own comment
// on why this is a reliability net on top of, not a replacement for, the
// frontend's post-checkout verify call.
// Best-effort, fire-and-forget log (Phase 1 of docs/ADMIN_PANEL_PLAN.md —
// "Webhook log viewer") — never awaited on the hot path and never allowed to
// change what Razorpay actually gets back; a failure to LOG a webhook must
// never turn into a failure to ACK one.
function logWebhook(fields: Partial<IWebhookEventInput>) {
  WebhookEvent.create({ provider: "razorpay", receivedAt: new Date(), ...fields }).catch(() => {
    /* best-effort — see comment above */
  });
}
interface IWebhookEventInput {
  eventType?: string;
  payload?: unknown;
  signatureValid?: boolean;
  processedOk: boolean;
  error?: string;
}

export async function razorpayWebhook(req: RawBodyRequest, res: Response) {
  if (!paymentService.isWebhookConfigured()) {
    // Nothing to verify against — ack so Razorpay doesn't retry forever, but
    // don't process anything from an endpoint that was never actually set up.
    logWebhook({ processedOk: false, error: "WEBHOOK_NOT_CONFIGURED" });
    return res.status(200).json({ received: true, processed: false });
  }

  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.rawBody;
  if (typeof signature !== "string" || !rawBody) {
    logWebhook({ processedOk: false, error: "MISSING_SIGNATURE" });
    return res.status(400).json({ error: "MISSING_SIGNATURE", message: "Missing webhook signature or body." });
  }

  const valid = Razorpay.validateWebhookSignature(rawBody.toString(), signature, env.razorpay.webhookSecret!);
  if (!valid) {
    logWebhook({ signatureValid: false, processedOk: false, error: "INVALID_SIGNATURE", eventType: req.body?.event });
    return res.status(400).json({ error: "INVALID_SIGNATURE", message: "Webhook signature verification failed." });
  }

  const event = req.body?.event as string | undefined;
  if (event === "payment.captured") {
    const orderId = req.body?.payload?.payment?.entity?.order_id as string | undefined;
    const paymentId = req.body?.payload?.payment?.entity?.id as string | undefined;
    if (orderId && paymentId) {
      await paymentService.handleReportWebhookPaymentCaptured(orderId, paymentId);
    }
  } else if (event?.startsWith("subscription.") || event === "payment.failed") {
    // Phase 6a of docs/ADMIN_PANEL_PLAN.md — see subscriptionService.ts's
    // own top comment for why this is the authoritative path for the
    // Payment ledger, on top of (not instead of) the frontend's own
    // post-checkout verify call.
    await handleSubscriptionWebhookEvent(event, req.body?.payload ?? {});
  }
  // Any other event type: acknowledged, intentionally ignored.
  logWebhook({ eventType: event, signatureValid: true, processedOk: true, payload: req.body });

  res.status(200).json({ received: true, processed: true });
}
