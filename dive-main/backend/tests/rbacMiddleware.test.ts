import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { requireStaff, requirePermission, requireStepUp, requireStaffPending, requireAdminIpAllowlist, StaffRequest } from "../src/middleware/auth";
import { signStaffPendingToken, signStepUpToken, signPasswordResetToken } from "../src/utils/jwt";
import { env } from "../src/config/env";

// Phase 0.3 of docs/ADMIN_PANEL_PLAN.md — RBAC middleware, exercised directly
// against mock req/res/next (no route needed yet — the real admin API surface
// is Phase 1) but against a REAL Mongo-backed User/Role (requireStaff does a
// genuine DB lookup, same as the existing requireAdmin it sits alongside).

function mockRes() {
  const res: { statusCode?: number; body?: unknown; status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(function (this: unknown, code: number) {
      res.statusCode = code;
      return res as never;
    }),
    json: jest.fn(function (this: unknown, body: unknown) {
      res.body = body;
      return res as never;
    }),
  };
  return res;
}

async function createUser(overrides: Partial<{ email: string; mobile: string }> = {}) {
  return User.create({
    name: "Staff Tester",
    mobile: overrides.mobile || `9${Math.floor(100000000 + Math.random() * 899999999)}`,
    email: overrides.email || `staff${Date.now()}${Math.random()}@example.com`,
    age: 30,
    passwordHash: "irrelevant-for-these-tests",
  });
}

describe("requireStaff", () => {
  it("rejects a normal (non-staff) user with 403 FORBIDDEN", async () => {
    const user = await createUser();
    const req = { userId: String(user._id) } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "FORBIDDEN" });
  });

  it("rejects when req.userId isn't set at all", async () => {
    const req = {} as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("rejects a suspended staff account even though staffRole is set", async () => {
    const user = await createUser();
    user.staffRole = "admin";
    user.status = "suspended";
    await user.save();
    const req = { userId: String(user._id) } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "ACCOUNT_SUSPENDED" });
  });

  it("attaches req.staff with the resolved permission set for a superadmin", async () => {
    const user = await createUser();
    user.staffRole = "superadmin";
    await user.save();
    const req = { userId: String(user._id) } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.staff?.staffRole).toBe("superadmin");
    expect(req.staff?.permissions.has("roles.manage")).toBe(true);
  });

  it("resolves an employee's permissions from their assigned Role, fresh from the DB", async () => {
    const role = await Role.create({ key: "support_agent", label: "Support Agent", permissions: ["tickets.view", "tickets.respond"] });
    const user = await createUser();
    user.staffRole = "employee";
    user.roleId = role._id;
    await user.save();
    const req = { userId: String(user._id) } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.staff?.permissions.has("tickets.view")).toBe(true);
    expect(req.staff?.permissions.has("tickets.manage")).toBe(false);
  });

  it("gives an employee with no assigned role zero permissions rather than erroring", async () => {
    const user = await createUser();
    user.staffRole = "employee";
    await user.save();
    const req = { userId: String(user._id) } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    await requireStaff(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.staff?.permissions.size).toBe(0);
  });
});

describe("requirePermission", () => {
  it("passes through when the resolved staff context has the permission", () => {
    const req = { staff: { userId: "u1", email: "a@b.com", staffRole: "superadmin", permissions: new Set(["roles.manage"]) } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requirePermission("roles.manage")(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects with 403 when the permission is missing", () => {
    const req = { staff: { userId: "u1", email: "a@b.com", staffRole: "admin", permissions: new Set<never>() } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requirePermission("roles.manage")(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("rejects when requireStaff never ran (req.staff missing)", () => {
    const req = {} as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requirePermission("roles.manage")(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireStepUp", () => {
  it("passes through with a valid step-up token matching req.userId", () => {
    const token = signStepUpToken("user-1");
    const req = { userId: "user-1", headers: { "x-step-up-token": token } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStepUp(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects when no step-up token header is present", () => {
    const req = { userId: "user-1", headers: {} } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStepUp(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: "STEP_UP_REQUIRED" });
  });

  it("rejects a step-up token minted for a DIFFERENT user", () => {
    const token = signStepUpToken("someone-else");
    const req = { userId: "user-1", headers: { "x-step-up-token": token } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStepUp(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a garbage token", () => {
    const req = { userId: "user-1", headers: { "x-step-up-token": "garbage" } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStepUp(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe("requireStaffPending", () => {
  it("sets req.userId from a valid pending token", () => {
    const token = signStaffPendingToken("user-42");
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStaffPending(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("user-42");
  });

  it("rejects a missing Authorization header", () => {
    const req = { headers: {} } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStaffPending(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed with the SAME secret but the wrong purpose", () => {
    // signPasswordResetToken shares jwtRefreshSecret with the pending token,
    // so this proves the `purpose` CLAIM is checked, not just the signature.
    const token = signPasswordResetToken("user-42");
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireStaffPending(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

// Regression: ADMIN_IP_ALLOWLIST (docs/ADMIN_PANEL_PLAN.md §5.1/§8, §12
// decision #9) has been defined in config/env.ts since Phase 0.3 but nothing
// ever enforced it — env.adminIpAllowlist is mutated directly here (a plain
// object, not re-read from process.env per request) to exercise both states
// without needing a real second process.
describe("requireAdminIpAllowlist", () => {
  const originalAllowlist = env.adminIpAllowlist;
  afterEach(() => {
    env.adminIpAllowlist = originalAllowlist;
  });

  it("is a no-op when the allowlist is empty (the default — 'off')", () => {
    env.adminIpAllowlist = [];
    const req = { ip: "203.0.113.9" } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireAdminIpAllowlist(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a request from an IP not on a configured allowlist", () => {
    env.adminIpAllowlist = ["203.0.113.5"];
    const req = { ip: "198.51.100.7" } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireAdminIpAllowlist(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "IP_NOT_ALLOWED" });
  });

  it("allows a request from an IP that IS on the configured allowlist", () => {
    env.adminIpAllowlist = ["203.0.113.5", "198.51.100.7"];
    const req = { ip: "198.51.100.7" } as unknown as StaffRequest;
    const res = mockRes();
    const next = jest.fn();
    requireAdminIpAllowlist(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
