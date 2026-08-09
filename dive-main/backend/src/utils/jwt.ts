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
