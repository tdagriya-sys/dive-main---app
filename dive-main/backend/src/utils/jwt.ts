import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // userId
  // Impersonation (Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8) — set only on
  // a token minted by signImpersonationToken below. `imp` names the staff
  // member riding along (audited at mint time — see
  // adminUsersController.ts::impersonateUser), `readOnly` is what
  // middleware/auth.ts's requireAuth actually enforces: every mutating
  // request carrying one of these tokens is rejected before it reaches any
  // controller, so there's no per-route retrofit needed across the app.
  imp?: string; // staffId
  readOnly?: boolean;
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // matches a RefreshToken document — see models/RefreshToken.ts
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl } as jwt.SignOptions);
}

// Staff session hardening (docs/ADMIN_PANEL_PLAN.md §5.1/§8) — a shorter TTL
// than a regular user's access token, since a stolen staff session reaches
// the whole admin surface rather than just one person's own data. Same
// payload shape as signAccessToken; only the expiry differs. Used wherever a
// STAFF member's real session token is minted — see staffAuthController.ts's
// totpConfirm/totpVerify and authController.ts::refresh's staffRole check.
export function signStaffAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtAccessSecret, { expiresIn: env.staffAccessTtl } as jwt.SignOptions);
}

// Returns the expiry alongside the token (read back off the token's own `exp`
// claim, rather than re-deriving it from env.jwtRefreshTtl) so the caller can
// store an exactly-matching expiresAt on the RefreshToken DB record.
export function signRefreshToken(userId: string, jti: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({ sub: userId, jti }, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshTtl } as jwt.SignOptions);
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000) };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

// A deliberately short-lived (30m — impersonation is a quick "let me see
// what they're seeing" look, not a session), read-only stand-in for a real
// access token. No refresh token is ever issued alongside it — it just
// expires naturally, with no server-side revocation list needed since it
// can't do anything but read in the first place.
const IMPERSONATION_TTL = "30m";
export function signImpersonationToken(targetUserId: string, staffId: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({ sub: targetUserId, imp: staffId, readOnly: true }, env.jwtAccessSecret, { expiresIn: IMPERSONATION_TTL });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000) };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
}

export interface PasswordResetTokenPayload {
  sub: string; // userId
  purpose: "password_reset";
}

// Proves "this caller already verified the password-reset OTP" across the
// gap between the verify step and the reset step, without making the
// frontend hold onto (or resend) the raw OTP. Signed with jwtRefreshSecret
// rather than jwtAccessSecret specifically so a leaked reset token can never
// be replayed as a real access token by requireAuth (which only checks
// jwtAccessSecret + `sub` — it has no `purpose` field to reject on). The
// reverse mix-up is equally safe: a real refresh token has no `purpose`
// claim, so verifyPasswordResetToken's explicit check below rejects it, and
// a reset token has no `jti`, so it can never satisfy refresh's DB-backed
// jti lookup either.
export function signPasswordResetToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "password_reset" }, env.jwtRefreshSecret, { expiresIn: "10m" });
}

export function verifyPasswordResetToken(token: string): PasswordResetTokenPayload {
  const payload = jwt.verify(token, env.jwtRefreshSecret) as PasswordResetTokenPayload;
  if (payload.purpose !== "password_reset") {
    throw new Error("Not a password reset token");
  }
  return payload;
}

// --- Staff 2FA (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md) ---
//
// A staff login (password already verified) does NOT get a real access/
// refresh token pair yet — it gets this short-lived "pending" token instead,
// which is only good for the /api/auth/staff/totp/* endpoints. Real tokens
// are issued only once a valid TOTP (or recovery) code is also presented.
// Same signing-key-mixup defense as signPasswordResetToken above: signed with
// jwtRefreshSecret (not jwtAccessSecret), so a leaked pending token can never
// be replayed as a real access token by requireAuth (no `purpose` claim to
// reject on there), and a real refresh token (no `purpose` claim, has `jti`)
// can never satisfy this token's own purpose check either.
export interface StaffPendingTokenPayload {
  sub: string; // userId
  purpose: "staff_2fa_pending";
}

export function signStaffPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "staff_2fa_pending" }, env.jwtRefreshSecret, { expiresIn: "5m" });
}

export function verifyStaffPendingToken(token: string): StaffPendingTokenPayload {
  const payload = jwt.verify(token, env.jwtRefreshSecret) as StaffPendingTokenPayload;
  if (payload.purpose !== "staff_2fa_pending") {
    throw new Error("Not a staff 2FA pending token");
  }
  return payload;
}

// Step-up proof: "this staff member re-entered their password (or a fresh
// TOTP code) within the last few minutes", required before a sensitive admin
// action (impersonate, publish a scoring config, refund, delete a user,
// manage roles/employees — see docs/ADMIN_PANEL_PLAN.md §8). Signed with
// jwtAccessSecret since, unlike the pending token above, this is presented
// ALONGSIDE a real, already-verified access token, not instead of one.
export interface StepUpTokenPayload {
  sub: string; // userId — checked against req.userId by requireStepUp
  purpose: "step_up";
}

export function signStepUpToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "step_up" }, env.jwtAccessSecret, { expiresIn: env.staffAccessTtl } as jwt.SignOptions);
}

export function verifyStepUpToken(token: string): StepUpTokenPayload {
  const payload = jwt.verify(token, env.jwtAccessSecret) as StepUpTokenPayload;
  if (payload.purpose !== "step_up") {
    throw new Error("Not a step-up token");
  }
  return payload;
}
