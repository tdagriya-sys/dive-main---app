import { Schema, model, Document, Types } from "mongoose";

// Admin-configurable ticket routing metadata (Phase 4 of
// docs/ADMIN_PANEL_PLAN.md §4.4). `key` is what Ticket.categoryKey stores —
// deliberately a plain string, not a Mongo ref, so a ticket keeps its
// category label even if the category row is later edited/deactivated;
// `getCategoryDefaults()` (services/ticketService.ts) falls back to sane
// defaults if the key doesn't resolve to an active row at all.
export interface ITicketCategory extends Document {
  _id: Types.ObjectId;
  key: string;
  label: string;
  defaultAssigneeId?: Types.ObjectId;
  defaultPriority: "low" | "normal" | "high" | "urgent";
  slaHours: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ticketCategorySchema = new Schema<ITicketCategory>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    defaultAssigneeId: { type: Schema.Types.ObjectId, ref: "User" },
    defaultPriority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    slaHours: { type: Number, default: 48, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const TicketCategory = model<ITicketCategory>("TicketCategory", ticketCategorySchema);
