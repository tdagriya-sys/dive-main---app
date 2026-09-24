import { Schema, model, Document, Types } from "mongoose";

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketSource = "contact_form" | "in_app" | "seed";

export interface ITicketCallbackRequest {
  requestedAt: Date;
  mobile: string;
  preferredWindow?: string;
  done: boolean;
}

/**
 * The support-ticket record itself (Phase 4 of docs/ADMIN_PANEL_PLAN.md
 * §4.4). `requesterUserId` is unset for a `source:"contact_form"` ticket —
 * the public contact form (controllers/contactController.ts) has no
 * account to attach, only the name/email/mobile the visitor typed in.
 *
 * `callbackRequested` covers both the public contact form (which always
 * asks for a callback slot — see contactController.ts) and the logged-in
 * "request a callback" checkbox (screens/Employees... no — SupportCard.jsx
 * on the user app). The plan's "(Premium) callback" gating is deliberately
 * NOT enforced here: `Subscription`/entitlements don't exist yet (Phase 6),
 * so every user can request one for now — revisit once a real plan check
 * exists to gate it to Premium only.
 */
export interface ITicket extends Document {
  _id: Types.ObjectId;
  refNo: string;
  subject: string;
  categoryKey: string;
  priority: TicketPriority;
  status: TicketStatus;
  requesterUserId?: Types.ObjectId;
  requesterEmail: string;
  requesterName: string;
  requesterMobile?: string;
  assigneeId?: Types.ObjectId;
  tags: string[];
  source: TicketSource;
  // Set only for source:"contact_form" tickets created by the one-off
  // migration script (scripts/migrateContactSubmissions.ts) — the original
  // ContactSubmission._id, so re-running the script is idempotent.
  sourceRef?: string;
  slaDueAt?: Date;
  firstRespondedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
  csatScore?: number;
  csatComment?: string;
  callbackRequested?: ITicketCallbackRequest;
  mergedIntoTicketId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const callbackRequestSchema = new Schema<ITicketCallbackRequest>(
  {
    requestedAt: { type: Date, required: true },
    mobile: { type: String, required: true },
    preferredWindow: { type: String },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const ticketSchema = new Schema<ITicket>(
  {
    refNo: { type: String, required: true, unique: true },
    subject: { type: String, required: true, trim: true },
    categoryKey: { type: String, required: true, trim: true, lowercase: true },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal", index: true },
    status: { type: String, enum: ["open", "pending", "resolved", "closed"], default: "open", index: true },
    requesterUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    requesterEmail: { type: String, required: true, trim: true, lowercase: true },
    requesterName: { type: String, required: true, trim: true },
    requesterMobile: { type: String, trim: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    tags: { type: [String], default: [] },
    source: { type: String, enum: ["contact_form", "in_app", "seed"], required: true },
    sourceRef: { type: String, index: true },
    slaDueAt: { type: Date },
    firstRespondedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    csatScore: { type: Number, min: 1, max: 5 },
    csatComment: { type: String, trim: true },
    callbackRequested: { type: callbackRequestSchema },
    mergedIntoTicketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
  },
  { timestamps: true }
);

export const Ticket = model<ITicket>("Ticket", ticketSchema);
