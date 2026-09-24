import { Response } from "express";
import { Role } from "../../models/Role";
import { User } from "../../models/User";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createRoleSchema, updateRoleSchema } from "../../validators/staffInvite";
import { isPermission } from "../../auth/permissions";
import { recordAudit } from "../../services/auditLog";

/**
 * Custom employee-role CRUD (Phase 3 of docs/ADMIN_PANEL_PLAN.md) — gated by
 * the superadmin-only `roles.manage` permission. Superadmin/admin never need
 * a Role document (their permission set is fixed in code); this is purely
 * for employee roles a superadmin defines.
 */

function assertValidPermissions(permissions: string[]) {
  const invalid = permissions.filter((p) => !isPermission(p));
  if (invalid.length > 0) {
    throw new ApiError(400, "INVALID_PERMISSIONS", `Unknown permission(s): ${invalid.join(", ")}`);
  }
}

export async function listRoles(_req: StaffRequest, res: Response) {
  const roles = await Role.find({}).sort({ label: 1 }).lean();
  res.status(200).json({ roles });
}

export async function createRole(req: StaffRequest, res: Response) {
  const data = createRoleSchema.parse(req.body);
  assertValidPermissions(data.permissions);

  const existing = await Role.findOne({ key: data.key }).lean();
  if (existing) throw new ApiError(409, "ROLE_KEY_EXISTS", "A role with this key already exists.");

  const role = await Role.create({ ...data, createdBy: req.staff!.userId });
  await recordAudit(
    { action: "role.created", resourceType: "Role", resourceId: String(role._id), after: { key: role.key, label: role.label, permissions: role.permissions } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ role });
}

export async function updateRole(req: StaffRequest, res: Response) {
  const data = updateRoleSchema.parse(req.body);
  if (data.permissions) assertValidPermissions(data.permissions);

  const role = await Role.findById(req.params.id);
  if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "Role not found.");

  const before = { label: role.label, description: role.description, permissions: role.permissions };
  if (data.label !== undefined) role.label = data.label;
  if (data.description !== undefined) role.description = data.description;
  if (data.permissions !== undefined) role.permissions = data.permissions;
  await role.save();

  await recordAudit(
    { action: "role.updated", resourceType: "Role", resourceId: String(role._id), before, after: { label: role.label, description: role.description, permissions: role.permissions } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ role });
}

export async function deleteRole(req: StaffRequest, res: Response) {
  const role = await Role.findById(req.params.id);
  if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "Role not found.");

  const assignedCount = await User.countDocuments({ roleId: role._id });
  if (assignedCount > 0) {
    throw new ApiError(400, "ROLE_IN_USE", `${assignedCount} employee(s) still have this role assigned — reassign them first.`);
  }

  await role.deleteOne();
  await recordAudit(
    { action: "role.deleted", resourceType: "Role", resourceId: String(role._id), before: { key: role.key, label: role.label } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ deleted: true });
}
