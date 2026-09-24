import crypto from "crypto";
import { Response } from "express";
import { RefreshToken } from "../models/RefreshToken";
import { signRefreshToken } from "../utils/jwt";
import { env } from "../config/env";
import { REFRESH_COOKIE_NAME as REFRESH_COOKIE } from "../config/constants";

// Extracted from authController.ts (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md) so
// staffAuthController.ts's TOTP-confirm/verify endpoints — which also
// complete a login by issuing a real session — can share the exact same
// "every live refresh token has a matching DB record, cookie set the same
// way" path, rather than a second, independently-maintained copy of it.

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/api/auth",
  });
}

// Issues a brand-new refresh token, persists the RefreshToken record that
// makes it revocable, and sets the cookie. Returns the raw token too (in
// addition to setting the cookie) so a caller without a shared browser
// cookie jar (the Divve Bot browser extension — see authController.ts's
// EXTENSION_CLIENT_TYPE) can hand it back to that kind of client directly.
export async function issueRefreshToken(res: Response, userId: string): Promise<string> {
  const jti = crypto.randomUUID();
  const { token, expiresAt } = signRefreshToken(userId, jti);
  await RefreshToken.create({ jti, userId, expiresAt });
  setRefreshCookie(res, token, expiresAt);
  return token;
}
