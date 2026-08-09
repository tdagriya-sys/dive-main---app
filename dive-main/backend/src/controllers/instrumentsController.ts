import { Response } from "express";
import { z } from "zod";
import { searchInstruments, runInstrumentRefresh } from "../services/instrumentService";
import { fetchInstrumentDetail } from "../services/instrumentDetailService";
import { ASSET_CLASSES, Instrument } from "../models/Instrument";
import { AuthedRequest } from "../middleware/auth";

const searchSchema = z.object({
  assetClass: z.enum(ASSET_CLASSES).optional(),
  q: z.string().optional(),
});

export async function search(req: AuthedRequest, res: Response) {
  const { assetClass, q } = searchSchema.parse(req.query);
  const results = await searchInstruments(assetClass, q);
  res.json({ instruments: results });
}

// On-demand fundamental/technical snapshot for Ask DIVE's detail screen —
// fetched per-instrument when a user looks it up, not during the bulk daily
// refresh (which would mean thousands of extra API calls per run).
export async function detail(req: AuthedRequest, res: Response) {
  const instrument = await Instrument.findById(req.params.id).lean();
  if (!instrument) {
    res.status(404).json({ message: "Instrument not found." });
    return;
  }
  const instrumentDetail = await fetchInstrumentDetail(instrument);
  res.json({ instrument, detail: instrumentDetail });
}

// Manual/admin trigger for testing the refresh job on demand — gated by
// requireAdmin (env.adminEmails) at the route level. runInstrumentRefresh()
// itself de-dupes concurrent calls (see instrumentService.ts), so this is
// also safe to call while the daily cron or another admin's request is
// already mid-run — this just joins that run instead of starting a second
// one.
export async function triggerRefresh(_req: AuthedRequest, res: Response) {
  const summary = await runInstrumentRefresh();
  res.json({ message: "Instrument refresh complete.", summary });
}
