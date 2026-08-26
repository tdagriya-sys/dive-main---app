import { Router } from "express";
import * as authController from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { authLimiter, otpLimiter } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.post("/signup/start", otpLimiter, asyncHandler(authController.signupStart));
router.post("/signup/verify", authLimiter, asyncHandler(authController.signupVerify));
router.post("/login", authLimiter, asyncHandler(authController.login));
router.post("/forgot-password/start", otpLimiter, asyncHandler(authController.forgotPasswordStart));
router.post("/forgot-password/verify", authLimiter, asyncHandler(authController.forgotPasswordVerify));
router.post("/forgot-password/reset", authLimiter, asyncHandler(authController.resetPassword));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));
router.get("/me", requireAuth, asyncHandler(authController.me));

export default router;
