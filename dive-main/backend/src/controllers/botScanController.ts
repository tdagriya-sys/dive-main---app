import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { extractHoldingsWithAI, isAiExtractionConfigured, AiExtractionNotConfiguredError, AiExtractionTimeoutError } from "../services/aiExtractionService";

/**
 * Analyzes every frame captured during one scan session in a single AI call —
 * not per-frame. Sending all frames together (instead of the old per-frame
 * regex pipeline) is what lets the model reason across frames: recognizing
 * that the same holding seen in frame 3 and frame 7 is one position (scrolled
 * past twice), not two, while still telling apart a genuinely different
 * account's holdings from the same-named instrument in another account.
 */
export async function analyzeFrames(req: AuthedRequest, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (files.length === 0) throw new ApiError(400, "NO_FRAMES", "No scan frames were uploaded.");

  if (!isAiExtractionConfigured()) {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI-based scan analysis isn't configured on this server yet. Ask your administrator to set a real OPENAI_API_KEY (primary) and/or ANTHROPIC_API_KEY (fallback) — see /docs/GETTING_API_KEYS.md."
    );
  }

  try {
    const result = await extractHoldingsWithAI(
      files.map((f) => ({ kind: "image" as const, data: f.buffer, mimeType: f.mimetype })),
      "bot_scan"
    );
    res.status(200).json({ candidates: result.holdings, excludedNotes: result.excludedNotes, framesAnalyzed: files.length });
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
