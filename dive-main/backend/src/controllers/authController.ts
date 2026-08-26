import crypto from "crypto";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { PendingSignup } from "../models/PendingSignup";
import { RefreshToken } from "../models/RefreshToken";
import {
  signupStartSchema,
  signupVerifySchema,
  loginSchema,
  forgotPasswordStartSchema,
  forgotPasswordVerifySchema,
  resetPasswordSchema,
} from "../validators/auth";
import { requestOtp, verifyOtp } from "../services/otpService";
import { signAccessToken, signRefreshToken, verifyRefreshToken, signPasswordResetToken, verifyPasswordResetToken } from "../utils/jwt";
import { env } from "../config/env";
import { AuthedRequest } from "../middleware/auth";
import { REFRESH_COOKIE_NAME as REFRESH_COOKIE } from "../config/constants";
import { publicUser } from "../utils/publicUser";

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/api/auth",
  });
}

// Issues a brand-new refresh token, persists the RefreshToken record that
// makes it revocable, and sets the cookie — the one path every login/signup/
// refresh call goes through, so "every live refresh token has a matching DB
// record" can't drift out of sync. Returns the raw token too (in addition to
// setting the cookie) so a caller without a shared browser cookie jar — see
// EXTENSION_CLIENT_TYPE below — can hand it back to that kind of client
// directly instead.
async function issueRefreshToken(res: Response, userId: string): Promise<string> {
  const jti = crypto.randomUUID();
  const { token, expiresAt } = signRefreshToken(userId, jti);
  await RefreshToken.create({ jti, userId, expiresAt });
  setRefreshCookie(res, token, expiresAt);
  return token;
}

// The web SPA always uses the httpOnly cookie set above and never sees a
// refresh token in JS. The Divve Bot browser extension (extension/) has no
// access to that cookie from its background service worker — cross-site
// fetches don't carry a SameSite=Lax cookie the way a top-level page
// navigation does — so a client that explicitly identifies itself with this
// flag additionally gets the raw refresh token in the JSON response body,
// to store in its own isolated chrome.storage.local and submit back on
// /auth/refresh itself. This is strictly additive: omitting clientType (or
// sending anything other than "extension") reproduces the exact previous
// behavior for every existing caller.
const EXTENSION_CLIENT_TYPE = "extension";
function wantsRefreshTokenInBody(req: Request): boolean {
  return req.body?.clientType === EXTENSION_CLIENT_TYPE;
}

function normalizeMobile(mobile: string): string {
  return mobile.replace(/^\+91/, "").replace(/^0/, "");
}

