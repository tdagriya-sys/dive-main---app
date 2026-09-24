import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { aiIngestLimiter } from "../middleware/rateLimit";
import { enforceEditSessionUsage } from "../services/usageService";
import { asyncHandler } from "../utils/asyncHandler";
import * as botScanController from "../controllers/botScanController";

const framesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Unsupported file type: every frame must be an image"));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

// Coalesced across the whole scan (usageService.ts::enforceEditSessionUsage)
// — captureFrame polls this roughly every 1.8s for the duration of one
// scan, so metering per-call would exhaust even a modest weekly limit on
// the second frame of a user's first-ever scan.
router.post("/analyze", requireAuth, aiIngestLimiter, enforceEditSessionUsage("bot_scan"), framesUpload.array("frames", 30), asyncHandler(botScanController.analyzeFrames));

export default router;
