import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { AuthedRequest } from "./auth";

// Rate limiting is disabled under NODE_ENV=test so integration tests can exercise
// the same endpoints repeatedly without tripping IP-based limits meant for real traffic.
const skip = () => env.nodeEnv === "test";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: "RATE_LIMITED", message: "Too many attempts. Please try again later." },
});

export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: "RATE_LIMITED", message: "Too many OTP requests. Please wait before trying again." },
});

// Shared across /uploads and /botscan/analyze — both ultimately trigger a
// paid Claude vision call (botscan up to 30 images per request), so they're
// capped together rather than per-route to stop a user from just splitting
// abuse traffic across the two endpoints to double their effective ceiling.
// Keyed by the authenticated user (requireAuth runs first on both routes,
// guaranteeing req.userId is set), not IP — IP-based keying would let a
// single account burn through it repeatedly via IP rotation, and it also
// sidesteps express-rate-limit's default IP-format validation, which trips
// a warning behind the Nginx reverse-proxy setup unless `trust proxy` is
// explicitly configured (see backend/src/app.ts).
export const aiIngestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  validate: false,
  keyGenerator: (req) => (req as AuthedRequest).userId || "anonymous",
  message: {
    error: "RATE_LIMITED",
    message: "Too many scans/uploads. Please wait a few minutes before trying again.",
  },
});
