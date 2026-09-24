import { Response } from "express";
import { SubscriptionPlan } from "../../models/SubscriptionPlan";
import { Subscription } from "../../models/Subscription";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createPlanSchema, updatePlanSchema } from "../../validators/subscription";
import { publishPlanToRazorpay, cancelSubscriptionDoc } from "../../services/subscriptionService";
import { recordAudit } from "../../services/auditLog";
import { logger } from "../../lib/logger";

/**
 * Subscription-plan admin CRUD (Phase 6a of docs/ADMIN_PANEL_PLAN.md
 * §5.3) — gated by `plans.manage`. `pricePaise`/`interval` are deliberately
 * NOT editable once a plan has a `razorpayPlanId` (Razorpay plans are
 * immutable-priced) — create a new plan key and archive the old one to
 * change a price, same as Razorpay itself requires.
 */

function serialize(p: { _id: unknown; key: string; name: string; description?: string; benefits?: string[]; pricePaise: number; interval: string; trialDays: number; entitlements: unknown; razorpayPlanId?: string; isActive: boolean; visibility: string; displayOrder: number; linkedPlanKey?: string }) {
  return {
    id: String(p._id),
    key: p.key,
    name: p.name,
    description: p.description,
    benefits: p.benefits ?? [],
    pricePaise: p.pricePaise,
    interval: p.interval,
    trialDays: p.trialDays,
    entitlements: p.entitlements,
    razorpayPlanId: p.razorpayPlanId,
    isActive: p.isActive,
    visibility: p.visibility,
    displayOrder: p.displayOrder,
    linkedPlanKey: p.linkedPlanKey ?? null,
  };
}

// Keeps a Monthly/Annual pairing symmetric — always set or cleared on BOTH
// plans together, never just one, so the frontend never has to reconcile a
// one-way link (see SubscriptionPlan.ts's own comment on linkedPlanKey).
// `newLinkedKey` is the validated target's key, or `null` to unlink `plan`
// from whatever it's currently linked to (a no-op if it wasn't linked).
async function setSymmetricPlanLink(plan: InstanceType<typeof SubscriptionPlan>, newLinkedKey: string | null): Promise<void> {
  if (plan.linkedPlanKey === newLinkedKey) return; // already in the desired state
  if (plan.linkedPlanKey) {
    // Clear the OLD partner's side of the link — it's about to point at
    // someone (or no one) new.
    await SubscriptionPlan.updateOne({ key: plan.linkedPlanKey }, { $unset: { linkedPlanKey: "" } });
  }
  if (newLinkedKey) {
    const target = await SubscriptionPlan.findOne({ key: newLinkedKey });
    if (!target) throw new ApiError(404, "PLAN_NOT_FOUND", "The plan to link with doesn't exist.");
    if (target.key === plan.key) throw new ApiError(400, "CANNOT_LINK_SELF", "A plan can't be linked to itself.");
    if (plan.interval === "one_time" || target.interval === "one_time" || plan.interval === target.interval) {
      throw new ApiError(400, "INVALID_PLAN_LINK", "Only one Monthly and one Annual plan can be linked together.");
    }
    // The target might already have its own partner — free that plan too,
    // since a plan can only ever be linked to one other plan at a time.
    if (target.linkedPlanKey && target.linkedPlanKey !== plan.key) {
      await SubscriptionPlan.updateOne({ key: target.linkedPlanKey }, { $unset: { linkedPlanKey: "" } });
    }
    target.linkedPlanKey = plan.key;
    await target.save();
  }
  plan.linkedPlanKey = newLinkedKey ?? undefined;
}

export async function listPlans(_req: StaffRequest, res: Response) {
  const plans = await SubscriptionPlan.find({}).sort({ displayOrder: 1 }).lean();
  res.status(200).json({ plans: plans.map(serialize) });
}

