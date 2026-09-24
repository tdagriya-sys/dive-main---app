import { Types } from "mongoose";
import { LookthroughConfig, LookthroughConfigPayload, ILookthroughConfig } from "../../models/LookthroughConfig";
import { LOOKTHROUGH_CONFIG_DEFAULTS } from "../../config/lookthroughDefaults";
import { recordAudit } from "../auditLog";
import { ValidationResult, PublishResult } from "./scoringConfigService";
import { invalidateAllDiveScoreCache } from "../diveScoreCache";

/**
 * Config-driven Look-Through / Connectedness model (§7 of
 * docs/DIVE_SCORE_MODEL.md; the "plausible future extension" Phase 2 of
 * docs/ADMIN_PANEL_PLAN.md deliberately left out — see LookthroughConfig.ts's
 * own comment). Same draft -> validate -> publish -> rollback lifecycle as
 * scoringConfigService.ts/contextConfigService.ts — see those files' own
 * comments for the shared reasoning; this one just carries
 * LookthroughConfigPayload instead.
 */

let cachedActive: LookthroughConfigPayload | null = null;
let cacheLoaded = false;

export async function getActiveLookthroughConfig(): Promise<LookthroughConfigPayload> {
  if (cacheLoaded) return cachedActive ?? LOOKTHROUGH_CONFIG_DEFAULTS;
  const doc = await LookthroughConfig.findOne({ status: "active" }).sort({ version: -1 }).lean();
  cachedActive = doc ? doc.payload : null;
  cacheLoaded = true;
  return cachedActive ?? LOOKTHROUGH_CONFIG_DEFAULTS;
}

export function invalidateLookthroughConfigCache(): void {
  cacheLoaded = false;
  cachedActive = null;
}

async function nextVersion(): Promise<number> {
  const latest = await LookthroughConfig.findOne({}).sort({ version: -1 }).select("version").lean();
  return (latest?.version ?? 0) + 1;
}

export async function getOrCreateDraftLookthroughConfig(actorId?: string): Promise<ILookthroughConfig> {
  const existing = await LookthroughConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (existing) return existing;
  const active = await LookthroughConfig.findOne({ status: "active" }).sort({ version: -1 });
  return LookthroughConfig.create({
    version: await nextVersion(),
    status: "draft",
    parentVersion: active?.version,
    payload: active ? active.payload : LOOKTHROUGH_CONFIG_DEFAULTS,
    createdBy: actorId,
  });
}

export async function updateDraftLookthroughConfig(payload: Partial<LookthroughConfigPayload>): Promise<ILookthroughConfig> {
  const draft = await getOrCreateDraftLookthroughConfig();
  draft.payload = { ...draft.payload, ...payload } as LookthroughConfigPayload;
  await draft.save();
  return draft;
}

