import { Router } from "express";
import * as userController from "../controllers/userController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.patch("/me/preferences", requireAuth, asyncHandler(userController.updatePreferences));
router.delete("/me", requireAuth, asyncHandler(userController.deleteMe));

export default router;
