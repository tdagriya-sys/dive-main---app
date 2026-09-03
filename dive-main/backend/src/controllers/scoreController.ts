import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { computeDiveScoreBreakdown } from "../services/diveScoreService";
import { generateScoreReportPdf } from "../services/scoreReportPdfService";
import { hasPaidForReport } from "../services/paymentService";
import { User } from "../models/User";

export async function getBreakdown(req: AuthedRequest, res: Response) {
  const breakdown = await computeDiveScoreBreakdown(String(req.userId));
  res.status(200).json(breakdown);
}

// Paid feature (Rs. 99 via Razorpay — see paymentService.ts/RAZORPAY_SETUP_GUIDE.md).
// The frontend's own flow (useDownloadReport.js) never lets a user reach
// this call before a successful payment, but that's a UX convenience, not
// the actual security boundary — this check is, since the endpoint is
// reachable directly by anyone with a valid access token.
export async function downloadReportPdf(req: AuthedRequest, res: Response) {
  const paid = await hasPaidForReport(String(req.userId));
  if (!paid) {
    throw new ApiError(402, "PAYMENT_REQUIRED", "Purchase this report to download it.");
  }

  const [breakdown, user] = await Promise.all([
    computeDiveScoreBreakdown(String(req.userId)),
    User.findById(req.userId).select("name email").lean(),
  ]);
  const pdf = await generateScoreReportPdf(breakdown, { name: user?.name ?? "DIVVE user", email: user?.email ?? "" });
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="divve-resilience-report.pdf"');
  res.send(pdf);
}
