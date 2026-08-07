import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { PendingSignup } from "../models/PendingSignup";
import { signupStartSchema, signupVerifySchema, loginSchema } from "../validators/auth";
import { requestOtp, verifyOtp } from "../services/otpService";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { env } from "../config/env";
import { AuthedRequest } from "../middleware/auth";
import { REFRESH_COOKIE_NAME as REFRESH_COOKIE } from "../config/constants";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  });
}

function normalizeMobile(mobile: string): string {
  return mobile.replace(/^\+91/, "").replace(/^0/, "");
}

function publicUser(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    age: user.age,
    preferences: user.preferences,
    portfolio: user.portfolio,
  };
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
  const refreshToken = signRefreshToken(user._id.toString());
  setRefreshCookie(res, refreshToken);

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
  const refreshToken = signRefreshToken(user._id.toString());
  setRefreshCookie(res, refreshToken);

  return res.status(200).json({ accessToken, user: publicUser(user) });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ error: "NO_REFRESH_TOKEN", message: "Not logged in." });
  }
  try {
    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "USER_NOT_FOUND", message: "Account no longer exists." });
    }
    const accessToken = signAccessToken(user._id.toString());
    return res.status(200).json({ accessToken, user: publicUser(user) });
  } catch {
    return res.status(401).json({ error: "INVALID_REFRESH_TOKEN", message: "Session expired. Please log in again." });
  }
}

export async function logout(req: Request, res: Response) {
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
