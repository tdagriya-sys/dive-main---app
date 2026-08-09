import { Router } from "express";
import * as holdingsController from "../controllers/holdingsController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);
router.get("/", asyncHandler(holdingsController.listHoldings));
router.get("/:id/live-quality", asyncHandler(holdingsController.getLiveQuality));
router.post("/manual", asyncHandler(holdingsController.createManualHolding));
router.patch("/:id", asyncHandler(holdingsController.updateHolding));
router.delete("/:id", asyncHandler(holdingsController.deleteHolding));

export default router;
