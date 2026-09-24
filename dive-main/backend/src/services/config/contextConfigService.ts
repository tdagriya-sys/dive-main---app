import { Types } from "mongoose";
import { ContextConfig, ContextConfigPayload, IContextConfig } from "../../models/ContextConfig";
import { ASSET_CLASSES } from "../../models/Instrument";
import { CONTEXT_CONFIG_DEFAULTS } from "../../config/contextDefaults";
import { recordAudit } from "../auditLog";
import { ValidationResult, PublishResult } from "./scoringConfigService";
import { invalidateAllDiveScoreCache } from "../diveScoreCache";

/**
 * Config-driven Layer D Context Engine (Phase 2 of docs/ADMIN_PANEL_PLAN.md).
 * Same draft -> validate -> publish -> rollback lifecycle as
 * scoringConfigService.ts — see that file's own comments for the shared
 * reasoning; this one just carries ContextConfigPayload instead.
 */

let cachedActive: ContextConfigPayload | null = null;
let cacheLoaded = false;

export async function getActiveContextConfig(): Promise<ContextConfigPayload> {
  if (cacheLoaded) return cachedActive ?? CONTEXT_CONFIG_DEFAULTS;
  const doc = await ContextConfig.findOne({ status: "active" }).sort({ version: -1 }).lean();
  cachedActive = doc ? doc.payload : null;
  cacheLoaded = true;
  return cachedActive ?? CONTEXT_CONFIG_DEFAULTS;
}

export function invalidateContextConfigCache(): void {
  cacheLoaded = false;
  cachedActive = null;
}

async function nextVersion(): Promise<number> {
  const latest = await ContextConfig.findOne({}).sort({ version: -1 }).select("version").lean();
  return (latest?.version ?? 0) + 1;
}

export async function getOrCreateDraftContextConfig(actorId?: string): Promise<IContextConfig> {
  const existing = await ContextConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (existing) return existing;
  const active = await ContextConfig.findOne({ status: "active" }).sort({ version: -1 });
  return ContextConfig.create({
    version: await nextVersion(),
    status: "draft",
    parentVersion: active?.version,
    payload: active ? active.payload : CONTEXT_CONFIG_DEFAULTS,
    createdBy: actorId,
  });
}

export async function updateDraftContextConfig(payload: Partial<ContextConfigPayload>): Promise<IContextConfig> {
  const draft = await getOrCreateDraftContextConfig();
  draft.payload = { ...draft.payload, ...payload } as ContextConfigPayload;
  await draft.save();
  return draft;
}

export function validateContextConfigPayload(payload: ContextConfigPayload): ValidationResult {
  const errors: string[] = [];

  const tiers = [...payload.corpusTiers].sort((a, b) => a.maxAmount - b.maxAmount);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].maxAmount <= tiers[i - 1].maxAmount) errors.push(`corpusTiers maxAmount must be strictly increasing (${tiers[i - 1].label} -> ${tiers[i].label})`);
  }
  for (const t of payload.corpusTiers) {
    if (t.expectedClassCount < 1 || t.expectedClassCount > 12) errors.push(`corpusTiers.${t.label}.expectedClassCount must be between 1 and 12`);
  }

  const brackets = [...payload.personaBrackets].sort((a, b) => a.minAge - b.minAge);
  if (brackets.length === 0) {
    errors.push("personaBrackets cannot be empty");
  } else {
    if (brackets[0].minAge > 18) errors.push("personaBrackets must start at age 18 or younger");
    if (brackets[brackets.length - 1].maxAge !== null) errors.push("the last personaBracket must have maxAge: null (no upper bound)");
    for (let i = 1; i < brackets.length; i++) {
      const prevMax = brackets[i - 1].maxAge;
      if (prevMax === null || brackets[i].minAge !== prevMax + 1) {
        errors.push(`personaBrackets must be contiguous with no gaps/overlaps (${brackets[i - 1].label} -> ${brackets[i].label})`);
      }
    }
  }
  for (const p of payload.personaBrackets) {
    if (p.volatilityWorstAt <= 0) errors.push(`personaBrackets.${p.label}.volatilityWorstAt must be positive`);
    if (p.drawdownWorstAt >= 0) errors.push(`personaBrackets.${p.label}.drawdownWorstAt must be negative`);
  }

  const orderSet = new Set(payload.defaultClassOrder);
  if (orderSet.size !== ASSET_CLASSES.length || !ASSET_CLASSES.every((c) => orderSet.has(c))) {
    errors.push("defaultClassOrder must contain every asset class exactly once");
  }

  return { valid: errors.length === 0, errors };
}

export async function publishContextConfig(
  changeNote: string,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<IContextConfig>> {
  const draft = await ContextConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (!draft) return { errors: ["No draft to publish."] };

  const { valid, errors } = validateContextConfigPayload(draft.payload);
  if (!valid) return { errors };

  const previousActive = await ContextConfig.findOne({ status: "active" }).sort({ version: -1 });
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

  invalidateContextConfigCache();
  invalidateAllDiveScoreCache();
  await recordAudit(
    { action: "context_config.publish", resourceType: "ContextConfig", resourceId: String(draft._id), before, after: draft.payload, meta: { version: draft.version, changeNote } },
    actor,
    req
  );
  return { version: draft };
}

export async function rollbackContextConfig(
  targetVersion: number,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<IContextConfig>> {
  const target = await ContextConfig.findOne({ version: targetVersion });
  if (!target) return { errors: [`Version ${targetVersion} not found.`] };

  const previousActive = await ContextConfig.findOne({ status: "active" }).sort({ version: -1 });
  const before = previousActive?.payload;
  if (previousActive) {
    previousActive.status = "archived";
    await previousActive.save();
  }
  const restored = await ContextConfig.create({
    version: await nextVersion(),
    status: "active",
    parentVersion: previousActive?.version,
    payload: target.payload,
    changeNote: `Rolled back to version ${targetVersion}`,
    createdBy: actor.actorId,
    publishedBy: actor.actorId,
    publishedAt: new Date(),
  });
  invalidateContextConfigCache();
  invalidateAllDiveScoreCache();
  await recordAudit(
    { action: "context_config.rollback", resourceType: "ContextConfig", resourceId: String(restored._id), before, after: restored.payload, meta: { version: restored.version, rolledBackTo: targetVersion } },
    actor,
    req
  );
  return { version: restored };
}

export async function getContextConfigHistory() {
  return ContextConfig.find({}).sort({ version: -1 }).select("version status changeNote publishedAt publishedBy createdAt").lean();
}

export async function getContextConfigVersion(version: number) {
  return ContextConfig.findOne({ version }).lean();
}
