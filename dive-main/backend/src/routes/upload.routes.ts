import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { aiIngestLimiter } from "../middleware/rateLimit";
import { uploadMiddleware } from "../middleware/upload";
import { asyncHandler } from "../utils/asyncHandler";
import * as uploadController from "../controllers/uploadController";

const router = Router();

router.post("/", requireAuth, aiIngestLimiter, uploadMiddleware.single("file"), asyncHandler(uploadController.uploadFile));

export default router;
