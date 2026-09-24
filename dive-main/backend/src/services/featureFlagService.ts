import { createHash } from "crypto";
import { FeatureFlag, IFeatureFlag } from "../models/FeatureFlag";
import { ApiError } from "../middleware/errorHandler";

/**
 * Gradual-rollout resolution (Phase 7 of docs/ADMIN_PANEL_PLAN.md §11).
 * Deliberately generic infrastructure rather than tied to one specific
 * shipped feature — the plan's own framing ("powers Premium early access")
 * describes a capability, not a named feature that exists yet; the first
 * real consumer wires in whenever a genuine gradual-rollout need shows up,
 * exactly the way `IPlanEntitlements.earlyAccess` (Phase 6a) has sat as a
 * forward-compat hook with no reader since it was added.
 */

// A stable [0, 100) bucket for (flagKey, userId) — the same user always lands
// on the same side of a given flag's rollout percentage across requests,
// rather than a fresh Math.random() flapping them in and out on every call.
function bucketFor(key: string, userId: string): number {
  const hash = createHash("sha256").update(`${key}:${userId}`).digest();
  return hash.readUInt32BE(0) % 100;
}

export async function isFeatureEnabled(key: string, ctx: { userId?: string; planKey?: string }): Promise<boolean> {
  const flag = await FeatureFlag.findOne({ key: key.trim().toLowerCase() }).lean();
  if (!flag || !flag.enabled) return false;
  if (ctx.userId && flag.enabledForUserIds.some((id) => String(id) === ctx.userId)) return true;
  if (ctx.planKey && flag.enabledForPlanKeys.includes(ctx.planKey)) return true;
  if (flag.rolloutPct >= 100) return true;
  if (flag.rolloutPct <= 0) return false;
  return ctx.userId ? bucketFor(flag.key, ctx.userId) < flag.rolloutPct : false;
}

// Every flag resolved for one user in a single pass — what `GET /api/me/
// feature-flags` hands the frontend, so a new flag lights up for a
// consumer with zero extra round-trips.
export async function resolveAllFlagsFor(ctx: { userId?: string; planKey?: string }): Promise<Record<string, boolean>> {
  const flags = await FeatureFlag.find({}).lean();
  const result: Record<string, boolean> = {};
  for (const flag of flags) {
    if (!flag.enabled) {
      result[flag.key] = false;
      continue;
    }
    if (ctx.userId && flag.enabledForUserIds.some((id) => String(id) === ctx.userId)) {
      result[flag.key] = true;
    } else if (ctx.planKey && flag.enabledForPlanKeys.includes(ctx.planKey)) {
      result[flag.key] = true;
    } else if (flag.rolloutPct >= 100) {
      result[flag.key] = true;
    } else if (flag.rolloutPct <= 0) {
      result[flag.key] = false;
    } else {
      result[flag.key] = ctx.userId ? bucketFor(flag.key, ctx.userId) < flag.rolloutPct : false;
    }
  }
  return result;
}

export async function listFeatureFlags(): Promise<IFeatureFlag[]> {
  return FeatureFlag.find({}).sort({ key: 1 }).lean() as unknown as Promise<IFeatureFlag[]>;
}

export async function createFeatureFlag(input: { key: string; description?: string; enabled?: boolean; rolloutPct?: number; enabledForPlanKeys?: string[] }, updatedBy: string): Promise<IFeatureFlag> {
  const key = input.key.trim().toLowerCase();
  const existing = await FeatureFlag.findOne({ key }).lean();
  if (existing) throw new ApiError(409, "FLAG_KEY_TAKEN", "A feature flag with this key already exists.");
  return FeatureFlag.create({ ...input, key, updatedBy });
}

export async function updateFeatureFlag(
  id: string,
  input: { description?: string; enabled?: boolean; rolloutPct?: number; enabledForUserIds?: string[]; enabledForPlanKeys?: string[] },
  updatedBy: string
): Promise<IFeatureFlag> {
  const flag = await FeatureFlag.findById(id);
  if (!flag) throw new ApiError(404, "FLAG_NOT_FOUND", "Feature flag not found.");
  if (input.description !== undefined) flag.description = input.description;
  if (input.enabled !== undefined) flag.enabled = input.enabled;
  if (input.rolloutPct !== undefined) flag.rolloutPct = input.rolloutPct;
  if (input.enabledForUserIds !== undefined) flag.enabledForUserIds = input.enabledForUserIds as unknown as typeof flag.enabledForUserIds;
  if (input.enabledForPlanKeys !== undefined) flag.enabledForPlanKeys = input.enabledForPlanKeys;
  flag.updatedBy = updatedBy;
  await flag.save();
  return flag;
}