export async function signupStart(req: Request, res: Response) {
  const data = signupStartSchema.parse(req.body);
  const mobile = normalizeMobile(data.mobile);

  const existing = await User.findOne({ $or: [{ mobile }, { email: data.email }] });
  if (existing) {
    return res.status(409).json({ error: "USER_EXISTS", message: "An account with this mobile or email already exists. Please log in instead." });
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

  await PendingSignup.findOneAndUpdate(
    { mobile },
    { mobile, name: data.name, email: data.email, age: data.age, passwordHash, expiresAt },
    { upsert: true, new: true }
  );

  const result = await requestOtp(mobile, "signup", data.email);

  if (!result.delivered) {
    // Real email delivery failed in production, with no dev-mode fallback to
    // fall back to (see otpService.ts) — tell the user honestly rather than
    // claiming success on a code they'll never receive.
    return res.status(502).json({
      error: "OTP_DELIVERY_FAILED",
      message: "Couldn't send your verification code right now. Please try again shortly.",
    });
  }

  return res.status(200).json({
    message: "OTP sent to your email address.",
    mobile,
    ...(result.devOtp ? { devOtp: result.devOtp } : {}), // DEV ONLY — remove/gate before production
  });
}

export async function signupVerify(req: Request, res: Response) {
  const data = signupVerifySchema.parse(req.body);
  const mobile = normalizeMobile(data.mobile);

  const pending = await PendingSignup.findOne({ mobile });
  if (!pending) {
    return res.status(400).json({ error: "SIGNUP_NOT_STARTED", message: "Please start sign-up again." });
  }

  const ok = await verifyOtp(mobile, "signup", data.otp);
  if (!ok) {
    return res.status(400).json({ error: "INVALID_OTP", message: "That OTP is incorrect or has expired." });
  }

  const user = await User.create({
    name: pending.name,
    mobile: pending.mobile,
    email: pending.email,
    age: pending.age,
    passwordHash: pending.passwordHash,
    personalDetails: {},
    portfolio: { lastSyncedAt: null, sources: [] },
    preferences: {
      risk: "Balanced",
      returnExpectation: "Moderate",
      diversificationGoal: "High",
      preferredCategories: [],
      excludedCategories: [],
    },
  });
  await PendingSignup.deleteOne({ mobile });

  const accessToken = signAccessToken(user._id.toString());
  await issueRefreshToken(res, user._id.toString());

  return res.status(201).json({ accessToken, user: publicUser(user) });
}

export async function login(req: Request, res: Response) {
  const data = loginSchema.parse(req.body);
  const identifier = data.identifier.includes("@") ? data.identifier.trim().toLowerCase() : normalizeMobile(data.identifier);

  const user = await User.findOne(data.identifier.includes("@") ? { email: identifier } : { mobile: identifier });
  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "We couldn't find an account with these details — please sign up first." });
  }

  const matches = await bcrypt.compare(data.password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect email/mobile or password." });
  }

  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = await issueRefreshToken(res, user._id.toString());

  return res.status(200).json({
    accessToken,
    user: publicUser(user),
    ...(wantsRefreshTokenInBody(req) ? { refreshToken } : {}),
  });
}

// Step 1 of 3: identify the account and send it a "password_reset"-purpose
// OTP (same Otp collection/purpose enum signup already uses — see
// otpService.ts, deliberately purpose-generic). Deliberately reveals
// USER_NOT_FOUND rather than a vague "if an account exists..." message —
// this codebase's login/signup already reveal account existence the same
// way (404 USER_NOT_FOUND / 409 USER_EXISTS), so there's no established
// enumeration-hardening precedent here to break by being equally direct.
export async function forgotPasswordStart(req: Request, res: Response) {
  const data = forgotPasswordStartSchema.parse(req.body);
  const identifier = data.identifier.includes("@") ? data.identifier.trim().toLowerCase() : normalizeMobile(data.identifier);

  const user = await User.findOne(data.identifier.includes("@") ? { email: identifier } : { mobile: identifier });
  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "We couldn't find an account with these details." });
  }

  // OTP identifier is always the account's mobile number, regardless of
  // whether the user typed their email or mobile above — same convention
  // signupStart/signupVerify use.
  const result = await requestOtp(user.mobile, "password_reset", user.email);

  if (!result.delivered) {
    return res.status(502).json({
      error: "OTP_DELIVERY_FAILED",
      message: "Couldn't send your verification code right now. Please try again shortly.",
    });
  }

  return res.status(200).json({
    message: "OTP sent to your email address.",
    mobile: user.mobile,
    ...(result.devOtp ? { devOtp: result.devOtp } : {}), // DEV ONLY — remove/gate before production
  });
}

// Step 2 of 3: verify the OTP, then hand back a short-lived, single-purpose
// resetToken instead of making the frontend hold onto (or resend) the raw
// OTP for the final step — see signPasswordResetToken's own comment in
// utils/jwt.ts for why this is safe even if the token leaked.
export async function forgotPasswordVerify(req: Request, res: Response) {
  const data = forgotPasswordVerifySchema.parse(req.body);
  const mobile = normalizeMobile(data.mobile);

  const ok = await verifyOtp(mobile, "password_reset", data.otp);
  if (!ok) {
    return res.status(400).json({ error: "INVALID_OTP", message: "That OTP is incorrect or has expired." });
  }

  const user = await User.findOne({ mobile });
  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "Account no longer exists." });
  }

  const resetToken = signPasswordResetToken(user._id.toString());
  return res.status(200).json({ resetToken });
}

