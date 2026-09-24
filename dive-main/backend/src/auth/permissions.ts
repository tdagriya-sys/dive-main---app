/**
 * The full permission registry for the admin panel (Phase 0.3 of
 * docs/ADMIN_PANEL_PLAN.md §6). Permissions are plain strings, checked by
 * `requirePermission()` (middleware/auth.ts) — there is no separate DB
 * collection for the registry itself, only for `Role` documents that name a
 * subset of these.
 *
 * Role resolution (see resolvePermissions below):
 *   - superadmin — every permission here, always. Cannot be restricted.
 *   - admin      — ADMIN_DEFAULT_PERMISSIONS, i.e. everything except the
 *                  handful reserved for superadmin (roles/employees/publish).
 *   - employee   — exactly whatever their assigned Role.permissions contains.
 *                  No Role assigned = no permissions (safe default).
 */
export const PERMISSIONS = [
  "users.view",
  "users.suspend",
  "users.impersonate",
  "users.export",
  "users.delete",
  "analytics.view",
  "revenue.view",
  "plans.manage",
  "subscriptions.manage",
  "subscriptions.refund",
  "scoring_config.view",
  "scoring_config.edit",
  "scoring_config.publish",
  "instruments.manage",
  "tickets.view",
  "tickets.respond",
  "tickets.assign",
  "tickets.manage",
  "notifications.send",
  "notifications.manage_templates",
  "audit.view",
  "feature_flags.manage",
  "system.view",
  "system.manage",
  "employees.manage",
  "roles.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

// Reserved for superadmin only — granting these to an "admin" account by
// default would let any admin create a peer admin/superadmin, rewrite the
// scoring model's live values, or manage other staff's access, none of which
// should be a default admin capability.
const SUPERADMIN_ONLY: readonly Permission[] = ["roles.manage", "employees.manage", "scoring_config.publish"];

export const ADMIN_DEFAULT_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => !SUPERADMIN_ONLY.includes(p)
);

export type StaffRole = "superadmin" | "admin" | "employee";

export interface PermissionSubject {
  staffRole?: StaffRole | null;
  // For "admin": individually re-granted superadmin-only permissions (Phase 3
  // UI concept — "grantable per-account" per the plan). Empty/undefined today.
  extraPermissions?: string[];
  // For "employee": the resolved set of permissions from their assigned Role
  // (the caller looks the Role document up — this module has no DB access).
  rolePermissions?: string[];
}

// Pure function — given what the caller already resolved about a staff user
// (their staffRole, and for an employee, their Role's permissions), returns
// the full effective permission set. No DB access here, so it's trivially
// unit-testable without mongodb-memory-server.
export function resolvePermissions(subject: PermissionSubject): Set<Permission> {
  if (subject.staffRole === "superadmin") {
    return new Set(PERMISSIONS);
  }
  if (subject.staffRole === "admin") {
    const extra = (subject.extraPermissions || []).filter(isPermission);
    return new Set([...ADMIN_DEFAULT_PERMISSIONS, ...extra]);
  }
  if (subject.staffRole === "employee") {
    return new Set((subject.rolePermissions || []).filter(isPermission));
  }
  return new Set();
}

export function hasPermission(subject: PermissionSubject, permission: Permission): boolean {
  return resolvePermissions(subject).has(permission);
}
