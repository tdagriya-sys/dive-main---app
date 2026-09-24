import { Schema, model, Document, Types } from "mongoose";

/**
 * A person who is NOT (necessarily) a Divve user — an email address (and
 * optionally a name) that staff imported to run an onboarding/marketing
 * campaign to (see NotificationCampaign's `audience: "external"`).
 *
 * This one collection is both the mailing list AND the suppression list:
 * `unsubscribed` is set when the person uses the unsubscribe link in an
 * email, and is deliberately NEVER cleared by a re-import — importing the
 * same address again just adds it to another list, it does not resubscribe
 * them. An unsubscribed contact is also never deleted when a list is removed,
 * for the same reason: forgetting the address would let it be mailed again.
 *
 * `lists` are staff-chosen list names (a contact can be on several); a
 * campaign targets one list by name. `source` + `consentAttestedBy/At`
 * record where the address came from and who confirmed those people agreed to
 * hear from Divve at import time — a trail for consent/data-protection
 * questions later.
 */
export interface IExternalContact extends Document {
  _id: Types.ObjectId;
  email: string;
  name?: string;
  lists: string[];
  source: string;
  unsubscribed: boolean;
  unsubscribedAt?: Date;
  consentAttestedBy: Types.ObjectId;
  consentAttestedAt: Date;
  lastImportedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const externalContactSchema = new Schema<IExternalContact>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, trim: true },
    lists: { type: [String], default: [], index: true },
    source: { type: String, required: true, trim: true },
    unsubscribed: { type: Boolean, default: false, index: true },
    unsubscribedAt: { type: Date },
    consentAttestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    consentAttestedAt: { type: Date, required: true },
    lastImportedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const ExternalContact = model<IExternalContact>("ExternalContact", externalContactSchema);
