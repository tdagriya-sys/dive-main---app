import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as aaController from "../controllers/aaController";

const router = Router();

router.use(requireAuth);
router.post("/consent/request", asyncHandler(aaController.requestConsent));
router.post("/consent/:handle/approve", asyncHandler(aaController.approveMockConsent));
router.get("/consent/:handle/status", asyncHandler(aaController.getConsentStatus));
router.post("/consent/:handle/fetch", asyncHandler(aaController.fetchFiDataAndSave));

export default router;
