import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { createFeatureFlagSchema, updateFeatureFlagSchema } from "../../validators/featureFlag";
import * as featureFlagService from "../../services/featureFlagService";
import { IFeatureFlag } from "../../models/FeatureFlag";
import { recordAudit } from "../../services/auditLog";

/**
 * Feature-flag admin CRUD (Phase 7 of docs/ADMIN_PANEL_PLAN.md §11 —
 * "Feature flags / gradual rollout"). Gated by `feature_flags.manage`, no
 * step-up — a flag only ever changes what's SHOWN to a cohort of users, it
 * moves no money and deletes nothing, unlike the actions that do warrant it.
 */

function serialize(f: IFeatureFlag) {
  return {
    id: String(f._id),
    key: f.key,
    description: f.description,
    enabled: f.enabled,
    rolloutPct: f.rolloutPct,
    enabledForUserIds: f.enabledForUserIds.map(String),
    enabledForPlanKeys: f.enabledForPlanKeys,
    updatedBy: f.updatedBy,
    updatedAt: f.updatedAt,
  };
}

export async function listFeatureFlags(_req: StaffRequest, res: Response) {
  const flags = await featureFlagService.listFeatureFlags();
  res.status(200).json({ flags: flags.map(serialize) });
}

export async function createFeatureFlag(req: StaffRequest, res: Response) {
  const data = createFeatureFlagSchema.parse(req.body);
  const flag = await featureFlagService.createFeatureFlag(data, req.staff!.email);
  await recordAudit(
    { action: "feature_flag.created", resourceType: "FeatureFlag", resourceId: String(flag._id), meta: { key: flag.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ flag: serialize(flag) });
}

export async function updateFeatureFlag(req: StaffRequest, res: Response) {
  const data = updateFeatureFlagSchema.parse(req.body);
  const before = (await featureFlagService.listFeatureFlags()).find((f) => String(f._id) === req.params.id);
  const flag = await featureFlagService.updateFeatureFlag(req.params.id, data, req.staff!.email);

  await recordAudit(
    { action: "feature_flag.updated", resourceType: "FeatureFlag", resourceId: String(flag._id), before: before ? serialize(before) : undefined, after: serialize(flag) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ flag: serialize(flag) });
}
