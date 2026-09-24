import { Response } from "express";
import { FilterQuery } from "mongoose";
import { Subscription, ISubscription } from "../../models/Subscription";
import { SubscriptionPlan } from "../../models/SubscriptionPlan";
import { User } from "../../models/User";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { adminChangePlanSchema, cancelSubscriptionSchema, grantSubscriptionSchema, usageGrantSchema, renewalReminderSettingsSchema } from "../../validators/subscription";
import * as subscriptionService from "../../services/subscriptionService";
import * as adminSettingService from "../../services/adminSettingService";
import { recordAudit } from "../../services/auditLog";
import { resolveUserRef } from "../../utils/resolveUserRef";
import { UsageGrant } from "../../models/UsageGrant";

/**
 * Staff subscription management (Phase 6a of docs/ADMIN_PANEL_PLAN.md
 * §5.3) — gated by `subscriptions.manage`; cancel/change-plan/grant all
 * mutate real billing state, so every one is audited.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// "newest"/"oldest" order by when the subscription was created; the
// "expiring_*" options order by currentPeriodEnd instead — useful for
// finding who's about to lapse (or who just renewed) rather than who signed
// up recently, a different admin question from the default.
const SUBSCRIPTION_SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  expiring_soon: { currentPeriodEnd: 1 },
  expiring_latest: { currentPeriodEnd: -1 },
};

export async function listSubscriptions(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  const sortSpec = SUBSCRIPTION_SORTS[String(req.query.sort ?? "newest")] ?? SUBSCRIPTION_SORTS.newest;

  const filter: FilterQuery<ISubscription> = {};
  if (status) filter.status = status;
  // An exact user pick (from the search box's autocomplete dropdown) takes
  // priority over the free-text q below — the frontend clears q when a
  // suggestion is selected, but guard the precedence here too either way.
  if (userId) {
    filter.userId = userId;
  } else if (q) {
    // Search by the OWNING USER's name/email/mobile — Subscription itself
    // has no denormalized copy of any of those, so resolve matching users
    // first, same regex-escape convention as usersController.ts::listUsers.
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchingUsers = await User.find({ $or: [{ name: re }, { email: re }, { mobile: re }] }).select("_id").lean();
    filter.userId = { $in: matchingUsers.map((u) => u._id) };
  }

  const [total, subscriptions] = await Promise.all([
    Subscription.countDocuments(filter),
    Subscription.find(filter)
      .populate("userId", "name email")
      .populate("planId", "key name")
      .sort(sortSpec)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    subscriptions: subscriptions.map((s) => {
      const user = s.userId as unknown as { _id: unknown; name?: string; email?: string } | null;
      const plan = s.planId as unknown as { _id: unknown; key?: string; name?: string } | null;
      return {
        id: String(s._id),
        userId: user ? String(user._id) : null,
        userName: user?.name ?? null,
        userEmail: user?.email ?? null,
        planKey: plan?.key ?? null,
        planName: plan?.name ?? null,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        razorpaySubscriptionId: s.razorpaySubscriptionId,
        createdAt: s.createdAt,
      };
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function getSubscription(req: StaffRequest, res: Response) {
  const subscription = await Subscription.findById(req.params.id).populate("userId", "name email").populate("planId").lean();
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  res.status(200).json({ subscription });
}

export async function cancelSubscriptionAdmin(req: StaffRequest, res: Response) {
  const data = cancelSubscriptionSchema.parse(req.body);
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");

  const before = { status: subscription.status, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd };
  const updated = await subscriptionService.cancelSubscriptionDoc(subscription, data.atPeriodEnd);

  await recordAudit(
    { action: "subscription.cancelled", resourceType: "Subscription", resourceId: String(updated._id), before, after: { status: updated.status, cancelAtPeriodEnd: updated.cancelAtPeriodEnd } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ subscription: { id: String(updated._id), status: updated.status, cancelAtPeriodEnd: updated.cancelAtPeriodEnd } });
}

export async function changePlan(req: StaffRequest, res: Response) {
  const data = adminChangePlanSchema.parse(req.body);
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");

  const before = { planId: String(subscription.planId) };
  const updated = await subscriptionService.changeSubscriptionPlan(subscription, data.planKey);

  await recordAudit(
    { action: "subscription.plan_changed", resourceType: "Subscription", resourceId: String(updated._id), before, after: { planId: String(updated.planId) } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ subscription: { id: String(updated._id), planId: String(updated.planId) } });
}

export async function grant(req: StaffRequest, res: Response) {
  const data = grantSubscriptionSchema.parse(req.body);
  const user = await resolveUserRef(data.userIdOrEmail);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "No user found with that ID or email.");
  const plan = await SubscriptionPlan.findOne({ key: data.planKey }).lean();
  if (!plan) throw new ApiError(404, "PLAN_NOT_FOUND", "Plan not found.");

  const userId = String(user._id);
  const subscription = await subscriptionService.grantComplimentarySubscription(userId, data.planKey, data.days);

  await recordAudit(
    { action: "subscription.granted", resourceType: "Subscription", resourceId: String(subscription._id), meta: { userId, planKey: data.planKey, days: data.days } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ subscription: { id: String(subscription._id), status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd } });
}

// Requirement: an admin-wide, per-user view of who has claimed a Premium
// trial — one row per user who has ever had a trialDaysGranted>0
// subscription (see Subscription.ts's own comment on that field), not just
// whoever currently happens to be in "trialing" status (which excludes
// anyone whose trial already ended).
export async function listTrialUsers(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  // "legacy" and "forfeited" are their own categories here (on top of the
  // normal subscription statuses) since they answer questions no status
  // value covers — "whose trial length do we not actually know" and "who
  // never claimed a trial at all before subscribing directly."
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const sortOrder = req.query.sort === "oldest" ? "oldest" : "newest";

  // One row per user, keeping only their MOST RECENT trial subscription —
  // a user can only ever claim one trial (hasUsedTrial), but a comp-granted
  // regrant means, in principle, more than one trialDaysGranted row could
  // exist over time; the latest is the one worth showing.
  const taggedRows = await Subscription.aggregate([
    { $match: { trialDaysGranted: { $gt: 0 } } },
    { $sort: { createdAt: -1 as const } },
    { $group: { _id: "$userId", subscription: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$subscription" } },
  ]);
  const taggedUserIds = taggedRows.map((r) => r.userId);

  // Legacy fallback: `trialDaysGranted` was added after this product already
  // had trial users, and is deliberately NOT backfilled (see Subscription.ts's
  // own comment on the field) — so a user who claimed a trial before this
  // field existed has `hasUsedTrial: true` but no subscription row matching
  // the query above, and would otherwise be invisible here even though they
  // very much used a trial. Surface them too, best-effort, using their most
  // recent subscription (any status) for plan/period context — with
  // `trialDaysGranted: null` marking the historical length as unknown rather
  // than guessing.
  const legacyUsers = await User.find({ hasUsedTrial: true, _id: { $nin: taggedUserIds }, staffRole: null })
    .select("name email createdAt trialForfeitedWithoutClaim")
    .lean();
  const legacySubs = legacyUsers.length
    ? await Subscription.aggregate([
        { $match: { userId: { $in: legacyUsers.map((u) => u._id) } } },
        { $sort: { createdAt: -1 as const } },
        { $group: { _id: "$userId", subscription: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$subscription" } },
      ])
    : [];
  const legacySubByUserId = new Map(legacySubs.map((s) => [String(s.userId), s]));

  const allUserIds = [...taggedUserIds, ...legacyUsers.map((u) => u._id)];
  const allPlanIds = [...taggedRows.map((r) => r.planId), ...legacySubs.map((s) => s.planId)].filter(Boolean);
  const [users, plans] = await Promise.all([
    User.find({ _id: { $in: allUserIds } }).select("name email hasUsedTrial").lean(),
    SubscriptionPlan.find({ _id: { $in: allPlanIds } }).select("key name").lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const planById = new Map(plans.map((p) => [String(p._id), p]));

  const taggedEntries = taggedRows.map((s) => {
    const user = userById.get(String(s.userId));
    const plan = planById.get(String(s.planId));
    return {
      id: String(s._id),
      userId: String(s.userId),
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      planKey: plan?.key ?? null,
      planName: plan?.name ?? null,
      trialDaysGranted: s.trialDaysGranted as number,
      status: s.status as string,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      hasUsedTrial: user?.hasUsedTrial ?? true,
      legacy: false,
      forfeited: false,
      sortDate: s.createdAt,
    };
  });
  const legacyEntries = legacyUsers.map((u) => {
    const sub = legacySubByUserId.get(String(u._id));
    const plan = sub ? planById.get(String(sub.planId)) : undefined;
    // Untagged (no trialDaysGranted subscription) splits into two distinct
    // stories: "forfeited" (subscribed directly, never claimed a trial —
    // trialForfeitedWithoutClaim tags this going forward) vs "legacy"
    // (claimed a real trial before trialDaysGranted existed to tag it —
    // only possible for pre-existing historical data at this point).
    const forfeited = !!u.trialForfeitedWithoutClaim;
    return {
      id: sub ? String(sub._id) : `${forfeited ? "forfeited" : "legacy"}-${u._id}`,
      userId: String(u._id),
      userName: u.name ?? null,
      userEmail: u.email ?? null,
      planKey: plan?.key ?? null,
      planName: plan?.name ?? null,
      trialDaysGranted: null,
      status: sub?.status ?? null,
      currentPeriodStart: sub?.currentPeriodStart ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      hasUsedTrial: true,
      legacy: !forfeited,
      forfeited,
      sortDate: sub?.createdAt ?? u.createdAt,
    };
  });

  let combined = [...taggedEntries, ...legacyEntries];
  if (userId) {
    combined = combined.filter((r) => r.userId === userId);
  } else if (q) {
    combined = combined.filter((r) => (r.userName ?? "").toLowerCase().includes(q) || (r.userEmail ?? "").toLowerCase().includes(q));
  }
  if (status === "legacy") {
    combined = combined.filter((r) => r.legacy);
  } else if (status === "forfeited") {
    combined = combined.filter((r) => r.forfeited);
  } else if (status) {
    combined = combined.filter((r) => r.status === status);
  }
  combined.sort((a, b) => {
    const diff = new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
    return sortOrder === "oldest" ? -diff : diff;
  });

  const total = combined.length;
  const pageRows = combined.slice((page - 1) * limit, (page - 1) * limit + limit);

  res.status(200).json({
    trials: pageRows.map(({ sortDate, ...row }) => row),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

// The full subscription history for one user — every past row is kept
// (superseded, never deleted — see upsertLocalSubscription's own comment),
// so this is a plain chronological read, not a separate audit log.
export async function getSubscriptionHistoryForUser(req: StaffRequest, res: Response) {
  const user = await User.findOne({ _id: req.params.userId, staffRole: null }).select("name email").lean();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  const subscriptions = await Subscription.find({ userId: req.params.userId }).populate("planId", "key name").sort({ createdAt: -1 }).lean();

  res.status(200).json({
    user: { id: String(user._id), name: user.name, email: user.email },
    subscriptions: subscriptions.map((s) => {
      const plan = s.planId as unknown as { key?: string; name?: string } | null;
      return {
        id: String(s._id),
        planKey: plan?.key ?? null,
        planName: plan?.name ?? null,
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        trialDaysGranted: s.trialDaysGranted,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        createdAt: s.createdAt,
      };
    }),
  });
}

// Requirement: a standing, admin-grantable extra allowance on top of
// whatever the user's plan already grants (usageService.ts::getLimits adds
// this to the plan's own weekly/monthly limit) — works under Freemium OR
// Premium, unlike grantComplimentarySubscription which only ever grants a
// full plan change. Upserts (replaces, doesn't stack) so re-granting the
// same key twice can't silently accumulate from repeated clicks.
export async function grantUsageBonus(req: StaffRequest, res: Response) {
  const data = usageGrantSchema.parse(req.body);
  const user = await resolveUserRef(data.userIdOrEmail);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "No user found with that ID or email.");

  const before = await UsageGrant.findOne({ userId: user._id, key: data.key }).lean();
  const grant = await UsageGrant.findOneAndUpdate(
    { userId: user._id, key: data.key },
    { bonusWeekly: data.bonusWeekly, bonusMonthly: data.bonusMonthly, bonusTotal: data.bonusTotal },
    { upsert: true, new: true }
  );

  await recordAudit(
    { action: "usage_grant.set", resourceType: "User", resourceId: String(user._id), before, after: { key: data.key, bonusWeekly: data.bonusWeekly, bonusMonthly: data.bonusMonthly, bonusTotal: data.bonusTotal } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ grant: { key: grant.key, bonusWeekly: grant.bonusWeekly, bonusMonthly: grant.bonusMonthly, bonusTotal: grant.bonusTotal } });
}

// How many days before currentPeriodEnd jobs/renewalReminder.cron.ts warns a
// user about an upcoming renewal charge, trial ending, or access lapsing.
// No step-up — same "instantly reversible by editing it again" bar as the
// announcement/maintenance/reportPricing settings, which this mirrors
// exactly (adminSettingService.ts::getRenewalReminderSettings).
export async function getRenewalReminderSettings(_req: StaffRequest, res: Response) {
  const settings = await adminSettingService.getRenewalReminderSettings();
  res.status(200).json(settings);
}

export async function updateRenewalReminderSettings(req: StaffRequest, res: Response) {
  const data = renewalReminderSettingsSchema.parse(req.body);
  const before = await adminSettingService.getRenewalReminderSettings();
  const value = await adminSettingService.setRenewalReminderSettings(data, req.staff!.email);
  await recordAudit(
    { action: "admin_setting.renewal_reminder_updated", resourceType: "AdminSetting", resourceId: "renewalReminder", before, after: value },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json(value);
}
