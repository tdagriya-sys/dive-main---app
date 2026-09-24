import { Router } from "express";
import * as instrumentsController from "../controllers/instrumentsController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/search", requireAuth, asyncHandler(instrumentsController.search));
router.get("/:id/detail", requireAuth, asyncHandler(instrumentsController.detail));

export default router;
