import { Schema, model, Document, Types } from "mongoose";

/**
 * A pending invitation to become a staff account (Phase 3 of
 * docs/ADMIN_PANEL_PLAN.md) — the only way a NEW superadmin/admin/employee
 * account gets created, other than the one-time `createSuperadmin.ts`
 * bootstrap script. `tokenHash` (not the raw token) is the only thing ever
 * persisted — see `services/staffInviteService.ts`'s own comment on why this
 * uses a plain SHA-256 hash rather than bcrypt, unlike a password/OTP.
 */
export type StaffInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface IStaffInvite extends Document {
  _id: Types.ObjectId;
  email: string;
  staffRole: "superadmin" | "admin" | "employee";
  roleId?: Types.ObjectId; // required iff staffRole === "employee"
  tokenHash: string;
  expiresAt: Date;
  status: StaffInviteStatus;
  invitedBy: Types.ObjectId;
  acceptedUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const staffInviteSchema = new Schema<IStaffInvite>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    staffRole: { type: String, enum: ["superadmin", "admin", "employee"], required: true },
    roleId: { type: Schema.Types.ObjectId, ref: "Role" },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ["pending", "accepted", "revoked", "expired"], required: true, default: "pending", index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    acceptedUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

staffInviteSchema.index({ email: 1, status: 1 });

export const StaffInvite = model<IStaffInvite>("StaffInvite", staffInviteSchema);
