import { Schema, model, Document } from "mongoose";

export interface IContactSubmission extends Document {
  name: string;
  email: string;
  mobile: string;
  subject: string;
  description: string;
  timeSlot: string;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const contactSubmissionSchema = new Schema<IContactSubmission>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    mobile: { type: String, required: true, trim: true },
    subject: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    timeSlot: { type: String, required: true, trim: true }, // e.g. "Morning · 9 AM – 12 PM"
    ip: { type: String }, // best-effort, for abuse triage alongside contactLimiter
  },
  { timestamps: true }
);

export const ContactSubmission = model<IContactSubmission>("ContactSubmission", contactSubmissionSchema);
