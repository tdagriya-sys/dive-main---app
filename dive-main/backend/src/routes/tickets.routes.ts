import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as ticketsController from "../controllers/ticketsController";

// The logged-in user's own ticket surface (Phase 4 of
// docs/ADMIN_PANEL_PLAN.md). Mounted at /api/tickets — see app.ts. Every
// route requires a real session; ownership is enforced inside the
// controller (scoped to req.userId), not here.
const router = Router();

router.use(requireAuth);

router.post("/", asyncHandler(ticketsController.createTicket));
router.get("/", asyncHandler(ticketsController.listMyTickets));
router.get("/:id", asyncHandler(ticketsController.getMyTicket));
router.post("/:id/messages", asyncHandler(ticketsController.replyToTicket));
router.post("/:id/callback", asyncHandler(ticketsController.requestCallback));
router.post("/:id/csat", asyncHandler(ticketsController.submitCsat));

export default router;
