import { Schema, model, Document } from "mongoose";

// Generic atomic-increment counter (Phase 4 of docs/ADMIN_PANEL_PLAN.md) —
// `_id` names the sequence (e.g. "ticket_ref"); `findOneAndUpdate` with
// `$inc` is atomic in MongoDB, so concurrent callers never collide on the
// same number. First user is Ticket.refNo (see services/ticketService.ts).
// `Document<string>` overrides Mongoose's default ObjectId `_id` typing to
// match the schema below, which uses a human-readable string id instead.
export interface ICounter extends Document<string> {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model<ICounter>("Counter", counterSchema);
