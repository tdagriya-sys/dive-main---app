import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import {
  getActiveScoringConfig,
  getOrCreateDraftScoringConfig,
  updateDraftScoringConfig,
  validateScoringConfigPayload,
  publishScoringConfig,
  rollbackScoringConfig,
  getScoringConfigHistory,
  getScoringConfigVersion,
} from "../../services/config/scoringConfigService";
import { simulateScoringConfigChange } from "../../services/config/simulationService";

/**
 * Admin API for the Dive Score model (Phase 2 of docs/ADMIN_PANEL_PLAN.md).
 * Mounted under /api/admin/scoring-config — see admin.routes.ts for the
 * permission gates (view/edit/publish + step-up on publish/rollback).
 */

function actorFrom(req: StaffRequest) {
  return { actorId: req.staff?.userId, actorRole: req.staff?.staffRole, actorLabel: req.staff?.email };
}

export async function getActive(_req: StaffRequest, res: Response) {
  res.status(200).json({ payload: await getActiveScoringConfig() });
}

export async function getDraft(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftScoringConfig(req.staff?.userId);
  res.status(200).json({ draft });
}

export async function updateDraft(req: StaffRequest, res: Response) {
  const draft = await updateDraftScoringConfig(req.body?.payload ?? {});
  res.status(200).json({ draft });
}

// A dry-run: validates the current draft merged with the given partial
// payload WITHOUT persisting anything — lets the admin UI show live
// validation feedback as fields change, before the user commits an update.
export async function validateDraft(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftScoringConfig(req.staff?.userId);
  const candidate = { ...draft.payload, ...(req.body?.payload ?? {}) };
  res.status(200).json(validateScoringConfigPayload(candidate));
}

// A read-only preview: scores a bounded sample of real users under this
// candidate config side by side with the currently active one. Never
// persists anything — see simulationService.ts's own comment.
export async function simulate(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftScoringConfig(req.staff?.userId);
  const candidate = { ...draft.payload, ...(req.body?.payload ?? {}) };
  const sampleSize = typeof req.body?.sampleSize === "number" ? req.body.sampleSize : undefined;
  const result = await simulateScoringConfigChange(candidate, sampleSize);
  res.status(200).json(result);
}

export async function publish(req: StaffRequest, res: Response) {
  const changeNote = typeof req.body?.changeNote === "string" ? req.body.changeNote.trim() : "";
  if (!changeNote) throw new ApiError(400, "CHANGE_NOTE_REQUIRED", "A change note is required to publish.");
  const result = await publishScoringConfig(changeNote, actorFrom(req), req);
  if (result.errors) throw new ApiError(422, "VALIDATION_FAILED", result.errors.join(" "));
  res.status(200).json({ version: result.version });
}

export async function rollback(req: StaffRequest, res: Response) {
  const targetVersion = parseInt(String(req.body?.targetVersion), 10);
  if (!Number.isFinite(targetVersion)) throw new ApiError(400, "TARGET_VERSION_REQUIRED", "A numeric targetVersion is required.");
  const result = await rollbackScoringConfig(targetVersion, actorFrom(req), req);
  if (result.errors) throw new ApiError(422, "ROLLBACK_FAILED", result.errors.join(" "));
  res.status(200).json({ version: result.version });
}

export async function getHistory(_req: StaffRequest, res: Response) {
  res.status(200).json({ history: await getScoringConfigHistory() });
}

export async function getVersion(req: StaffRequest, res: Response) {
  const version = parseInt(req.params.version, 10);
  if (!Number.isFinite(version)) throw new ApiError(400, "INVALID_VERSION", "version must be numeric.");
  const doc = await getScoringConfigVersion(version);
  if (!doc) throw new ApiError(404, "VERSION_NOT_FOUND", `Version ${version} not found.`);
  res.status(200).json({ version: doc });
}
