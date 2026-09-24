import { Router } from "express";
import * as holdingsController from "../controllers/holdingsController";
import { requireAuth } from "../middleware/auth";
import { enforceEditSessionUsage } from "../services/usageService";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);
router.get("/", asyncHandler(holdingsController.listHoldings));
router.get("/:id/live-quality", asyncHandler(holdingsController.getLiveQuality));
// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.4 — every holding mutation opens
// or refreshes a coalesced "edit session" (enforceEditSessionUsage,
// services/usageService.ts) rather than metering per-request; only the
// first mutation in a burst is checked against the plan limit. The session
// is explicitly closed via POST /api/usage/close-edit-sessions (usage.routes.ts)
// when the user reaches Home, not from here.
router.post("/manual", enforceEditSessionUsage("portfolio_edit"), asyncHandler(holdingsController.createManualHolding));
router.patch("/:id", enforceEditSessionUsage("portfolio_edit"), asyncHandler(holdingsController.updateHolding));
router.delete("/:id", enforceEditSessionUsage("portfolio_edit"), asyncHandler(holdingsController.deleteHolding));

export default router;
