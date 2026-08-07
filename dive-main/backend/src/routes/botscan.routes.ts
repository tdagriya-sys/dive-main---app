import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
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

router.post("/analyze", requireAuth, framesUpload.array("frames", 30), asyncHandler(botScanController.analyzeFrames));

export default router;
