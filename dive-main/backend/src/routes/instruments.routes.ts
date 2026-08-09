import { Router } from "express";
import * as instrumentsController from "../controllers/instrumentsController";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/search", requireAuth, asyncHandler(instrumentsController.search));
router.get("/:id/detail", requireAuth, asyncHandler(instrumentsController.detail));

export const adminInstrumentsRouter = Router();
adminInstrumentsRouter.post(
  "/instruments/refresh",
  requireAuth,
  asyncHandler(requireAdmin),
  asyncHandler(instrumentsController.triggerRefresh)
);

export default router;
