import { Response } from "express";
import { FilterQuery } from "mongoose";
import { User, IUser } from "../../models/User";
import { Holding } from "../../models/Holding";
import { Payment } from "../../models/Payment";
import { ActivityEvent } from "../../models/ActivityEvent";
import { AuditLog } from "../../models/AuditLog";
import { RefreshToken } from "../../models/RefreshToken";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { computeDiveScoreBreakdown } from "../../services/diveScoreService";
import { signImpersonationToken } from "../../utils/jwt";
import { publicUser } from "../../utils/publicUser";
import { recordAudit } from "../../services/auditLog";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Partial masking for the LIST view only (docs/ADMIN_PANEL_PLAN.md §8 — "PII
// masking by default in lists"). The detail view (getUserDetail) shows the
// real values — reaching a specific user's record is already a deliberate,
// audited-by-access-log action, unlike scrolling a list of everyone.
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email; // too short to usefully mask
  return `${email[0]}${"*".repeat(Math.max(1, at - 1))}${email.slice(at)}`;
}
function maskMobile(mobile: string): string {
  if (mobile.length <= 2) return mobile;
  return `${"*".repeat(mobile.length - 2)}${mobile.slice(-2)}`;
}

export async function listUsers(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const filter: FilterQuery<IUser> = { staffRole: null };
  if (status) filter.status = status;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { email: re }, { mobile: re }];
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("name email mobile age status createdAt portfolioVersion")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json({
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: maskEmail(u.email),
      mobile: maskMobile(u.mobile),
      age: u.age,
      status: u.status,
      createdAt: u.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function getUserDetail(req: StaffRequest, res: Response) {
  const user = await User.findOne({ _id: req.params.id, staffRole: null }).lean();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  const userId = String(user._id);
  const [holdings, payments, activity, liveSessionCount, auditEntries, scoreBreakdown] = await Promise.all([
    Holding.find({ userId }).select("assetClass currentValue investedValue").lean(),
    Payment.find({ userId }).sort({ createdAt: -1 }).limit(20).lean(),
    ActivityEvent.find({ userId }).sort({ ts: -1 }).limit(20).lean(),
    RefreshToken.countDocuments({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }),
    AuditLog.find({ resourceType: "User", resourceId: userId }).sort({ ts: -1 }).limit(20).lean(),
    computeDiveScoreBreakdown(userId).catch(() => null), // never let a scoring hiccup break the whole detail view
  ]);

  const holdingsByClass = new Map<string, { count: number; value: number }>();
  let totalValue = 0;
  for (const h of holdings) {
    totalValue += h.currentValue || 0;
    const entry = holdingsByClass.get(h.assetClass) || { count: 0, value: 0 };
    entry.count += 1;
    entry.value += h.currentValue || 0;
    holdingsByClass.set(h.assetClass, entry);
  }

  res.status(200).json({
    user: {
      id: userId,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      age: user.age,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      preferences: user.preferences,
      portfolioVersion: user.portfolioVersion,
    },
    holdings: {
      count: holdings.length,
      totalValue,
      byAssetClass: Object.fromEntries(holdingsByClass),
    },
    score: scoreBreakdown
      ? { compositeScore: scoreBreakdown.compositeScore, hasHoldings: scoreBreakdown.hasHoldings }
      : null,
    payments: payments.map((p) => ({
      id: String(p._id),
      purpose: p.purpose,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      isMock: p.isMock,
      createdAt: p.createdAt,
    })),
    activity: activity.map((a) => ({ type: a.type, props: a.props, ts: a.ts })),
    liveSessionCount,
    auditEntries: auditEntries.map((a) => ({
      action: a.action,
      actorLabel: a.actorLabel,
      diff: a.diff,
      ts: a.ts,
    })),
  });
}

// Read-only impersonation (Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8,
// spec'd since Phase 1 but never built until now). The returned token can
// only ever read — middleware/auth.ts::requireAuth rejects any mutating
// request it's presented with, centrally, before reaching any controller —
// so there's nothing further to audit once the session starts: no write
// ever happens under it to produce a diff.
export async function impersonateUser(req: StaffRequest, res: Response) {
  const target = await User.findOne({ _id: req.params.id, staffRole: null });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  const { token, expiresAt } = signImpersonationToken(String(target._id), req.staff!.userId);
  await recordAudit(
    { action: "user.impersonation_started", resourceType: "User", resourceId: String(target._id), meta: { expiresAt } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email, impersonatingUserId: String(target._id) },
    req
  );
  res.status(200).json({ accessToken: token, expiresAt, user: publicUser(target) });
}

// Revokes every still-live refresh token for a user — the ONLY thing that
// actually ends an already-issued session immediately. Their current access
// token (up to jwtAccessTtl, default 15m) keeps working until it naturally
// expires, at which point the next /auth/refresh attempt hits the revoked
// row and fails — see authController.ts::refresh's single-use-rotation
// check, which already treats a revoked token as a dead session.
async function revokeAllSessions(userId: string): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

// User suspend / reactivate / force-logout (docs/ADMIN_PANEL_PLAN.md §4.1/
// §5.3/§6 — `User.status` and the `users.suspend` permission have existed
// since Phase 0.3, but no admin action ever actually used them until now).
// Both suspend and force-logout revoke sessions — suspending alone would be
// cosmetic for up to 15 minutes otherwise (see authController.ts::login's
// own `status !== "active"` check, which only runs at the NEXT login, and
// refresh()'s matching check added alongside this).
export async function suspendUser(req: StaffRequest, res: Response) {
  const target = await User.findOne({ _id: req.params.id, staffRole: null });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  if (target.status === "suspended") throw new ApiError(400, "ALREADY_SUSPENDED", "This account is already suspended.");

  target.status = "suspended";
  await target.save();
  await revokeAllSessions(String(target._id));
  await recordAudit(
    { action: "user.suspended", resourceType: "User", resourceId: String(target._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ status: target.status });
}

export async function reactivateUser(req: StaffRequest, res: Response) {
  const target = await User.findOne({ _id: req.params.id, staffRole: null });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  if (target.status !== "suspended") throw new ApiError(400, "NOT_SUSPENDED", "This account isn't suspended.");

  target.status = "active";
  await target.save();
  await recordAudit(
    { action: "user.reactivated", resourceType: "User", resourceId: String(target._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ status: target.status });
}

export async function forceLogoutUser(req: StaffRequest, res: Response) {
  const target = await User.findOne({ _id: req.params.id, staffRole: null }).select("_id");
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  await revokeAllSessions(String(target._id));
  await recordAudit(
    { action: "user.force_logged_out", resourceType: "User", resourceId: String(target._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ ok: true });
}

// Deliberate override of the one-time-ever trial guard (hasUsedTrial —
// see User.ts's own comment) — a goodwill/support gesture, same posture as
// grantComplimentarySubscription. Step-up gated (admin.routes.ts) since it
// directly re-grants something the product otherwise treats as spent.
export async function resetUserTrial(req: StaffRequest, res: Response) {
  const target = await User.findOne({ _id: req.params.id, staffRole: null }).select("_id hasUsedTrial trialForfeitedWithoutClaim");
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  target.hasUsedTrial = false;
  target.trialForfeitedWithoutClaim = false;
  await target.save();
  await recordAudit(
    { action: "user.trial_reset", resourceType: "User", resourceId: String(target._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ hasUsedTrial: target.hasUsedTrial });
}
