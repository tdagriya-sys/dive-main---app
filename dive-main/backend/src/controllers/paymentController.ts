import { Response, Request } from "express";
import Razorpay from "razorpay";
import { AuthedRequest } from "../middleware/auth";
import { verifyReportPaymentSchema } from "../validators/payments";
import { env } from "../config/env";
import * as paymentService from "../services/paymentService";

export async function createReportOrder(req: AuthedRequest, res: Response) {
  const order = await paymentService.createReportOrder(String(req.userId));
  res.status(201).json(order);
}

export async function verifyReportPayment(req: AuthedRequest, res: Response) {
  const input = verifyReportPaymentSchema.parse(req.body);
  await paymentService.verifyReportPayment(String(req.userId), input);
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
export async function razorpayWebhook(req: RawBodyRequest, res: Response) {
  if (!paymentService.isWebhookConfigured()) {
    // Nothing to verify against — ack so Razorpay doesn't retry forever, but
    // don't process anything from an endpoint that was never actually set up.
    return res.status(200).json({ received: true, processed: false });
  }

  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.rawBody;
  if (typeof signature !== "string" || !rawBody) {
    return res.status(400).json({ error: "MISSING_SIGNATURE", message: "Missing webhook signature or body." });
  }

  const valid = Razorpay.validateWebhookSignature(rawBody.toString(), signature, env.razorpay.webhookSecret!);
  if (!valid) {
    return res.status(400).json({ error: "INVALID_SIGNATURE", message: "Webhook signature verification failed." });
  }

  const event = req.body?.event as string | undefined;
  if (event === "payment.captured") {
    const orderId = req.body?.payload?.payment?.entity?.order_id as string | undefined;
    const paymentId = req.body?.payload?.payment?.entity?.id as string | undefined;
    if (orderId && paymentId) {
      await paymentService.handleReportWebhookPaymentCaptured(orderId, paymentId);
    }
  }
  // Any other event type: acknowledged, intentionally ignored — this
  // endpoint only cares about payment.captured for now.

  res.status(200).json({ received: true, processed: true });
}
