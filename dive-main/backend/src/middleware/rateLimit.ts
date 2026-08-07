import rateLimit from "express-rate-limit";
import { env } from "../config/env";

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
