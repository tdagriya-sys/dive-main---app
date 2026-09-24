import { Schema, model, Document, Types } from "mongoose";

/**
 * A per-(coupon, user) redemption counter — backs `Coupon.maxRedemptionsPerUser`
 * (couponService.ts §"per-user limit"), independent of `Coupon.redeemedCount`
 * (the total-across-everyone counter, unchanged). One row per user who has
 * ever redeemed a given coupon; `count` only ever moves via
 * couponService.ts::redeemCoupon's atomic guarded update, same
 * never-read-then-write convention `Coupon.redeemedCount` already uses — two
 * concurrent redemptions of a user's very last per-user slot must not both
 * succeed.
 */
export interface ICouponRedemption extends Document {
  couponId: Types.ObjectId;
  userId: Types.ObjectId;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const couponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);
couponRedemptionSchema.index({ couponId: 1, userId: 1 }, { unique: true });

export const CouponRedemption = model<ICouponRedemption>("CouponRedemption", couponRedemptionSchema);
