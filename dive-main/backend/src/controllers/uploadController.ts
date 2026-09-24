import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { parseCsv } from "../services/fileParsers/csvParser";
import { parseXlsx } from "../services/fileParsers/xlsxParser";
import { parseJson } from "../services/fileParsers/jsonParser";
import { extractHoldingsWithAI, isAiExtractionConfigured, AiExtractionNotConfiguredError, AiExtractionTimeoutError } from "../services/aiExtractionService";
import { assertUsageAllowed, recordUsageEvent } from "../services/usageService";
import { emitActivity } from "../services/activityLog";

/**
 * Parses an uploaded file into candidate holdings — nothing is saved here.
 * The frontend shows these as an editable review/clarification list; only
 * once the user confirms each row does it get POSTed to /api/holdings/manual.
 *
 * CSV/XLSX/JSON are already structured data, so they're parsed deterministically
 * (no ambiguity to resolve). Images and PDFs go through AI extraction instead of
 * OCR + regex — a PDF is sent to the model natively (it can contain several
 * embedded screenshots from different accounts/brokers on separate pages), which
 * is what lets it reason about cross-page/cross-account deduplication the same
 * way the bot scanner does across frames.
 */
export async function uploadFile(req: AuthedRequest, res: Response) {
  const file = req.file;
  if (!file) throw new ApiError(400, "NO_FILE", "No file was uploaded.");

  const name = file.originalname.toLowerCase();
  const buffer = file.buffer;

  if (name.endsWith(".csv") || file.mimetype === "text/csv") {
    const candidates = await parseCsv(buffer);
    emitActivity("doc_upload", { userId: req.userId, req, props: { method: "csv", candidateCount: candidates.length } });
    return respondWithCandidates(res, candidates);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const candidates = await parseXlsx(buffer);
    emitActivity("doc_upload", { userId: req.userId, req, props: { method: "xlsx", candidateCount: candidates.length } });
    return respondWithCandidates(res, candidates);
  }
  if (name.endsWith(".json") || file.mimetype === "application/json") {
    const candidates = await parseJson(buffer);
    emitActivity("doc_upload", { userId: req.userId, req, props: { method: "json", candidateCount: candidates.length } });
    return respondWithCandidates(res, candidates);
  }

  const isPdf = name.endsWith(".pdf") || file.mimetype === "application/pdf";
  const isImage = file.mimetype.startsWith("image/");
  if (!isPdf && !isImage) {
    throw new ApiError(400, "UNSUPPORTED_FILE_TYPE", "Unsupported file type.");
  }

  if (!isAiExtractionConfigured()) {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI-based document analysis isn't configured on this server yet. Ask your administrator to set a real OPENAI_API_KEY (primary) and/or ANTHROPIC_API_KEY (fallback) — see /docs/GETTING_API_KEYS.md — or try a CSV/XLSX/JSON export instead."
    );
  }

  // Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.1/§3.2 — the doc_upload plan
  // limit applies ONLY to this AI-extraction branch (a real paid model
  // call), never to the deterministic CSV/XLSX/JSON parsing above — see
  // usageService.ts's assertUsageAllowed for why this can't just be a
  // route-level middleware the way bot_scan's is.
  await assertUsageAllowed(req.userId!, "doc_upload");

  try {
    const result = await extractHoldingsWithAI(
      [isPdf ? { kind: "pdf" as const, data: buffer } : { kind: "image" as const, data: buffer, mimeType: file.mimetype }],
      "file_upload"
    );
    await recordUsageEvent(req.userId!, "doc_upload");
    emitActivity("doc_upload", { userId: req.userId, req, props: { method: isPdf ? "pdf_ai" : "image_ai", candidateCount: result.holdings.length } });
    return respondWithCandidates(res, result.holdings, result.excludedNotes);
  } catch (err) {
    if (err instanceof AiExtractionNotConfiguredError) {
      throw new ApiError(503, "AI_NOT_CONFIGURED", err.message);
    }
    if (err instanceof AiExtractionTimeoutError) {
      throw new ApiError(504, "AI_TIMEOUT", err.message);
    }
    throw err;
  }
}

function respondWithCandidates(res: Response, candidates: unknown[], excludedNotes?: string) {
  if (candidates.length === 0) {
    return res.status(200).json({
      candidates: [],
      message: "Couldn't extract any holdings from this file. Try another file, or add manually.",
    });
  }
  res.status(200).json({ candidates, excludedNotes });
}
