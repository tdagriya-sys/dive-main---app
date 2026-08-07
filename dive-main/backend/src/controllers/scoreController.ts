import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { computeDiveScoreBreakdown } from "../services/diveScoreService";
import { generateScoreReportPdf } from "../services/scoreReportPdfService";
import { User } from "../models/User";

export async function getBreakdown(req: AuthedRequest, res: Response) {
  const breakdown = await computeDiveScoreBreakdown(String(req.userId));
  res.status(200).json(breakdown);
}

export async function downloadReportPdf(req: AuthedRequest, res: Response) {
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
