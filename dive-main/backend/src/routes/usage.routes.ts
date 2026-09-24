import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { closeAllEditSessions } from "../services/usageService";
import { asyncHandler } from "../utils/asyncHandler";

// The logged-in user's own usage-session surface. Mounted at /api/usage —
// see app.ts. Currently just the one "done for this trip" signal (Phase 6a
// of docs/ADMIN_PANEL_PLAN.md §3.4, extended to bot_scan) — DiveContext.js
// calls this whenever the user reaches Home, closing whichever
// portfolio_edit/bot_scan edit sessions happen to be open so a later,
// separate trip starts a fresh (separately-metered) session instead of
// silently reusing the free window for up to 20 more minutes.
const router = Router();

router.use(requireAuth);

router.post(
  "/close-edit-sessions",
  asyncHandler(async (req: AuthedRequest, res) => {
    await closeAllEditSessions(req.userId!);
    res.status(200).json({ ok: true });
  })
);

export default router;
