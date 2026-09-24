import { Request, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { computeDiveScoreBreakdown } from "../services/diveScoreService";
import { generateScoreReportPdf } from "../services/scoreReportPdfService";
import { ensureReportAccess } from "../services/paymentService";
import { User } from "../models/User";
import { emitActivity } from "../services/activityLog";
import { getActiveContextConfig } from "../services/config/contextConfigService";
import { getActiveSuggestionConfig } from "../services/config/suggestionConfigService";

// Public (no auth) and cacheable — lets the frontend's offline/fast-path
// engines (diveEngine.js, contextMessaging.js) pick up whatever an admin has
// published for the Context/Suggestion models (Phase 2 of
// docs/ADMIN_PANEL_PLAN.md) instead of only ever using their bundled literal
// defaults. Deliberately excludes ScoringConfig — the Dive Score composite
// weights/formulas are computed server-side only; nothing on the frontend
// reads them today, so there's no reason to expose that surface publicly.
export async function getConfig(_req: Request, res: Response) {
  const [context, suggestion] = await Promise.all([getActiveContextConfig(), getActiveSuggestionConfig()]);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ context, suggestion });
}

export async function getBreakdown(req: AuthedRequest, res: Response) {
  const breakdown = await computeDiveScoreBreakdown(String(req.userId));
  emitActivity("score_viewed", { userId: req.userId, req, props: { compositeScore: breakdown.compositeScore, hasHoldings: breakdown.hasHoldings } });
  res.status(200).json(breakdown);
}

// Paid feature (admin-editable price via Razorpay — see
// paymentService.ts/RAZORPAY_SETUP_GUIDE.md), with a free path for anyone
// entitled to a complimentary download (ensureReportAccess). The frontend's
// own flow (useDownloadReport.js) never lets a user reach this call before
// either a successful payment or a free unlock, but that's a UX convenience,
// not the actual security boundary — this check is, since the endpoint is
// reachable directly by anyone with a valid access token.
export async function downloadReportPdf(req: AuthedRequest, res: Response) {
  const paid = await ensureReportAccess(String(req.userId));
  if (!paid) {
    throw new ApiError(402, "PAYMENT_REQUIRED", "Purchase this report to download it.");
  }

  const [breakdown, user] = await Promise.all([
    computeDiveScoreBreakdown(String(req.userId)),
    User.findById(req.userId).select("name email").lean(),
  ]);
  const pdf = await generateScoreReportPdf(breakdown, { name: user?.name ?? "DIVVE user", email: user?.email ?? "" });
  emitActivity("report_downloaded", { userId: req.userId, req });
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="divve-resilience-report.pdf"');
  res.send(pdf);
}
