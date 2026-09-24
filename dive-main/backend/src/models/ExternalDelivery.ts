import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (campaign, external contact) email attempt — the external
 * counterpart of `UserNotification` for `channel: "email"` (which needs a real
 * `userId` an external contact doesn't have). Powers the campaign's
 * delivery stats and answers "did this person get it, and if not, why" later.
 * `email` is copied here so the record still makes sense if the contact is
 * later deleted.
 */
export interface IExternalDelivery extends Document {
  _id: Types.ObjectId;
  campaignId: Types.ObjectId;
  contactId: Types.ObjectId;
  email: string;
  status: "sent" | "failed";
  sentAt: Date;
}

const externalDeliverySchema = new Schema<IExternalDelivery>({
  campaignId: { type: Schema.Types.ObjectId, ref: "NotificationCampaign", required: true, index: true },
  contactId: { type: Schema.Types.ObjectId, ref: "ExternalContact", required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ["sent", "failed"], required: true },
  sentAt: { type: Date, required: true, default: () => new Date() },
});

export const ExternalDelivery = model<IExternalDelivery>("ExternalDelivery", externalDeliverySchema);
