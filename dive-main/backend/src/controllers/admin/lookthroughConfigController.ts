import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import {
  getActiveLookthroughConfig,
  getOrCreateDraftLookthroughConfig,
  updateDraftLookthroughConfig,
  validateLookthroughConfigPayload,
  publishLookthroughConfig,
  rollbackLookthroughConfig,
  getLookthroughConfigHistory,
  getLookthroughConfigVersion,
} from "../../services/config/lookthroughConfigService";
import { simulateLookthroughConfigChange } from "../../services/config/simulationService";

/**
 * Admin API for the Look-Through / Connectedness model (§7 of
 * docs/DIVE_SCORE_MODEL.md — the "plausible future extension" Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md left out). Mounted under
 * /api/admin/lookthrough-config — see admin.routes.ts for permission gates.
 * Mirrors contextConfigController.ts.
 */

function actorFrom(req: StaffRequest) {
  return { actorId: req.staff?.userId, actorRole: req.staff?.staffRole, actorLabel: req.staff?.email };
}

export async function getActive(_req: StaffRequest, res: Response) {
  res.status(200).json({ payload: await getActiveLookthroughConfig() });
}

export async function getDraft(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftLookthroughConfig(req.staff?.userId);
  res.status(200).json({ draft });
}

export async function updateDraft(req: StaffRequest, res: Response) {
  const draft = await updateDraftLookthroughConfig(req.body?.payload ?? {});
  res.status(200).json({ draft });
}

export async function validateDraft(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftLookthroughConfig(req.staff?.userId);
  const candidate = { ...draft.payload, ...(req.body?.payload ?? {}) };
  res.status(200).json(validateLookthroughConfigPayload(candidate));
}

// A read-only preview: scores a bounded sample of real users under this
// candidate config side by side with the currently active one. Never
// persists anything — see simulationService.ts's own comment.
export async function simulate(req: StaffRequest, res: Response) {
  const draft = await getOrCreateDraftLookthroughConfig(req.staff?.userId);
  const candidate = { ...draft.payload, ...(req.body?.payload ?? {}) };
  const sampleSize = typeof req.body?.sampleSize === "number" ? req.body.sampleSize : undefined;
  const result = await simulateLookthroughConfigChange(candidate, sampleSize);
  res.status(200).json(result);
}

export async function publish(req: StaffRequest, res: Response) {
  const changeNote = typeof req.body?.changeNote === "string" ? req.body.changeNote.trim() : "";
  if (!changeNote) throw new ApiError(400, "CHANGE_NOTE_REQUIRED", "A change note is required to publish.");
  const result = await publishLookthroughConfig(changeNote, actorFrom(req), req);
  if (result.errors) throw new ApiError(422, "VALIDATION_FAILED", result.errors.join(" "));
  res.status(200).json({ version: result.version });
}

export async function rollback(req: StaffRequest, res: Response) {
  const targetVersion = parseInt(String(req.body?.targetVersion), 10);
  if (!Number.isFinite(targetVersion)) throw new ApiError(400, "TARGET_VERSION_REQUIRED", "A numeric targetVersion is required.");
  const result = await rollbackLookthroughConfig(targetVersion, actorFrom(req), req);
  if (result.errors) throw new ApiError(422, "ROLLBACK_FAILED", result.errors.join(" "));
  res.status(200).json({ version: result.version });
}

export async function getHistory(_req: StaffRequest, res: Response) {
  res.status(200).json({ history: await getLookthroughConfigHistory() });
}

export async function getVersion(req: StaffRequest, res: Response) {
  const version = parseInt(req.params.version, 10);
  if (!Number.isFinite(version)) throw new ApiError(400, "INVALID_VERSION", "version must be numeric.");
  const doc = await getLookthroughConfigVersion(version);
  if (!doc) throw new ApiError(404, "VERSION_NOT_FOUND", `Version ${version} not found.`);
  res.status(200).json({ version: doc });
}
