import { Types } from "mongoose";
import { ScoringConfig, ScoringConfigPayload, IScoringConfig } from "../../models/ScoringConfig";
import { ASSET_CLASSES } from "../../models/Instrument";
import { SCORING_CONFIG_DEFAULTS } from "../../config/scoringDefaults";
import { recordAudit } from "../auditLog";
import { invalidateAllDiveScoreCache } from "../diveScoreCache";

/**
 * Config-driven Dive Score model (Phase 2 of docs/ADMIN_PANEL_PLAN.md).
 * `getActiveScoringConfig()` is what `diveScoreService.ts` now calls instead
 * of reading its old module-level constants — cached in-memory, invalidated
 * on publish/rollback, falling back to `SCORING_CONFIG_DEFAULTS` (the exact
 * old hardcoded values) whenever no config has ever been published, so
 * behaviour is byte-identical to before this system existed until an admin
 * actually changes something.
 */

let cachedActive: ScoringConfigPayload | null = null;
let cacheLoaded = false;

export async function getActiveScoringConfig(): Promise<ScoringConfigPayload> {
  if (cacheLoaded) return cachedActive ?? SCORING_CONFIG_DEFAULTS;
  const doc = await ScoringConfig.findOne({ status: "active" }).sort({ version: -1 }).lean();
  cachedActive = doc ? doc.payload : null;
  cacheLoaded = true;
  return cachedActive ?? SCORING_CONFIG_DEFAULTS;
}

export function invalidateScoringConfigCache(): void {
  cacheLoaded = false;
  cachedActive = null;
}

async function nextVersion(): Promise<number> {
  const latest = await ScoringConfig.findOne({}).sort({ version: -1 }).select("version").lean();
  return (latest?.version ?? 0) + 1;
}

// Returns the current draft, creating one (seeded from the active config, or
// the built-in defaults if nothing has ever been published) if none exists —
// there is at most one live draft at a time, mirroring a normal "edit, then
// publish" flow rather than juggling multiple concurrent drafts.
export async function getOrCreateDraftScoringConfig(actorId?: string): Promise<IScoringConfig> {
  const existing = await ScoringConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (existing) return existing;

  const active = await ScoringConfig.findOne({ status: "active" }).sort({ version: -1 });
  const draft = await ScoringConfig.create({
    version: await nextVersion(),
    status: "draft",
    parentVersion: active?.version,
    payload: active ? active.payload : SCORING_CONFIG_DEFAULTS,
    createdBy: actorId,
  });
  return draft;
}

export async function updateDraftScoringConfig(payload: Partial<ScoringConfigPayload>): Promise<IScoringConfig> {
  const draft = await getOrCreateDraftScoringConfig();
  draft.payload = { ...draft.payload, ...payload } as ScoringConfigPayload;
  await draft.save();
  return draft;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const WEIGHT_SUM_TOLERANCE = 0.001;

export function validateScoringConfigPayload(payload: ScoringConfigPayload): ValidationResult {
  const errors: string[] = [];

  const weightSum = Object.values(payload.compositeWeights).reduce((s, w) => s + w, 0);
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    errors.push(`compositeWeights must sum to 1.0 (currently ${weightSum.toFixed(4)})`);
  }
  for (const [key, w] of Object.entries(payload.compositeWeights)) {
    if (w < 0) errors.push(`compositeWeights.${key} cannot be negative`);
  }

  const concSum = Object.values(payload.concentrationSubWeights).reduce((s, w) => s + w, 0);
  if (Math.abs(concSum - 1) > WEIGHT_SUM_TOLERANCE) {
    errors.push(`concentrationSubWeights must sum to 1.0 (currently ${concSum.toFixed(4)})`);
  }

  for (const cls of ASSET_CLASSES) {
    const tier = payload.liquidityTiers[cls];
    if (tier === undefined) errors.push(`liquidityTiers is missing ${cls}`);
    else if (tier < 0 || tier > 100) errors.push(`liquidityTiers.${cls} must be between 0 and 100 (got ${tier})`);
  }

  if (payload.stockCountBreakpoints.length < 2) {
    errors.push("stockCountBreakpoints needs at least 2 points");
  } else {
    for (let i = 1; i < payload.stockCountBreakpoints.length; i++) {
      const [prevCount] = payload.stockCountBreakpoints[i - 1];
      const [count, score] = payload.stockCountBreakpoints[i];
      if (count <= prevCount) errors.push(`stockCountBreakpoints must have strictly increasing counts (${prevCount} -> ${count})`);
      if (score < 0 || score > 100) errors.push(`stockCountBreakpoints score ${score} must be between 0 and 100`);
    }
  }

  const b = payload.subScoreBestAt;
  const pairs: Array<[string, number, number]> = [
    ["var", b.varWorstAt, b.varBestAt],
    ["beta", b.betaWorstAt, b.betaBestAt],
    ["correlation", b.correlationWorstAt, b.correlationBestAt],
    ["diversificationRatio", b.diversificationRatioWorstAt, b.diversificationRatioBestAt],
  ];
  for (const [name, worst, best] of pairs) {
    if (worst === best) errors.push(`${name}: worstAt and bestAt cannot be equal`);
  }

  if (payload.cryptoWithinClassCap < 0 || payload.cryptoWithinClassCap > 100) errors.push("cryptoWithinClassCap must be between 0 and 100");
  if (payload.equitySectorSpreadTarget < 1) errors.push("equitySectorSpreadTarget must be at least 1");
  if (payload.drawdownUnrecoveredPenalty < 0) errors.push("drawdownUnrecoveredPenalty cannot be negative");

  return { valid: errors.length === 0, errors };
}

