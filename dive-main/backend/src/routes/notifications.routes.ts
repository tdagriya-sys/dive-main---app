import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as notificationsController from "../controllers/notificationsController";

// The logged-in user's own notification surface (Phase 5 of
// docs/ADMIN_PANEL_PLAN.md). Mounted at /api/notifications — see app.ts.
const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(notificationsController.listMyNotifications));
router.get("/popups", asyncHandler(notificationsController.listMyPopupNotifications));
router.post("/:id/read", asyncHandler(notificationsController.markRead));
router.post("/read-all", asyncHandler(notificationsController.markAllRead));
router.get("/preferences", asyncHandler(notificationsController.getPreferences));
router.patch("/preferences", asyncHandler(notificationsController.updatePreference));

export default router;
