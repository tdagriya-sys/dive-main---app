import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // userId
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // matches a RefreshToken document — see models/RefreshToken.ts
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl } as jwt.SignOptions);
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
