import { PERMISSIONS, ADMIN_DEFAULT_PERMISSIONS, resolvePermissions, hasPermission, isPermission } from "../src/auth/permissions";

// Phase 0.3 of docs/ADMIN_PANEL_PLAN.md §6 — pure permission-resolution logic,
// no DB involved (requireStaff, middleware/auth.ts, is what wires in the DB
// lookups this function is deliberately kept free of).
describe("auth/permissions", () => {
  it("superadmin gets every registered permission", () => {
    const resolved = resolvePermissions({ staffRole: "superadmin" });
    for (const p of PERMISSIONS) expect(resolved.has(p)).toBe(true);
    expect(resolved.size).toBe(PERMISSIONS.length);
  });

  it("admin gets every permission except the superadmin-reserved ones", () => {
    const resolved = resolvePermissions({ staffRole: "admin" });
    expect(resolved.has("roles.manage")).toBe(false);
    expect(resolved.has("employees.manage")).toBe(false);
    expect(resolved.has("scoring_config.publish")).toBe(false);
    expect(resolved.has("users.suspend")).toBe(true);
    expect(resolved.size).toBe(ADMIN_DEFAULT_PERMISSIONS.length);
  });

  it("admin can be individually re-granted a superadmin-reserved permission", () => {
    const resolved = resolvePermissions({ staffRole: "admin", extraPermissions: ["roles.manage"] });
    expect(resolved.has("roles.manage")).toBe(true);
    expect(resolved.has("employees.manage")).toBe(false);
  });

  it("admin's extraPermissions ignores anything not a real permission string", () => {
    const resolved = resolvePermissions({ staffRole: "admin", extraPermissions: ["not_a_real_permission"] });
    expect(resolved.has("not_a_real_permission" as never)).toBe(false);
  });

  it("employee gets exactly their role's permissions, nothing more", () => {
    const resolved = resolvePermissions({ staffRole: "employee", rolePermissions: ["tickets.view", "tickets.respond"] });
    expect(resolved.has("tickets.view")).toBe(true);
    expect(resolved.has("tickets.respond")).toBe(true);
    expect(resolved.has("tickets.manage")).toBe(false);
    expect(resolved.has("roles.manage")).toBe(false);
    expect(resolved.size).toBe(2);
  });

  it("employee with no role assigned gets zero permissions (safe default)", () => {
    expect(resolvePermissions({ staffRole: "employee" }).size).toBe(0);
  });

  it("employee's rolePermissions ignores anything not a real permission string", () => {
    const resolved = resolvePermissions({ staffRole: "employee", rolePermissions: ["tickets.view", "made_up.permission"] });
    expect(Array.from(resolved)).toEqual(["tickets.view"]);
  });

  it("a non-staff subject (staffRole undefined/null) gets zero permissions", () => {
    expect(resolvePermissions({}).size).toBe(0);
    expect(resolvePermissions({ staffRole: null }).size).toBe(0);
  });

  it("hasPermission is a thin wrapper over resolvePermissions", () => {
    expect(hasPermission({ staffRole: "superadmin" }, "roles.manage")).toBe(true);
    expect(hasPermission({ staffRole: "admin" }, "roles.manage")).toBe(false);
  });

  it("isPermission narrows correctly", () => {
    expect(isPermission("users.view")).toBe(true);
    expect(isPermission("not_a_real_permission")).toBe(false);
  });
});