export async function createPlan(req: StaffRequest, res: Response) {
  const data = createPlanSchema.parse(req.body);
  const existing = await SubscriptionPlan.findOne({ key: data.key }).lean();
  if (existing) throw new ApiError(409, "PLAN_KEY_TAKEN", "A plan with this key already exists.");

  const plan = await SubscriptionPlan.create(data);
  await recordAudit(
    { action: "plan.created", resourceType: "SubscriptionPlan", resourceId: String(plan._id), meta: { key: plan.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ plan: serialize(plan) });
}

export async function updatePlan(req: StaffRequest, res: Response) {
  const data = updatePlanSchema.parse(req.body);
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found.");

  const before = serialize(plan);
  if (data.name !== undefined) plan.name = data.name;
  if (data.description !== undefined) plan.description = data.description;
  if (data.benefits !== undefined) plan.benefits = data.benefits;
  if (data.trialDays !== undefined) plan.trialDays = data.trialDays;
  if (data.entitlements) plan.entitlements = { ...plan.entitlements, ...data.entitlements };
  if (data.isActive !== undefined) plan.isActive = data.isActive;
  if (data.visibility !== undefined) plan.visibility = data.visibility;
  if (data.displayOrder !== undefined) plan.displayOrder = data.displayOrder;
  if (data.linkedPlanKey !== undefined) await setSymmetricPlanLink(plan, data.linkedPlanKey);
  await plan.save();

  await recordAudit(
    { action: "plan.updated", resourceType: "SubscriptionPlan", resourceId: String(plan._id), before, after: serialize(plan) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ plan: serialize(plan) });
}

export async function publishToRazorpay(req: StaffRequest, res: Response) {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found.");
  if (plan.razorpayPlanId) throw new ApiError(400, "ALREADY_PUBLISHED", "This plan has already been published to Razorpay.");

  const razorpayPlanId = await publishPlanToRazorpay(plan);
  plan.razorpayPlanId = razorpayPlanId;
  await plan.save();

  await recordAudit(
    { action: "plan.published_to_razorpay", resourceType: "SubscriptionPlan", resourceId: String(plan._id), meta: { razorpayPlanId } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ plan: serialize(plan) });
}

// Archiving a plan (isActive: false, visibility: "legacy") already keeps it
// out of listPublicPlans and out of startSubscription's lookup (both key
// off isActive/visibility), so it was never re-sellable to anyone —
// confirmed unaffected by this change. What archiving did NOT do until now:
// an EXISTING subscriber on that plan kept auto-renewing at a price/plan
// the admin just pulled from sale, with no way for them to ever buy it
// again if it ever lapsed. Turns auto-renew off (local-only, same deferred
// mechanism as a user's own self-serve cancel — see subscriptionService.ts
// ::cancelSubscriptionDoc's own comment) for every live real subscription
// on the plan, WITHOUT ending anyone's current access — they keep every
// benefit until their own currentPeriodEnd, same as this app's cancel
// always meant. Deliberately excludes `trialing` — a trial has no
// auto-renew behind it to turn off in the first place (see the very same
// distinction Subscription.jsx's own cancel control already makes).
async function turnOffAutoRenewForArchivedPlan(planId: string): Promise<number> {
  const live = await Subscription.find({ planId, status: { $in: ["active", "past_due"] }, cancelAtPeriodEnd: false });
  let affected = 0;
  for (const subscription of live) {
    try {
      await cancelSubscriptionDoc(subscription, true);
      affected += 1;
    } catch (err) {
      logger.error({ err, subscriptionId: String(subscription._id) }, "[plansController] failed to turn off auto-renew for a subscriber of an archived plan");
    }
  }
  return affected;
}

export async function archivePlan(req: StaffRequest, res: Response) {
  const plan = await SubscriptionPlan.findById(req.params.id);
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found.");
  plan.isActive = false;
  plan.visibility = "legacy";
  // An archived plan is no longer shown at all (isActive:false), so a
  // Monthly/Annual pairing with it is meaningless going forward — free the
  // OTHER plan to be re-linked instead of leaving it pointed at a plan that
  // will never appear again.
  await setSymmetricPlanLink(plan, null);
  await plan.save();

  const subscribersAffected = await turnOffAutoRenewForArchivedPlan(String(plan._id));

  await recordAudit(
    { action: "plan.archived", resourceType: "SubscriptionPlan", resourceId: String(plan._id), meta: { subscribersAffected } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ plan: serialize(plan), subscribersAffected });
}
