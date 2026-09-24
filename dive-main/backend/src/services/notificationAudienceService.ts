import { Types, FilterQuery } from "mongoose";
import { User, IUser } from "../models/User";
import { Holding } from "../models/Holding";
import { ActivityEvent } from "../models/ActivityEvent";
import { Subscription } from "../models/Subscription";
import { Payment } from "../models/Payment";
import { NotificationCategory } from "../models/NotificationCategory";
import { UserNotificationPref } from "../models/UserNotificationPref";
import { NotificationChannel } from "../models/NotificationCategory";
import { ICampaignSegmentQuery, CampaignAudienceType, SegmentSubscriptionFilter, SegmentReportFilter } from "../models/NotificationCampaign";

/**
 * Resolves a campaign's audience into real recipient ids (Phase 5 of
 * docs/ADMIN_PANEL_PLAN.md §4.5's "segment builder"). A hard cap keeps a
 * pathological "all users" campaign on a much bigger future user base from
 * ever building an unbounded in-memory array — 50k is far beyond this
 * app's realistic near-term scale, just a sane backstop.
 */
const MAX_AUDIENCE_SIZE = 50_000;

export interface ResolveAudienceInput {
  audience: CampaignAudienceType;
  segmentQuery?: ICampaignSegmentQuery;
  userIds?: string[];
}

// Narrows `filter._id` to the intersection of whatever it already matched
// AND `ids` — the general-purpose "AND another condition" step every
// segment dimension below uses, so combining several at once (e.g.
// "active subscription" + "active in the last 30 days") composes correctly
// instead of the later dimension silently clobbering the earlier one.
function intersectIds(filter: FilterQuery<IUser>, ids: (Types.ObjectId | string)[]): void {
  const idSet = new Set(ids.map(String));
  const existing = filter._id as { $in?: Types.ObjectId[]; $nin?: Types.ObjectId[] } | undefined;
  if (existing?.$in) {
    filter._id = { $in: existing.$in.filter((id) => idSet.has(String(id))) };
  } else if (existing?.$nin) {
    const excluded = new Set(existing.$nin.map(String));
    filter._id = { $in: ids.filter((id) => !excluded.has(String(id))) as Types.ObjectId[] };
  } else {
    filter._id = { $in: ids as Types.ObjectId[] };
  }
}

// The complement of intersectIds — narrows to "already matched AND NOT one
// of `ids`".
function excludeIds(filter: FilterQuery<IUser>, ids: (Types.ObjectId | string)[]): void {
  const idSet = new Set(ids.map(String));
  const existing = filter._id as { $in?: Types.ObjectId[]; $nin?: Types.ObjectId[] } | undefined;
  if (existing?.$in) {
    filter._id = { $in: existing.$in.filter((id) => !idSet.has(String(id))) };
  } else if (existing?.$nin) {
    filter._id = { $nin: [...existing.$nin, ...(ids as Types.ObjectId[])] };
  } else {
    filter._id = { $nin: ids as Types.ObjectId[] };
  }
}

// Every user id with a Subscription row currently granting Premium access
// right now — the exact same trio of statuses (plus the not-yet-expired
// safety check) entitlementService.ts::getActiveSubscription itself uses to
// decide "does this account currently have access".
async function activeSubscriberIds(): Promise<Types.ObjectId[]> {
  return Subscription.distinct("userId", { status: { $in: ["trialing", "active", "past_due"] }, currentPeriodEnd: { $gte: new Date() } });
}

// Ever made a real (non-comp, non-mock-only — "paid" is only ever set on a
// genuinely completed charge) subscription payment, regardless of whether
// that subscription is still live today.
async function everPaidForSubscriptionIds(): Promise<Types.ObjectId[]> {
  return Payment.distinct("userId", { purpose: { $in: ["SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL"] }, status: "paid" });
}

// Four mutually-exclusive subscription-lifecycle buckets for the segment
// builder (see NotificationCampaign.ts::SegmentSubscriptionFilter for the
// exact definitions this implements).
async function applySubscriptionFilter(filter: FilterQuery<IUser>, kind: SegmentSubscriptionFilter): Promise<void> {
  if (kind === "active_subscription") {
    intersectIds(filter, await activeSubscriberIds());
    return;
  }
  if (kind === "lapsed_payer") {
    const [active, everPaid] = await Promise.all([activeSubscriberIds(), everPaidForSubscriptionIds()]);
    const activeSet = new Set(active.map(String));
    intersectIds(filter, everPaid.filter((id) => !activeSet.has(String(id))));
    return;
  }
  if (kind === "trial_only") {
    const everPaid = new Set((await everPaidForSubscriptionIds()).map(String));
    const trialUsers = await User.distinct("_id", { hasUsedTrial: true });
    intersectIds(filter, trialUsers.filter((id) => !everPaid.has(String(id))));
    return;
  }
  // "never_engaged" — hasUsedTrial is a plain field predicate (composes
  // fine alongside whatever else narrows filter._id); the payment exclusion
  // still needs the general excludeIds helper.
  filter.hasUsedTrial = false;
  excludeIds(filter, await everPaidForSubscriptionIds());
}

