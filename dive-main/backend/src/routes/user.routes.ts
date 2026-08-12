import { Router } from "express";
import * as userController from "../controllers/userController";
import { requireAuth } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.patch("/me/preferences", requireAuth, asyncHandler(userController.updatePreferences));
router.patch("/me/profile", requireAuth, asyncHandler(userController.updateProfile));
router.patch("/me/planner", requireAuth, asyncHandler(userController.updatePlannerState));
router.patch("/me/password", requireAuth, authLimiter, asyncHandler(userController.changePassword));
router.delete("/me", requireAuth, asyncHandler(userController.deleteMe));

export default router;
