import { Schema, model, Document, Types } from "mongoose";

export type DataRequestType = "export" | "delete";
export type DataRequestStatus = "pending" | "fulfilled" | "rejected";

/**
 * DPDP (Digital Personal Data Protection Act) data-subject request queue
 * (Phase 7 of docs/ADMIN_PANEL_PLAN.md §4.6/§5.3/§11). Two request shapes:
 *
 * - `"export"` — the user asked for a copy of their data. Queued for staff
 *   review (`pending`); fulfilling it (services/dataRequestService.ts::
 *   fulfilDataRequest) generates the export JSON on demand and streams it
 *   straight back to the requesting staff member rather than writing
 *   anywhere — same "no blob storage in this codebase" posture as invoice/
 *   report PDFs (`fileKey` stays unset; it's in the plan's own model sketch
 *   for a deployment that adds real storage later).
 * - `"delete"` — always created already `fulfilled`, whichever path
 *   triggers it: the user's own instant self-serve delete
 *   (userController.ts::deleteMe) stamps one for the compliance trail at the
 *   moment it happens, and admin/dataRequestsController.ts's fulfil path
 *   performs the deletion itself for a request that arrived outside the app
 *   (e.g. an email). There is no "pending" self-serve deletion state to
 *   review — deletion is instant either way, only WHO triggered it differs.
 */
export interface IDataRequest extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId; // absent once a "delete" request's target account no longer exists
  userEmailSnapshot: string; // denormalised so the row stays readable after account deletion
  type: DataRequestType;
  status: DataRequestStatus;
  requestedAt: Date;
  fulfilledAt?: Date;
  handledBy?: string; // staff email; unset for a user's own self-serve action
  rejectionReason?: string;
}

const dataRequestSchema = new Schema<IDataRequest>({
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  userEmailSnapshot: { type: String, required: true },
  type: { type: String, enum: ["export", "delete"], required: true },
  status: { type: String, enum: ["pending", "fulfilled", "rejected"], required: true, default: "pending", index: true },
  requestedAt: { type: Date, required: true, default: () => new Date() },
  fulfilledAt: { type: Date },
  handledBy: { type: String },
  rejectionReason: { type: String },
});

export const DataRequest = model<IDataRequest>("DataRequest", dataRequestSchema);
