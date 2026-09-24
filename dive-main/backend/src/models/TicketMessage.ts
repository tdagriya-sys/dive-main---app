import { Schema, model, Document, Types } from "mongoose";

export type TicketMessageAuthorType = "requester" | "staff" | "system";

/**
 * One message in a ticket's conversation thread (Phase 4 of
 * docs/ADMIN_PANEL_PLAN.md §4.4). `isInternalNote` messages are staff-only —
 * controllers/ticketsController.ts's requester-facing endpoints filter them
 * out unconditionally; never rely on the frontend to hide them.
 *
 * Attachments are deliberately NOT part of this schema yet — this app has no
 * persistent file-storage service (uploadMiddleware.ts is in-memory, for AI
 * ingest only, not durable storage), so wiring real attachment upload/
 * download is out of scope for this phase.
 */
export interface ITicketMessage extends Document {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId;
  authorType: TicketMessageAuthorType;
  authorId?: Types.ObjectId;
  authorLabel: string; // name/email snapshot, same convention as AuditLog.actorLabel
  body: string;
  isInternalNote: boolean;
  emailMessageId?: string;
  createdAt: Date;
}

const ticketMessageSchema = new Schema<ITicketMessage>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    authorType: { type: String, enum: ["requester", "staff", "system"], required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User" },
    authorLabel: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    isInternalNote: { type: Boolean, default: false },
    emailMessageId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ticketMessageSchema.index({ ticketId: 1, createdAt: 1 });

export const TicketMessage = model<ITicketMessage>("TicketMessage", ticketMessageSchema);
