import { Router } from "express";
import * as contactController from "../controllers/contactController";
import { contactLimiter } from "../middleware/rateLimit";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.post("/", contactLimiter, asyncHandler(contactController.submit));

export default router;
