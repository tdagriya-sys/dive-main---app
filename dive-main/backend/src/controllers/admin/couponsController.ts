import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createCouponSchema, updateCouponSchema } from "../../validators/subscription";
import * as couponService from "../../services/couponService";
import { ICoupon } from "../../models/Coupon";
import { recordAudit } from "../../services/auditLog";

/**
 * Coupon admin CRUD (Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3 — listed
 * there as "optional"). Gated by `plans.manage`, same permission as the
 * plan catalog itself — a coupon is a pricing-catalog concept, not a
 * per-subscription action, so it doesn't warrant a new permission constant
 * of its own.
 */

function serialize(c: ICoupon) {
  return {
    id: String(c._id),
    code: c.code,
    type: c.type,
    value: c.value,
    appliesToPlanKeys: c.appliesToPlanKeys,
    eligibility: c.eligibility,
    discountDuration: c.discountDuration,
    maxRedemptions: c.maxRedemptions,
    maxRedemptionsPerUser: c.maxRedemptionsPerUser,
    redeemedCount: c.redeemedCount,
    expiresAt: c.expiresAt,
    isActive: c.isActive,
  };
}

export async function listCoupons(_req: StaffRequest, res: Response) {
  const coupons = await couponService.listCoupons();
  res.status(200).json({ coupons: coupons.map(serialize) });
}

export async function createCoupon(req: StaffRequest, res: Response) {
  const data = createCouponSchema.parse(req.body);
  const coupon = await couponService.createCoupon(data);
  await recordAudit(
    { action: "coupon.created", resourceType: "Coupon", resourceId: String(coupon._id), meta: { code: coupon.code } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ coupon: serialize(coupon) });
}

export async function updateCoupon(req: StaffRequest, res: Response) {
  const data = updateCouponSchema.parse(req.body);
  const before = await couponService.listCoupons().then((all) => all.find((c) => String(c._id) === req.params.id));
  if (!before) throw new ApiError(404, "COUPON_NOT_FOUND", "Coupon not found.");
  const coupon = await couponService.updateCoupon(req.params.id, data);

  await recordAudit(
    { action: "coupon.updated", resourceType: "Coupon", resourceId: String(coupon._id), before: serialize(before), after: serialize(coupon) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ coupon: serialize(coupon) });
}