// Shared by every config type's service (scoring/context/suggestion) — a
// generic so each can plug in its own document type.
export interface PublishResult<T = IScoringConfig> {
  version?: T;
  errors?: string[];
}

export async function publishScoringConfig(
  changeNote: string,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<IScoringConfig>> {
  const draft = await ScoringConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (!draft) return { errors: ["No draft to publish."] };

  const { valid, errors } = validateScoringConfigPayload(draft.payload);
  if (!valid) return { errors };

  const previousActive = await ScoringConfig.findOne({ status: "active" }).sort({ version: -1 });
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

  invalidateScoringConfigCache();
  invalidateAllDiveScoreCache();

  await recordAudit(
    { action: "scoring_config.publish", resourceType: "ScoringConfig", resourceId: String(draft._id), before, after: draft.payload, meta: { version: draft.version, changeNote } },
    actor,
    req
  );

  return { version: draft };
}

// Re-publishes an ARCHIVED version's payload as a brand-new version (never
// literally reactivates the old document) — keeps the version history a
// simple, always-increasing timeline instead of jumping around.
export async function rollbackScoringConfig(
  targetVersion: number,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult> {
  const target = await ScoringConfig.findOne({ version: targetVersion });
  if (!target) return { errors: [`Version ${targetVersion} not found.`] };

  const previousActive = await ScoringConfig.findOne({ status: "active" }).sort({ version: -1 });
  const before = previousActive?.payload;
  if (previousActive) {
    previousActive.status = "archived";
    await previousActive.save();
  }

  const restored = await ScoringConfig.create({
    version: await nextVersion(),
    status: "active",
    parentVersion: previousActive?.version,
    payload: target.payload,
    changeNote: `Rolled back to version ${targetVersion}`,
    createdBy: actor.actorId,
    publishedBy: actor.actorId,
    publishedAt: new Date(),
  });

  invalidateScoringConfigCache();
  invalidateAllDiveScoreCache();

  await recordAudit(
    {
      action: "scoring_config.rollback",
      resourceType: "ScoringConfig",
      resourceId: String(restored._id),
      before,
      after: restored.payload,
      meta: { version: restored.version, rolledBackTo: targetVersion },
    },
    actor,
    req
  );

  return { version: restored };
}

export async function getScoringConfigHistory() {
  return ScoringConfig.find({}).sort({ version: -1 }).select("version status changeNote publishedAt publishedBy createdAt").lean();
}

export async function getScoringConfigVersion(version: number) {
  return ScoringConfig.findOne({ version }).lean();
}
