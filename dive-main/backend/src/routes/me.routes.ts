import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as subscriptionsController from "../controllers/subscriptionsController";
import * as userController from "../controllers/userController";

// The logged-in user's own aggregate "about me" endpoints — GET /api/me/
// entitlements (Phase 6a §5.4/§7) and, since Phase 7, GET /api/me/
// feature-flags (§11).
const router = Router();

router.use(requireAuth);

router.get("/entitlements", asyncHandler(subscriptionsController.getMyEntitlements));
router.get("/feature-flags", asyncHandler(userController.getMyFeatureFlags));

export default router;
