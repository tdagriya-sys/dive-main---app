import { Schema, model, Document, Types } from "mongoose";
import { PERMISSIONS } from "../auth/permissions";

/**
 * A custom, named permission set assignable to an "employee" staff account
 * (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md). Superadmin/admin never need a Role
 * document — their permission set is fixed in code (see auth/permissions.ts)
 * — this collection exists purely for employee roles a superadmin defines
 * (e.g. "Support Agent", "Content Editor"), managed from the admin panel in
 * Phase 3.
 */
export interface IRole extends Document {
  _id: Types.ObjectId;
  key: string; // slug, e.g. "support_agent" — stable identifier, not renameable
  label: string;
  description?: string;
  permissions: string[];
  // System roles (none seeded yet as of Phase 0.3 — superadmin/admin are code-
  // level, not Role documents) would be undeletable; kept for forward-compat.
  isSystem: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    permissions: { type: [String], default: [], validate: (v: string[]) => v.every((p) => (PERMISSIONS as readonly string[]).includes(p)) },
    isSystem: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Role = model<IRole>("Role", roleSchema);
