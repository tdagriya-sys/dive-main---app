import { Response } from "express";
import { Types } from "mongoose";
import { User } from "../../models/User";
import { Role } from "../../models/Role";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { inviteStaffSchema, updateEmployeeSchema } from "../../validators/staffInvite";
import { createStaffInvite, sendStaffInviteEmail, revokeStaffInvite, listPendingInvites } from "../../services/staffInviteService";
import { recordAudit } from "../../services/auditLog";

/**
 * Employees & staff-invite admin API (Phase 3 of docs/ADMIN_PANEL_PLAN.md).
 * Every route here is gated by the superadmin-only `employees.manage`
 * permission (see auth/permissions.ts's SUPERADMIN_ONLY) — an admin cannot
 * see or manage other staff accounts at all, only a superadmin can.
 */

const STAFF_ROLE_LABELS: Record<string, string> = { superadmin: "Superadmin", admin: "Admin", employee: "Employee" };

export async function listEmployees(_req: StaffRequest, res: Response) {
  const [staffUsers, invites, roles] = await Promise.all([
    User.find({ staffRole: { $ne: null } })
      .select("name email staffRole roleId status staffMeta.totpEnabled staffMeta.lastAdminLoginAt createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    listPendingInvites(),
    Role.find({}).select("_id label").lean(),
  ]);

  const roleLabelById = new Map(roles.map((r) => [String(r._id), r.label]));

  res.status(200).json({
    staff: staffUsers.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      staffRole: u.staffRole,
      roleId: u.roleId ? String(u.roleId) : undefined,
      roleLabel: u.roleId ? roleLabelById.get(String(u.roleId)) : undefined,
      status: u.status,
      totpEnabled: u.staffMeta?.totpEnabled ?? false,
      lastAdminLoginAt: u.staffMeta?.lastAdminLoginAt,
      createdAt: u.createdAt,
    })),
    invites,
  });
}

export async function inviteEmployee(req: StaffRequest, res: Response) {
  const data = inviteStaffSchema.parse(req.body);
  const { invite, rawToken } = await createStaffInvite({ ...data, invitedBy: req.staff!.userId });
  const emailResult = await sendStaffInviteEmail(data.email, rawToken, STAFF_ROLE_LABELS[data.staffRole]);

  await recordAudit(
    { action: "staff.invited", resourceType: "StaffInvite", resourceId: String(invite._id), meta: { email: data.email, staffRole: data.staffRole } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(201).json({
    invite: { id: String(invite._id), email: invite.email, staffRole: invite.staffRole, expiresAt: invite.expiresAt },
    ...(emailResult.devInviteLink ? { devInviteLink: emailResult.devInviteLink } : {}),
  });
}

export async function revokeInvite(req: StaffRequest, res: Response) {
  const invite = await revokeStaffInvite(req.params.id);
  await recordAudit(
    { action: "staff.invite_revoked", resourceType: "StaffInvite", resourceId: String(invite._id), meta: { email: invite.email } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ invite: { id: String(invite._id), status: invite.status } });
}

// Never touches a target whose CURRENT staffRole is "superadmin" — promoting
// or demoting the top tier is deliberately out of scope for this generic
// edit endpoint (see updateEmployeeSchema's own comment: staffRole here is
// restricted to "admin"|"employee" for the same reason).
export async function updateEmployee(req: StaffRequest, res: Response) {
  const data = updateEmployeeSchema.parse(req.body);
  const target = await User.findOne({ _id: req.params.id, staffRole: { $ne: null } });
  if (!target) throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "Staff account not found.");
  if (target.staffRole === "superadmin") {
    throw new ApiError(400, "CANNOT_EDIT_SUPERADMIN", "Superadmin accounts can't be edited from this screen.");
  }

  const before = { staffRole: target.staffRole, roleId: target.roleId, status: target.status };

  if (data.staffRole) target.staffRole = data.staffRole;
  if (data.roleId !== undefined) target.roleId = data.roleId ? new Types.ObjectId(data.roleId) : undefined;
  if (data.status) target.status = data.status;

  if (target.staffRole === "employee" && !target.roleId) {
    throw new ApiError(400, "ROLE_REQUIRED", "An employee must have a role assigned.");
  }
  if (target.roleId) {
    const role = await Role.findById(target.roleId).lean();
    if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "The selected role doesn't exist.");
  }

  await target.save();
  await recordAudit(
    { action: "staff.updated", resourceType: "User", resourceId: String(target._id), before, after: { staffRole: target.staffRole, roleId: target.roleId, status: target.status } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(200).json({ employee: { id: String(target._id), staffRole: target.staffRole, roleId: target.roleId, status: target.status } });
}
