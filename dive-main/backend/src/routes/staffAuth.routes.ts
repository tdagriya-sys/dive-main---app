import { Router } from "express";
import { requireAuth, requireStaff, requireStaffPending } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";
import * as staffAuthController from "../controllers/staffAuthController";

const router = Router();

// All three TOTP endpoints are brute-force targets (a 6-digit code, or the
// step-up password) — reuse the existing login/OTP-shaped limiter rather than
// inventing a fourth rate-limit bucket for the same threat model.
router.post("/totp/setup", requireStaffPending, authLimiter, asyncHandler(staffAuthController.totpSetup));
router.post("/totp/confirm", requireStaffPending, authLimiter, asyncHandler(staffAuthController.totpConfirm));
router.post("/totp/verify", requireStaffPending, authLimiter, asyncHandler(staffAuthController.totpVerify));

// Step-up re-confirms the CURRENT password of an already-logged-in staff
// session (real access token, not a pending one) — see middleware/auth.ts's
// requireStepUp for what consumes the token this returns.
router.post("/step-up", requireAuth, requireStaff, authLimiter, asyncHandler(staffAuthController.stepUp));

// Public (Phase 3) — no session exists yet at this point, same as signup.
router.get("/invite/:token", asyncHandler(staffAuthController.getInviteInfo));
router.post("/accept-invite", authLimiter, asyncHandler(staffAuthController.acceptInvite));

export default router;
