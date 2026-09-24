import { Schema, model, Document } from "mongoose";

/**
 * Raw log of every inbound webhook call (Phase 1 of docs/ADMIN_PANEL_PLAN.md
 * — "Webhook log viewer"). Recorded regardless of outcome (bad signature,
 * unconfigured secret, unrecognized event) so the admin panel can show real
 * delivery history instead of only what's in stdout — see
 * docs/PRODUCTION_READINESS_AUDIT.md #34/#35 for the exact class of incident
 * this would have made much faster to diagnose.
 */
export interface IWebhookEvent extends Document {
  provider: "razorpay" | "resend";
  eventType?: string;
  payload?: unknown;
  signatureValid?: boolean;
  processedOk: boolean;
  error?: string;
  receivedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>({
  provider: { type: String, required: true, index: true },
  eventType: { type: String, index: true },
  payload: { type: Schema.Types.Mixed },
  signatureValid: { type: Boolean },
  processedOk: { type: Boolean, required: true },
  error: { type: String },
  receivedAt: { type: Date, default: () => new Date(), index: true },
});

export const WebhookEvent = model<IWebhookEvent>("WebhookEvent", webhookEventSchema);
