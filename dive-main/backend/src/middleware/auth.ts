import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, verifyStaffPendingToken, verifyStepUpToken } from "../utils/jwt";
import { User } from "../models/User";
import { Role } from "../models/Role";
import { Permission, PermissionSubject, resolvePermissions } from "../auth/permissions";
import { env } from "../config/env";

export interface AuthedRequest extends Request {
  userId?: string;
  // Set only when this request's token came from signImpersonationToken
  // (Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8 — see jwt.ts's own comment).
  impersonatingStaffId?: string;
  isReadOnlySession?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Missing access token." });
  }
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    // A single, central enforcement point rather than a per-route retrofit —
    // every controller mounted behind requireAuth (virtually the whole
    // user-facing API) automatically rejects a write the instant a
    // read-only impersonation token is presented, with no controller aware
    // this even exists.
    if (payload.readOnly) {
      req.isReadOnlySession = true;
      req.impersonatingStaffId = payload.imp;
      if (!SAFE_METHODS.has(req.method)) {
        return res.status(403).json({ error: "READONLY_SESSION", message: "This is a read-only impersonation session — no changes can be made." });
      }
    }
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "Access token is invalid or expired." });
  }
}

// Optional network-level restriction for the whole admin API (docs/
// ADMIN_PANEL_PLAN.md §5.1/§8, §12 decision #9 — "ADMIN_IP_ALLOWLIST empty
// (off)" by default). An empty allowlist makes this a no-op, so leaving it
// unset changes nothing; setting it restricts /api/admin/* to only those
// exact IPs (no CIDR ranges — env.ts's own parsing is a plain comma-split).
// Runs BEFORE requireAuth in admin.routes.ts so a request from a disallowed
// network is rejected before it can even learn whether its token is valid.
// Exact-match only, no CIDR — trust proxy is already set to "loopback" in
// app.ts, so req.ip correctly reflects the real client IP behind the
// standard Nginx reverse-proxy deployment (see SERVER_DEPLOYMENT_GUIDE.md),
// not the proxy's own address.
export function requireAdminIpAllowlist(req: Request, res: Response, next: NextFunction) {
  if (env.adminIpAllowlist.length === 0) {
    return next();
  }
  if (req.ip && env.adminIpAllowlist.includes(req.ip)) {
    return next();
  }
  return res.status(403).json({ error: "IP_NOT_ALLOWED", message: "Access to the admin panel isn't allowed from this network." });
}

// --- RBAC / staff auth (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md) ---
//
// The original admin gate here (`requireAdmin`, an `env.adminEmails`
// allowlist check) is gone as of Phase 1b — its one caller
// (`POST /api/admin/instruments/refresh`) has moved onto `requireStaff` +
// `requirePermission("instruments.manage")` below (see admin.routes.ts).
// `ADMIN_EMAILS`/`env.adminEmails` itself is now vestigial (still read by
// config/env.ts, no longer checked anywhere) — left alone for this change
// rather than also touching env.ts/.env.example/the deploy docs; a clean
// follow-up, not a functional gap.
//
// Gates the /api/auth/staff/totp/* endpoints — a staff login that's passed
// its password check but not yet its TOTP step carries a short-lived pending
// token instead of a real access token (see authController.ts's login()).
export function requireStaffPending(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Missing pending token." });
  }
  try {
    const payload = verifyStaffPendingToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN", message: "This sign-in has expired. Please log in again." });
  }
}

export interface StaffContext {
  userId: string;
  email: string;
  staffRole: "superadmin" | "admin" | "employee";
  permissions: Set<Permission>;
}

export interface StaffRequest extends AuthedRequest {
  staff?: StaffContext;
}

// Must run after requireAuth. A real access token for a staff account is
// ONLY EVER issued after both the password check AND a valid TOTP/recovery
// code (staffAuthController.ts's totpConfirm/totpVerify) — so simply holding
// one already proves 2FA was satisfied for this session; this middleware
// doesn't need to (and doesn't) re-check staffMeta.totpEnabled itself.
// Resolves the user's current role/permissions FRESH on every request
// (never cached in the token) — a role's permissions changing, or an account
// being suspended, takes effect on the very next request.
export async function requireStaff(req: StaffRequest, res: Response, next: NextFunction) {
  const user = req.userId ? await User.findById(req.userId).select("email staffRole roleId status").lean() : null;
  if (!user || !user.staffRole) {
    return res.status(403).json({ error: "FORBIDDEN", message: "Staff access required." });
  }
  if (user.status !== "active") {
    return res.status(403).json({ error: "ACCOUNT_SUSPENDED", message: "This staff account is not active." });
  }

  let rolePermissions: string[] = [];
  if (user.staffRole === "employee" && user.roleId) {
    const role = await Role.findById(user.roleId).select("permissions").lean();
    rolePermissions = role?.permissions || [];
  }
  const subject: PermissionSubject = { staffRole: user.staffRole, rolePermissions };
  req.staff = {
    userId: String(user._id),
    email: user.email,
    staffRole: user.staffRole,
    permissions: resolvePermissions(subject),
  };
  next();
}

// Must run after requireStaff. Returns a middleware (not itself one) so a
// route can name exactly which permission it needs: `requirePermission("plans.manage")`.
export function requirePermission(permission: Permission) {
  return (req: StaffRequest, res: Response, next: NextFunction) => {
    if (!req.staff) {
      return res.status(403).json({ error: "FORBIDDEN", message: "Staff access required." });
    }
    if (!req.staff.permissions.has(permission)) {
      return res.status(403).json({ error: "FORBIDDEN", message: `Missing permission: ${permission}` });
    }
    next();
  };
}

// Must run after requireStaff, on routes gating a sensitive action (see
// docs/ADMIN_PANEL_PLAN.md §8: impersonate, publish a scoring config, refund,
// delete a user, manage roles/employees). Requires a SEPARATE, short-lived
// token (from POST /api/admin/step-up — Phase 1) proving the staff member
// re-confirmed their password within the last few minutes, on top of their
// already-valid session — a stolen/left-open admin session alone isn't
// enough to take one of these actions.
export function requireStepUp(req: StaffRequest, res: Response, next: NextFunction) {
  const token = req.headers["x-step-up-token"];
  if (typeof token !== "string" || !token) {
    return res.status(401).json({ error: "STEP_UP_REQUIRED", message: "Please re-confirm your password to continue." });
  }
  try {
    const payload = verifyStepUpToken(token);
    if (payload.sub !== req.userId) {
      return res.status(401).json({ error: "STEP_UP_REQUIRED", message: "Please re-confirm your password to continue." });
    }
    next();
  } catch {
    return res.status(401).json({ error: "STEP_UP_REQUIRED", message: "Please re-confirm your password to continue." });
  }
}
