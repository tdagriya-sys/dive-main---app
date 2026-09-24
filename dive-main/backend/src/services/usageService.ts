import { Response, NextFunction } from "express";
import { UsageEvent, UsageEventKey } from "../models/UsageEvent";
import { UsageGrant } from "../models/UsageGrant";
import { User } from "../models/User";
import { IPlanEntitlements } from "../models/SubscriptionPlan";
import { getPlan } from "./entitlementService";
import { getRedisClient } from "../lib/redisClient";
import { env } from "../config/env";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { emitActivity } from "./activityLog";

/**
 * Rolling-window usage metering + enforcement (Phase 6a of
 * docs/ADMIN_PANEL_PLAN.md §3.4). Deliberately NOT calendar-aligned —
 * "resets" is just "whenever the oldest counted event ages past the
 * window", computed on read, never a stored reset timestamp.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function recordUsageEvent(userId: string, key: UsageEventKey): Promise<void> {
  await UsageEvent.create({ userId, key });
}

export async function countUsageInWindow(userId: string, key: UsageEventKey, windowMs: number): Promise<number> {
  return UsageEvent.countDocuments({ userId, key, ts: { $gte: new Date(Date.now() - windowMs) } });
}

interface LimitPair {
  weekly: number | null;
  monthly: number | null;
}

const LIMIT_FIELDS: Record<UsageEventKey, { weekly: string; monthly: string }> = {
  bot_scan: { weekly: "botScanWeekly", monthly: "botScanMonthly" },
  doc_upload: { weekly: "docUploadWeekly", monthly: "docUploadMonthly" },
  portfolio_edit: { weekly: "portfolioEditWeekly", monthly: "portfolioEditMonthly" },
};

// Overlays every standing admin-granted bonus (UsageGrant — see its own
// model comment) onto a plan's raw entitlements — the one place that
// computes "what can this user ACTUALLY do right now", shared by the
// enforcement path (getLimits, per key) and GET /me/entitlements (the
// Subscription screen's usage-vs-limit table — a grant that isn't reflected
// there would be invisible to the very user it was granted to). `null`
// (unlimited) is left exactly as-is: adding a finite bonus to "unlimited"
// is a no-op, and granting "extra" on an already-unlimited key has nothing
// to add to.
export async function applyUsageGrants(userId: string, entitlements: IPlanEntitlements): Promise<IPlanEntitlements> {
  const grants = await UsageGrant.find({ userId }).lean();
  if (grants.length === 0) return entitlements;
  // Never spread `entitlements` directly — the caller's `entitlements` can
  // be a LIVE Mongoose subdocument (entitlementService.ts::getPlan reads
  // `subscription.planId.entitlements` off a populated, non-`.lean()`
  // Subscription for any actual subscriber — only the Freemium fallback
  // path uses `.lean()`). `{...mongooseSubdocument}` does not produce a
  // clean plain object: it also copies Mongoose's own internal bookkeeping
  // properties (`$__`, `$__parent`, `_doc`, `$isNew`, ...) as if they were
  // ordinary data fields, and the touched schema paths end up wrong —
  // confirmed live: granting a single key's bonus to any real subscriber
  // turned that key's OWN value into `null` (not even the un-bonused
  // original) and polluted the JSON response sent to the frontend with
  // Mongoose internals, which is what made the usage screen show
  // "Unlimited" everywhere after any grant, on any subscribed plan.
  // Building the result field-by-field sidesteps this regardless of
  // whether `entitlements` is a plain object or a live document, since a
  // direct property read always resolves through the correct getter.
  const result: IPlanEntitlements = {
    botScanWeekly: entitlements.botScanWeekly,
    botScanMonthly: entitlements.botScanMonthly,
    docUploadWeekly: entitlements.docUploadWeekly,
    docUploadMonthly: entitlements.docUploadMonthly,
    portfolioEditWeekly: entitlements.portfolioEditWeekly,
    portfolioEditMonthly: entitlements.portfolioEditMonthly,
    dailyRevaluation: entitlements.dailyRevaluation,
    earlyAccess: entitlements.earlyAccess,
    priorityWeight: entitlements.priorityWeight,
    complimentaryReportDownloads: entitlements.complimentaryReportDownloads,
  };
  for (const grant of grants) {
    // "score_report" grants aren't a weekly/monthly entitlement field at
    // all — they're handled separately by paymentService.ts::
    // ensureReportAccess, nothing to overlay onto here.
    if (grant.key === "score_report") continue;
    const fields = LIMIT_FIELDS[grant.key];
    const weeklyKey = fields.weekly as keyof IPlanEntitlements;
    const monthlyKey = fields.monthly as keyof IPlanEntitlements;
    const baseWeekly = result[weeklyKey] as number | null;
    const baseMonthly = result[monthlyKey] as number | null;
    if (baseWeekly !== null) (result[weeklyKey] as number) = baseWeekly + grant.bonusWeekly;
    if (baseMonthly !== null) (result[monthlyKey] as number) = baseMonthly + grant.bonusMonthly;
  }
  return result;
}

async function getLimits(userId: string, key: UsageEventKey): Promise<LimitPair> {
  const [{ entitlements }, grant] = await Promise.all([getPlan(userId), UsageGrant.findOne({ userId, key }).lean()]);
  const fields = LIMIT_FIELDS[key];
  const baseWeekly = entitlements[fields.weekly as keyof typeof entitlements] as number | null;
  const baseMonthly = entitlements[fields.monthly as keyof typeof entitlements] as number | null;
  return {
    weekly: baseWeekly === null ? null : baseWeekly + (grant?.bonusWeekly ?? 0),
    monthly: baseMonthly === null ? null : baseMonthly + (grant?.bonusMonthly ?? 0),
  };
}

interface LimitCheckResult {
  blocked: boolean;
  window?: "weekly" | "monthly";
  limit?: number;
  resetsAt?: Date;
}

// Checks both windows — "whichever is reached first blocks" (§3.4). Also
// returns when the block will lift: the oldest event inside the BLOCKING
// window ages out `windowMs` after it was recorded.
async function checkLimits(userId: string, key: UsageEventKey, limits: LimitPair): Promise<LimitCheckResult> {
  for (const [window, windowMs, limit] of [
    ["weekly", WEEK_MS, limits.weekly],
    ["monthly", MONTH_MS, limits.monthly],
  ] as const) {
    if (limit === null || limit === undefined) continue;
    const count = await countUsageInWindow(userId, key, windowMs);
    if (count >= limit) {
      const oldest = await UsageEvent.findOne({ userId, key, ts: { $gte: new Date(Date.now() - windowMs) } }).sort({ ts: 1 }).lean();
      const resetsAt = oldest ? new Date(oldest.ts.getTime() + windowMs) : new Date(Date.now() + windowMs);
      return { blocked: true, window, limit, resetsAt };
    }
  }
  return { blocked: false };
}

function planLimitResponse(res: Response, key: UsageEventKey, check: LimitCheckResult) {
  return res.status(403).json({
    error: "PLAN_LIMIT_REACHED",
    message: "You've reached your plan's limit for this feature. Upgrade to Premium for more.",
    key,
    window: check.window,
    limit: check.limit,
    resetsAt: check.resetsAt,
    upgradeUrl: "/subscription",
  });
}

// Ad-hoc (non-middleware) form for a controller that only sometimes needs
// metering — uploadController.ts's doc_upload limit applies to the AI
// (PDF/image) extraction branch only, per §3.1/§3.2's own wording ("Doc
// Upload AI extraction"), NOT to plain CSV/XLSX/JSON parsing (deterministic,
// no AI call), so it can't be a blanket route-level middleware the way
// bot_scan's `enforceEditSessionUsage` below is — every request to that
// route IS an AI call. Throws PLAN_LIMIT_REACHED (as an ApiError, same
// shape errorHandler.ts already knows how to serialize) if blocked;
// otherwise the caller is expected to call `recordUsageEvent` itself once
// the action succeeds.
export async function assertUsageAllowed(userId: string, key: UsageEventKey): Promise<void> {
  const limits = await getLimits(userId, key);
  const check = await checkLimits(userId, key, limits);
  if (check.blocked) {
    throw new ApiError(403, "PLAN_LIMIT_REACHED", "You've reached your plan's limit for this feature. Upgrade to Premium for more.");
  }
}

// --- Edit-session coalescing (portfolio_edit, bot_scan — §3.4) ---
//
// A burst of mutations/calls for the SAME key within EDIT_SESSION_WINDOW_MIN
// of each other counts as ONE metered use: the first call "opens" a session
// (checked against the limit, one UsageEvent recorded); every subsequent
// call for that key while the session is still open just refreshes its TTL,
// free. Originally portfolio_edit-only; generalized to also cover bot_scan,
// whose frontend polls POST /botscan/analyze roughly every 1.8s for the
// duration of one scan — without coalescing, a Freemium user's weekly bot
// scan limit (as low as 1) could exhaust itself on the SECOND captured
// frame of their first-ever scan. Each key gets its own independent session
// (and therefore its own independent quota consumption), never shared with
// another key. Redis-only — with no Redis configured (dev machines, the
// test suite), this FAILS OPEN (never blocks, never even records usage)
// rather than mis-metering in the restrictive direction, matching every
// other Redis consumer in this codebase (distributedLock, rate-limit-redis)
// that degrades gracefully without it.
function editSessionKey(userId: string, key: UsageEventKey): string {
  return `edit-session:${key}:${userId}`;
}

export function enforceEditSessionUsage(key: UsageEventKey) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const redis = getRedisClient();
    if (!redis) return next(); // fail open — see comment above

    const redisKey = editSessionKey(req.userId!, key);
    const ttlSeconds = env.editSessionWindowMin * 60;
    const alreadyOpen = await redis.exists(redisKey);

    if (alreadyOpen) {
      await redis.expire(redisKey, ttlSeconds); // sliding TTL — refresh, don't recount
      return next();
    }

    // A brand-new user's very first-ever portfolio_edit session (building
    // their initial portfolio, before they've ever reached Home to see a
    // real score) is deliberately free — the plan limit only starts
    // counting from their SECOND session onward. Still opens a real session
    // below (so a burst of holdings during this first build coalesces
    // exactly as normal, free or not) but skips the limit check/record, and
    // flips the flag immediately so a session opened moments later — even
    // before this one closes — is never exempted twice.
    let firstEverPortfolioEdit = false;
    if (key === "portfolio_edit") {
      const user = await User.findOne({ _id: req.userId }).select("hasCompletedFirstPortfolioEdit");
      if (user && !user.hasCompletedFirstPortfolioEdit) {
        firstEverPortfolioEdit = true;
        user.hasCompletedFirstPortfolioEdit = true;
        await user.save();
      }
    }

    if (!firstEverPortfolioEdit) {
      const limits = await getLimits(req.userId!, key);
      const check = await checkLimits(req.userId!, key, limits);
      if (check.blocked) {
        emitActivity("plan_limit_reached", { userId: req.userId, req, props: { key, window: check.window } });
        planLimitResponse(res, key, check);
        return;
      }
    }

    await redis.set(redisKey, "1", "EX", ttlSeconds);
    res.on("finish", () => {
      if (res.statusCode < 400) {
        if (firstEverPortfolioEdit) return; // exempt — see comment above, never metered
        recordUsageEvent(req.userId!, key).catch(() => undefined);
      } else {
        // The call itself failed — don't leave a "session" open (and thus
        // silently exempt from the limit check) for a use that never
        // actually happened.
        redis.del(redisKey).catch(() => undefined);
      }
    });
    next();
  };
}

const SESSION_KEYS: UsageEventKey[] = ["portfolio_edit", "bot_scan"];

// POST /api/usage/close-edit-sessions — an explicit "done for this trip"
// signal from the client (fired on reaching Home, see DiveContext.js) so a
// short burst of edits/scans doesn't keep either session (and therefore the
// free-mutation window) open for the full 20 minutes by default. Closes
// every session-based key at once — doc_upload has no session to close (see
// this file's own comment on assertUsageAllowed). Best-effort: closing
// early is a courtesy, not a correctness requirement — the TTL expires each
// session anyway if this is never called.
export async function closeAllEditSessions(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  await Promise.all(SESSION_KEYS.map((key) => redis.del(editSessionKey(userId, key))));
}
