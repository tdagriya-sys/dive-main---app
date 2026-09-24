import { Schema, model, Document } from "mongoose";

export type CouponType = "percent" | "flat";

// Who's allowed to redeem, on top of (not instead of) appliesToPlanKeys —
// an orthogonal restriction (couponService.ts::validateCoupon checks both):
// "any" — no restriction beyond plan/expiry/redemption-cap.
// "new_user" — the account must have been created within the last 7 days.
// "first_time" — the user must never have had ANY Subscription row before
//   (trial, paid or comp — a genuinely first-ever premium purchase).
// "renewal" — the inverse of first_time: the user must already have at
//   least one past Subscription row (a returning/renewing subscriber).
export type CouponEligibility = "any" | "new_user" | "first_time" | "renewal";

// "recurring" (default, and the ONLY behavior that existed before this
// field) — the discounted Razorpay Plan created for this redemption
// (subscriptionService.ts::startSubscription) stays the subscription's
// plan for its entire life, so every future auto-renewal is charged the
// discounted amount too. "once" — the subscription is switched back to the
// catalog plan's full price starting the NEXT billing cycle, the moment its
// first (already-discounted) charge succeeds — see subscriptionService.ts::
// revertToFullPriceIfOneTimeCoupon. Purely about how many of THIS
// subscription's own billing cycles get discounted; unrelated to
// `maxRedemptions`/`maxRedemptionsPerUser`, which govern how many different
// checkouts can use the code at all.
export type CouponDiscountDuration = "once" | "recurring";

/**
 * A discount code (Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3, listed there as
 * "optional"). `code` is the redemption key a user types on the Subscribe
 * screen — always stored/matched uppercase (see couponService.ts) so
 * "SAVE20"/"save20" are the same coupon.
 *
 * `redeemedCount` is only ever incremented atomically inside
 * couponService.ts::redeemCoupon (a single `findOneAndUpdate` guarded by the
 * same query's own `maxRedemptions` check), never by a plain `.save()` after
 * a separate read — two concurrent redemptions of the very last slot must
 * not both succeed.
 */
export interface ICoupon extends Document {
  code: string;
  type: CouponType;
  value: number; // percent: 1-100; flat: paise
  appliesToPlanKeys: string[]; // empty = every paid plan
  eligibility: CouponEligibility;
  maxRedemptions?: number; // undefined = unlimited, total across every user
  maxRedemptionsPerUser?: number; // undefined = unlimited per user — independent of maxRedemptions; see models/CouponRedemption.ts for the per-user counter this is checked against
  discountDuration: CouponDiscountDuration;
  redeemedCount: number;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percent", "flat"], required: true },
    value: { type: Number, required: true, min: 1 },
    appliesToPlanKeys: { type: [String], default: [] },
    eligibility: { type: String, enum: ["any", "new_user", "first_time", "renewal"], default: "any" },
    maxRedemptions: { type: Number },
    maxRedemptionsPerUser: { type: Number },
    discountDuration: { type: String, enum: ["once", "recurring"], default: "recurring" },
    redeemedCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Coupon = model<ICoupon>("Coupon", couponSchema);
