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

// "recurring" (default) — the discounted Razorpay Plan created for this
// redemption (subscriptionService.ts::startSubscription) stays the
// subscription's plan for its entire life, so every future auto-renewal is
// charged the discounted amount too. "once" — only the first charge is
// discounted, and this is ONLY possible in offer mode: it REQUIRES
// `razorpayOfferId` (a Razorpay-Dashboard Subscription Offer), because the old
// approach — switch the subscription back to the full-price plan after the first
// charge — was removed: Razorpay refuses plan changes on UPI subscriptions.
// Purely about how many of THIS subscription's own billing cycles get
// discounted; unrelated to `maxRedemptions`/`maxRedemptionsPerUser`, which govern
// how many different checkouts can use the code at all.
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
  // "Offer mode": the id (offer_xxx) of a Subscription Offer created in the
  // Razorpay Dashboard (offers can't be created by API). When set, checkout
  // subscribes to the normal catalog plan WITH this offer linked and Razorpay
  // itself applies the discount for however many cycles the offer is
  // configured for — no discounted one-off plan, and no plan switch after the
  // first charge (which Razorpay refuses for UPI subscriptions). The offer's
  // own settings (discount, cycles, validity) live in the Dashboard and must
  // match this coupon's `type`/`value`, which is only used to show the price.
  razorpayOfferId?: string;
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
    razorpayOfferId: { type: String },
    redeemedCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Coupon = model<ICoupon>("Coupon", couponSchema);
