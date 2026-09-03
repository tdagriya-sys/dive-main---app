import { Router } from "express";
import * as extensionController from "../controllers/extensionController";

const router = Router();

// Public — no auth. This is static, non-sensitive source code (the Divve
// Bot browser extension); requiring a login would only complicate the
// download link/button for no real benefit.
router.get("/download", extensionController.downloadZip);

export default router;
