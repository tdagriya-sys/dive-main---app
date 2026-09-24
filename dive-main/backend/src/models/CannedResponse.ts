import { Schema, model, Document, Types } from "mongoose";

// Reusable reply text for the staff ticket console (Phase 4 of
// docs/ADMIN_PANEL_PLAN.md §4.4/§7). `categoryKey` optionally scopes a
// canned response to one category's picker (e.g. a billing-specific
// response never clutters a technical ticket's list); left unset, it shows
// for every category.
export interface ICannedResponse extends Document {
  _id: Types.ObjectId;
  title: string;
  body: string;
  categoryKey?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const cannedResponseSchema = new Schema<ICannedResponse>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    categoryKey: { type: String, trim: true, lowercase: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const CannedResponse = model<ICannedResponse>("CannedResponse", cannedResponseSchema);
