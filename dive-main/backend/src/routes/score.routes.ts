import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as scoreController from "../controllers/scoreController";

const router = Router();

router.get("/breakdown", requireAuth, asyncHandler(scoreController.getBreakdown));
router.get("/breakdown/pdf", requireAuth, asyncHandler(scoreController.downloadReportPdf));

export default router;
