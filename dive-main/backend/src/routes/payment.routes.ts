import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import * as paymentController from "../controllers/paymentController";

const router = Router();

router.post("/report/order", requireAuth, asyncHandler(paymentController.createReportOrder));
router.post("/report/verify", requireAuth, asyncHandler(paymentController.verifyReportPayment));
// Public — see paymentController.ts's razorpayWebhook for why this deliberately
// has no requireAuth.
router.post("/webhook", asyncHandler(paymentController.razorpayWebhook));

export default router;
