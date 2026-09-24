import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { enforceEditSessionUsage } from "../services/usageService";
import { asyncHandler } from "../utils/asyncHandler";
import * as aaController from "../controllers/aaController";

const router = Router();

router.use(requireAuth);
router.post("/consent/request", asyncHandler(aaController.requestConsent));
router.post("/consent/:handle/approve", asyncHandler(aaController.approveMockConsent));
router.get("/consent/:handle/status", asyncHandler(aaController.getConsentStatus));
// One AA sync = one edit session open/refresh (Phase 6a of
// docs/ADMIN_PANEL_PLAN.md §3.4), same coalescing as a manual holding edit.
router.post("/consent/:handle/fetch", enforceEditSessionUsage("portfolio_edit"), asyncHandler(aaController.fetchFiDataAndSave));

export default router;
