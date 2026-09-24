import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as subscriptionsController from "../controllers/subscriptionsController";

// The logged-in user's own subscription surface (Phase 6a of
// docs/ADMIN_PANEL_PLAN.md). Mounted at /api/subscriptions — see app.ts.
const router = Router();

router.use(requireAuth);

router.get("/plans", asyncHandler(subscriptionsController.listPublicPlans));
router.post("/", asyncHandler(subscriptionsController.startSubscription));
router.post("/trial/start", asyncHandler(subscriptionsController.startTrial));
router.post("/verify", asyncHandler(subscriptionsController.verifySubscription));
router.post("/cancel", asyncHandler(subscriptionsController.cancelMySubscription));
router.post("/reactivate", asyncHandler(subscriptionsController.reactivateMySubscription));
router.post("/coupons/preview", asyncHandler(subscriptionsController.previewCoupon));
router.get("/invoices", asyncHandler(subscriptionsController.listMyInvoices));
router.get("/invoices/:id/pdf", asyncHandler(subscriptionsController.downloadMyInvoicePdf));

export default router;