// Ordering deliberately mirrors seed/sectorAffinity.ts's own retired comment:
// a sectoral fund spreads its sector bet across many companies (weaker than
// two individual same-sector stocks), which in turn is still well below a
// full exact-issuer match.
export function validateLookthroughConfigPayload(payload: LookthroughConfigPayload): ValidationResult {
  const errors: string[] = [];

  const strengthFields: Array<[string, number]> = [
    ["exactIssuerStrength", payload.exactIssuerStrength],
    ["sameSectorStrength", payload.sameSectorStrength],
    ["sectoralMfAffinityStrength", payload.sectoralMfAffinityStrength],
  ];
  for (const [name, value] of strengthFields) {
    if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1 (got ${value})`);
  }
  if (payload.sectoralMfAffinityStrength >= payload.sameSectorStrength) {
    errors.push("sectoralMfAffinityStrength must be smaller than sameSectorStrength (a sectoral fund spreads its bet across many companies, weaker than two individual same-sector stocks)");
  }
  if (payload.sameSectorStrength >= payload.exactIssuerStrength) {
    errors.push("sameSectorStrength must be smaller than exactIssuerStrength (same-sector is never as strong as an exact issuer match)");
  }

  for (const entry of payload.keywordSectorAffinity) {
    if (entry.keywords.length === 0) errors.push("keywordSectorAffinity entries must have at least one keyword");
    for (const [cls, weight] of Object.entries(entry.affinity)) {
      if (weight! < 0 || weight! > 1) errors.push(`keywordSectorAffinity[${entry.keywords[0] ?? "?"}].affinity.${cls} must be between 0 and 1`);
    }
  }

  for (const [industry, affinity] of Object.entries(payload.industryAssetClassAffinity)) {
    for (const [cls, weight] of Object.entries(affinity)) {
      if (weight! < 0 || weight! > 1) errors.push(`industryAssetClassAffinity.${industry}.${cls} must be between 0 and 1`);
    }
  }

  for (const [segment, industries] of Object.entries(payload.mfSegmentToNseIndustry)) {
    if (industries.length === 0) errors.push(`mfSegmentToNseIndustry.${segment} must list at least one NSE industry`);
  }

  for (const [fundKey, holdings] of Object.entries(payload.mutualFundTopHoldings)) {
    if (!fundKey.trim()) errors.push("mutualFundTopHoldings has an empty fund key");
    for (const h of holdings) {
      if (!h.company.trim()) errors.push(`mutualFundTopHoldings.${fundKey} has a holding with no company name`);
      if (h.weightPct < 0 || h.weightPct > 100) errors.push(`mutualFundTopHoldings.${fundKey}.${h.company}.weightPct must be between 0 and 100`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function publishLookthroughConfig(
  changeNote: string,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<ILookthroughConfig>> {
  const draft = await LookthroughConfig.findOne({ status: "draft" }).sort({ version: -1 });
  if (!draft) return { errors: ["No draft to publish."] };

  const { valid, errors } = validateLookthroughConfigPayload(draft.payload);
  if (!valid) return { errors };

  const previousActive = await LookthroughConfig.findOne({ status: "active" }).sort({ version: -1 });
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

  invalidateLookthroughConfigCache();
  invalidateAllDiveScoreCache();
  await recordAudit(
    { action: "lookthrough_config.publish", resourceType: "LookthroughConfig", resourceId: String(draft._id), before, after: draft.payload, meta: { version: draft.version, changeNote } },
    actor,
    req
  );
  return { version: draft };
}

export async function rollbackLookthroughConfig(
  targetVersion: number,
  actor: { actorId?: string; actorRole?: string; actorLabel?: string },
  req?: Parameters<typeof recordAudit>[2]
): Promise<PublishResult<ILookthroughConfig>> {
  const target = await LookthroughConfig.findOne({ version: targetVersion });
  if (!target) return { errors: [`Version ${targetVersion} not found.`] };

  const previousActive = await LookthroughConfig.findOne({ status: "active" }).sort({ version: -1 });
  const before = previousActive?.payload;
  if (previousActive) {
    previousActive.status = "archived";
    await previousActive.save();
  }
  const restored = await LookthroughConfig.create({
    version: await nextVersion(),
    status: "active",
    parentVersion: previousActive?.version,
    payload: target.payload,
    changeNote: `Rolled back to version ${targetVersion}`,
    createdBy: actor.actorId,
    publishedBy: actor.actorId,
    publishedAt: new Date(),
  });
  invalidateLookthroughConfigCache();
  invalidateAllDiveScoreCache();
  await recordAudit(
    { action: "lookthrough_config.rollback", resourceType: "LookthroughConfig", resourceId: String(restored._id), before, after: restored.payload, meta: { version: restored.version, rolledBackTo: targetVersion } },
    actor,
    req
  );
  return { version: restored };
}

export async function getLookthroughConfigHistory() {
  return LookthroughConfig.find({}).sort({ version: -1 }).select("version status changeNote publishedAt publishedBy createdAt").lean();
}

export async function getLookthroughConfigVersion(version: number) {
  return LookthroughConfig.findOne({ version }).lean();
}