// Step 3 of 3: identity was already proven via OTP in step 2 (the resetToken
// IS that proof), so — unlike changePassword in userController.ts — there's
// no currentPassword to check here. Revokes every live session the same way
// changePassword does: a password someone forgot enough to need this flow
// for is exactly the kind that might also be compromised, so every existing
// session (not just future ones) should require a fresh login.
export async function resetPassword(req: Request, res: Response) {
  const data = resetPasswordSchema.parse(req.body);

  let payload;
  try {
    payload = verifyPasswordResetToken(data.resetToken);
  } catch {
    return res.status(401).json({ error: "INVALID_RESET_TOKEN", message: "This reset link has expired. Please start again." });
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "Account no longer exists." });
  }

  user.passwordHash = await bcrypt.hash(data.newPassword, 10);
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });

  return res.status(200).json({ message: "Password updated. Please log in with your new password." });
}

export async function refresh(req: Request, res: Response) {
  // Only trust a body-supplied refresh token from a caller that explicitly
  // identified itself as the extension — an arbitrary caller can't just pass
  // any refreshToken in the body and skip the cookie requirement, since this
  // whole branch is gated on the same clientType flag that controls whether
  // one was ever handed out in the first place.
  const bodyToken = wantsRefreshTokenInBody(req) ? (req.body?.refreshToken as string | undefined) : undefined;
  const token = bodyToken || req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ error: "NO_REFRESH_TOKEN", message: "Not logged in." });
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ error: "INVALID_REFRESH_TOKEN", message: "Session expired. Please log in again." });
  }

  // Single-use rotation: atomically revoke this token (only succeeds if it's
  // still live) so a concurrent second refresh call with the same cookie
  // can't also claim it. `claimed` is the pre-update doc, so a match here
  // means this call is the one that just revoked it.
  const claimed = await RefreshToken.findOneAndUpdate({ jti: payload.jti, revokedAt: null }, { revokedAt: new Date() });

  if (!claimed) {
    const existing = await RefreshToken.findOne({ jti: payload.jti });
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    if (existing) {
      // A record exists but was already revoked (rotated away by an earlier
      // refresh, or killed by logout) — this exact token being presented
      // again is the strongest signal available that it leaked. Revoke every
      // other still-live token for this user too, not just this one, so a
      // stolen token can't keep working via a delayed replay.
      await RefreshToken.updateMany({ userId: existing.userId, revokedAt: null }, { revokedAt: new Date() });
      return res.status(401).json({ error: "REFRESH_TOKEN_REUSED", message: "This session was already used elsewhere. Please log in again." });
    }
    return res.status(401).json({ error: "INVALID_REFRESH_TOKEN", message: "Session expired. Please log in again." });
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    return res.status(401).json({ error: "USER_NOT_FOUND", message: "Account no longer exists." });
  }

  const accessToken = signAccessToken(user._id.toString());
  const newRefreshToken = await issueRefreshToken(res, user._id.toString());

  return res.status(200).json({
    accessToken,
    user: publicUser(user),
    ...(bodyToken ? { refreshToken: newRefreshToken } : {}),
  });
}

export async function logout(req: Request, res: Response) {
  const token = (wantsRefreshTokenInBody(req) ? (req.body?.refreshToken as string | undefined) : undefined) || req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await RefreshToken.updateOne({ jti: payload.jti, revokedAt: null }, { revokedAt: new Date() });
    } catch {
      // Malformed/expired cookie — nothing valid to revoke server-side.
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  return res.status(200).json({ message: "Logged out." });
}

export async function me(req: AuthedRequest, res: Response) {
  const user = await User.findById(req.userId);
  if (!user) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "Account no longer exists." });
  }
  return res.status(200).json({ user: publicUser(user) });
}
