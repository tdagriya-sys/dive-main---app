import { Types } from "mongoose";
import { SuggestionConfig, SuggestionConfigPayload, ISuggestionConfig } from "../../models/SuggestionConfig";
import { SUGGESTION_CONFIG_DEFAULTS } from "../../config/suggestionDefaults";
import { recordAudit } from "../auditLog";
import { ValidationResult, PublishResult } from "./scoringConfigService";

/**
 * Config-driven Suggestion layer (Phase 2 of docs/ADMIN_PANEL_PLAN.md). Same
 * draft -> validate -> publish -> rollback lifecycle as
 * scoringConfigService.ts. Served to the frontend (which has no direct DB
 * access) via the public GET /api/score/config endpoint.
 */

let cachedActive: SuggestionConfigPayload | null = null;
let cacheLoaded = false;

export async function getActiveSuggestionConfig(): Promise<SuggestionConfigPayload> {
  if (cacheLoaded) return cachedActive ?? SUGGESTION_CONFIG_DEFAULTS;
  const doc = await SuggestionConfig.findOne({ status: "active" }).sort({ version: -1 }).lean();
  cachedActive = doc ? doc.payload : null;
  cacheLoaded = true;
  return cachedActive ?? SUGGESTION_CONFIG_DEFAULTS;
}

export function invalidateSuggestionConfigCache(): void {
  cacheLoaded = false;
  cachedActive = null;
}

async function nextVersion(): Promise<number> {
  const latest = await SuggestionConfig.findOne({}).sort({ version: -1 }).select("version").lean();
  return (latest?.version ?? 0) + 1;
}

export async function getOrCreateDraftSuggestionConfig(actorId?: string): Promise<ISuggestionConfig> {
  const existing = await SuggestionConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (existing) return existing;
  const active = await SuggestionConfig.findOne({ status: "active" }).sort({ version: -1 });
  return SuggestionConfig.create({
    version: await nextVersion(),
    status: "draft",
    parentVersion: active?.version,
    payload: active ? active.payload : SUGGESTION_CONFIG_DEFAULTS,
    createdBy: actorId,
  });
}

export async function updateDraftSuggestionConfig(payload: Partial<SuggestionConfigPayload>): Promise<ISuggestionConfig> {
  const draft = await getOrCreateDraftSuggestionConfig();
  draft.payload = { ...draft.payload, ...payload } as SuggestionConfigPayload;
  await draft.save();
  return draft;
}

export function validateSuggestionConfigPayload(payload: SuggestionConfigPayload): ValidationResult {
  const errors: string[] = [];

  for (const profile of ["Conservative", "Balanced", "Aggressive"] as const) {
    const ranges = payload.idealRanges[profile];
    for (const cat of payload.coreCategories) {
      const range = ranges[cat];
      if (!range) {
        errors.push(`idealRanges.${profile} is missing "${cat}"`);
        continue;
      }
      const [lo, hi] = range;
      if (lo < 0 || hi < 0) errors.push(`idealRanges.${profile}.${cat} cannot be negative`);
      if (lo > hi) errors.push(`idealRanges.${profile}.${cat}: low (${lo}) cannot exceed high (${hi})`);
    }
  }

  for (const cat of payload.coreCategories) {
    if (!payload.returnTier[cat]) errors.push(`returnTier is missing "${cat}"`);
  }

  const capLow = payload.diversificationCap.Low;
  const capMedium = payload.diversificationCap.Medium;
  if (capLow !== null && capMedium !== null && capLow > capMedium) {
    errors.push("diversificationCap.Low cannot exceed diversificationCap.Medium");
  }

  const blendSum = payload.fastPathBlend.apparent + payload.fastPathBlend.real + payload.fastPathBlend.name;
  if (Math.abs(blendSum - 1) > 0.001) errors.push(`fastPathBlend must sum to 1.0 (currently ${blendSum.toFixed(4)})`);

  return { valid: errors.length === 0, errors };
}

export async function publishSuggestionConfig(
  changeNote: string,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<ISuggestionConfig>> {
  const draft = await SuggestionConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (!draft) return { errors: ["No draft to publish."] };

  const { valid, errors } = validateSuggestionConfigPayload(draft.payload);
  if (!valid) return { errors };

  const previousActive = await SuggestionConfig.findOne({ status: "active" }).sort({ version: -1 });
  const before = previousActive?.payload;
  if (previousActive) {
    previousActive.status = "archived";
    await previousActive.save();
  }
  draft.status = "active";
  draft.changeNote = changeNote;
  draft.publishedBy = actor.actorId ? new Types.ObjectId(actor.actorId) : undefined;
  draft.publishedAt = new Date();
  await draft.save();

  invalidateSuggestionConfigCache();
  await recordAudit(
    { action: "suggestion_config.publish", resourceType: "SuggestionConfig", resourceId: String(draft._id), before, after: draft.payload, meta: { version: draft.version, changeNote } },
    actor,
    req
  );
  return { version: draft };
}

export async function rollbackSuggestionConfig(
  targetVersion: number,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<ISuggestionConfig>> {
  const target = await SuggestionConfig.findOne({ version: targetVersion });
  if (!target) return { errors: [`Version ${targetVersion} not found.`] };

  const previousActive = await SuggestionConfig.findOne({ status: "active" }).sort({ version: -1 });
  const before = previousActive?.payload;
  if (previousActive) {
    previousActive.status = "archived";
    await previousActive.save();
  }
  const restored = await SuggestionConfig.create({
    version: await nextVersion(),
    status: "active",
    parentVersion: previousActive?.version,
    payload: target.payload,
    changeNote: `Rolled back to version ${targetVersion}`,
    createdBy: actor.actorId,
    publishedBy: actor.actorId,
    publishedAt: new Date(),
  });
  invalidateSuggestionConfigCache();
  await recordAudit(
    { action: "suggestion_config.rollback", resourceType: "SuggestionConfig", resourceId: String(restored._id), before, after: restored.payload, meta: { version: restored.version, rolledBackTo: targetVersion } },
    actor,
    req
  );
  return { version: restored };
}

export async function getSuggestionConfigHistory() {
  return SuggestionConfig.find({}).sort({ version: -1 }).select("version status changeNote publishedAt publishedBy createdAt").lean();
}

export async function getSuggestionConfigVersion(version: number) {
  return SuggestionConfig.findOne({ version }).lean();
}