async function applyReportFilter(filter: FilterQuery<IUser>, kind: SegmentReportFilter): Promise<void> {
  const purchasedIds = await Payment.distinct("userId", { purpose: "SCORE_REPORT_PDF", status: "paid" });
  if (kind === "purchased_report") {
    intersectIds(filter, purchasedIds);
  } else {
    excludeIds(filter, purchasedIds);
  }
}

async function segmentFilter(segmentQuery?: ICampaignSegmentQuery): Promise<FilterQuery<IUser>> {
  const filter: FilterQuery<IUser> = { staffRole: null, status: "active" };
  if (!segmentQuery) return filter;

  if (segmentQuery.signupFrom || segmentQuery.signupTo) {
    filter.createdAt = {};
    if (segmentQuery.signupFrom) filter.createdAt.$gte = segmentQuery.signupFrom;
    if (segmentQuery.signupTo) filter.createdAt.$lte = segmentQuery.signupTo;
  }

  if (segmentQuery.hasHoldings !== undefined || segmentQuery.minHoldingsCount !== undefined) {
    const counts = await Holding.aggregate<{ _id: Types.ObjectId; count: number }>([{ $group: { _id: "$userId", count: { $sum: 1 } } }]);
    const min = segmentQuery.minHoldingsCount ?? (segmentQuery.hasHoldings ? 1 : undefined);
    if (segmentQuery.hasHoldings === false) {
      excludeIds(filter, counts.map((c) => c._id));
    } else {
      const qualifying = min !== undefined ? counts.filter((c) => c.count >= min).map((c) => c._id) : counts.map((c) => c._id);
      intersectIds(filter, qualifying);
    }
  }

  if (segmentQuery.activeSinceDays !== undefined) {
    const cutoff = new Date(Date.now() - segmentQuery.activeSinceDays * 24 * 60 * 60 * 1000);
    const activeUserIds = await ActivityEvent.distinct("userId", { ts: { $gte: cutoff }, userId: { $ne: null } });
    intersectIds(filter, activeUserIds);
  }

  if (segmentQuery.subscriptionFilter) await applySubscriptionFilter(filter, segmentQuery.subscriptionFilter);
  if (segmentQuery.reportFilter) await applyReportFilter(filter, segmentQuery.reportFilter);

  return filter;
}

export async function resolveAudienceUserIds(input: ResolveAudienceInput): Promise<Types.ObjectId[]> {
  // Anything that isn't "user_ids" or "segment" falls through to ALL users
  // below — so an external-list audience (which has no user ids at all) must
  // never be allowed to reach here, or it would silently resolve to every
  // user. Callers branch to externalContactService first; this is the backstop.
  if (input.audience === "external") throw new Error("An external-list audience has no user ids — resolve it with externalContactService instead.");
  if (input.audience === "user_ids") {
    return (input.userIds || []).map((id) => new Types.ObjectId(id));
  }
  const filter: FilterQuery<IUser> = input.audience === "segment" ? await segmentFilter(input.segmentQuery) : { staffRole: null, status: "active" };
  const users = await User.find(filter).select("_id").limit(MAX_AUDIENCE_SIZE).lean();
  return users.map((u) => u._id);
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email[0]}${"*".repeat(Math.max(1, at - 1))}${email.slice(at)}`;
}

export interface AudiencePreview {
  count: number;
  sample: { name: string; email: string }[];
}

// PII-masked, same convention as controllers/admin/usersController.ts's
// listUsers — a preview is a broad-audience glance, not the deliberate
// single-user lookup that getUserDetail's unmasked view already gates
// behind a specific action.
export async function previewAudience(input: ResolveAudienceInput): Promise<AudiencePreview> {
  const userIds = await resolveAudienceUserIds(input);
  const sampleUsers = await User.find({ _id: { $in: userIds.slice(0, 5) } })
    .select("name email")
    .lean();
  return {
    count: userIds.length,
    sample: sampleUsers.map((u) => ({ name: u.name, email: maskEmail(u.email) })),
  };
}

export interface ResolvedDelivery {
  channels: NotificationChannel[];
}

// A category with userOptOutAllowed:false ignores UserNotificationPref
// entirely — every active user gets it on every requested channel,
// regardless of any preference row (see NotificationCategory's own
// comment on why: account/subscription notices aren't optional).
export async function resolveDeliveryChannels(userId: Types.ObjectId, categoryKey: string, requestedChannels: NotificationChannel[]): Promise<ResolvedDelivery> {
  const category = await NotificationCategory.findOne({ key: categoryKey }).lean();
  if (!category || !category.userOptOutAllowed) {
    return { channels: requestedChannels };
  }
  const prefs = await UserNotificationPref.find({ userId, categoryKey, channel: { $in: requestedChannels } }).lean();
  const disabled = new Set(prefs.filter((p) => !p.enabled).map((p) => p.channel));
  return { channels: requestedChannels.filter((c) => !disabled.has(c)) };
}
