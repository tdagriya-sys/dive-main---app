import { Coupon, ICoupon, CouponType, CouponEligibility, CouponDiscountDuration } from "../models/Coupon";
import { CouponRedemption } from "../models/CouponRedemption";
import { ApiError } from "../middleware/errorHandler";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";

const NEW_USER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Discount codes (Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3, listed there as
 * "optional"). Scoped deliberately: this Razorpay SDK version (`razorpay`
 * npm package, checked directly — no `.offers` resource exposed) has no way
 * to attach an ad-hoc percent/flat discount to a live Subscriptions API call,
 * so a real discount is applied by having `subscriptionService.ts::
 * startSubscription` create a genuinely-discounted, one-off Razorpay Plan for
 * that redemption (via the same `plans.create` call `publishPlanToRazorpay`
 * already uses) and subscribing to THAT instead of the catalog plan's own
 * `razorpayPlanId`. By default (`discountDuration: "recurring"`) the user is
 * billed the discounted amount every cycle for as long as that subscription
 * lives; `discountDuration: "once"` instead schedules the subscription back
 * onto the catalog plan's full price starting the NEXT cycle, the moment its
 * first (discounted) charge succeeds — see subscriptionService.ts::
 * revertToFullPriceIfOneTimeCoupon. The local `Subscription.planId` always
 * points at the real catalog plan (premium_monthly/premium_annual) for
 * entitlements either way — only the Razorpay-side plan object differs.
 */

export async function createCoupon(input: { code: string; type: CouponType; value: number; appliesToPlanKeys?: string[]; eligibility?: CouponEligibility; discountDuration?: CouponDiscountDuration; maxRedemptions?: number; maxRedemptionsPerUser?: number; expiresAt?: Date }): Promise<ICoupon> {
  const code = input.code.trim().toUpperCase();
  const existing = await Coupon.findOne({ code }).lean();
  if (existing) throw new ApiError(409, "COUPON_CODE_TAKEN", "A coupon with this code already exists.");
  if (input.type === "percent" && (input.value < 1 || input.value > 100)) {
    throw new ApiError(400, "INVALID_COUPON_VALUE", "A percent coupon must be between 1 and 100.");
  }
  return Coupon.create({ ...input, code });
}

export async function updateCoupon(
  id: string,
  input: { appliesToPlanKeys?: string[]; eligibility?: CouponEligibility; discountDuration?: CouponDiscountDuration; maxRedemptions?: number; maxRedemptionsPerUser?: number; expiresAt?: Date | null; isActive?: boolean }
): Promise<ICoupon> {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw new ApiError(404, "COUPON_NOT_FOUND", "Coupon not found.");
  if (input.appliesToPlanKeys !== undefined) coupon.appliesToPlanKeys = input.appliesToPlanKeys;
  if (input.eligibility !== undefined) coupon.eligibility = input.eligibility;
  if (input.discountDuration !== undefined) coupon.discountDuration = input.discountDuration;
  if (input.maxRedemptions !== undefined) coupon.maxRedemptions = input.maxRedemptions;
  if (input.maxRedemptionsPerUser !== undefined) coupon.maxRedemptionsPerUser = input.maxRedemptionsPerUser;
  if (input.expiresAt !== undefined) coupon.expiresAt = input.expiresAt ?? undefined;
  if (input.isActive !== undefined) coupon.isActive = input.isActive;
  await coupon.save();
  return coupon;
}

export async function listCoupons(): Promise<ICoupon[]> {
  return Coupon.find({}).sort({ createdAt: -1 }).lean() as unknown as Promise<ICoupon[]>;
}

// Validates a code against a specific plan WITHOUT redeeming it — used both
// by the user-facing "preview my discount" check before checkout and as the
// first half of the real redemption in startSubscription. `userId` is
// required for the eligibility check below — every call site already has an
// authenticated user in hand (this endpoint/flow never runs anonymously).
export async function validateCoupon(code: string, planKey: string, userId: string): Promise<ICoupon> {
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (!coupon || !coupon.isActive) throw new ApiError(404, "COUPON_INVALID", "This coupon code isn't valid.");
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new ApiError(400, "COUPON_EXPIRED", "This coupon has expired.");
  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) {
    throw new ApiError(400, "COUPON_LIMIT_REACHED", "This coupon has already been fully redeemed.");
  }
  if (coupon.appliesToPlanKeys.length > 0 && !coupon.appliesToPlanKeys.includes(planKey)) {
    throw new ApiError(400, "COUPON_NOT_APPLICABLE", "This coupon doesn't apply to this plan.");
  }
  if (coupon.eligibility !== "any" && !(await isEligible(coupon.eligibility, userId))) {
    throw new ApiError(400, "COUPON_NOT_ELIGIBLE", couponEligibilityMessage(coupon.eligibility));
  }
  if (coupon.maxRedemptionsPerUser !== undefined) {
    const existing = await CouponRedemption.findOne({ couponId: coupon._id, userId }).lean();
    if (existing && existing.count >= coupon.maxRedemptionsPerUser) {
      throw new ApiError(400, "COUPON_USER_LIMIT_REACHED", "You've already used this coupon the maximum number of times.");
    }
  }
  return coupon;
}

function couponEligibilityMessage(eligibility: CouponEligibility): string {
  if (eligibility === "new_user") return "This coupon is only for accounts created within the last 7 days.";
  if (eligibility === "first_time") return "This coupon is only for first-time subscribers.";
  return "This coupon is only for renewing subscribers.";
}

async function isEligible(eligibility: CouponEligibility, userId: string): Promise<boolean> {
  if (eligibility === "new_user") {
    const user = await User.findById(userId).select("createdAt").lean();
    return !!user && Date.now() - new Date(user.createdAt).getTime() <= NEW_USER_WINDOW_MS;
  }
  const hadAnySubscription = await Subscription.exists({ userId });
  if (eligibility === "first_time") return !hadAnySubscription;
  // "renewal"
  return !!hadAnySubscription;
}

export function computeDiscountedPricePaise(pricePaise: number, coupon: ICoupon): number {
  const discount = coupon.type === "percent" ? Math.round((pricePaise * coupon.value) / 100) : coupon.value;
  return Math.max(0, pricePaise - discount);
}

// Bumps this user's own per-(coupon,user) counter, atomically guarded by
// `maxRedemptionsPerUser` (if set) — mirrors the total-cap guard below, just
// scoped to one user's own CouponRedemption row instead of the Coupon
// document itself. No cap at all means "just keep counting, never refuse."
// Returns true if the bump was allowed (and applied), false if the per-user
// cap was already reached (nothing was changed).
async function bumpPerUserRedemption(couponId: string, userId: string, cap: number | undefined): Promise<boolean> {
  const guard = cap === undefined ? {} : { count: { $lt: cap } };
  const bumped = await CouponRedemption.findOneAndUpdate({ couponId, userId, ...guard }, { $inc: { count: 1 } }, { new: true });
  if (bumped) return true;

  // No existing row matched the guard — either this user has never
  // redeemed this coupon before (safe to create a fresh count:1 row), or
  // (when a cap is set) their existing row is already exactly at it, in
  // which case the unique index below refuses this insert with a
  // duplicate-key error, treated as "at cap."
  try {
    await CouponRedemption.create({ couponId, userId, count: 1 });
    return cap === undefined || cap > 0;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    if (cap !== undefined) return false; // a real cap was already reached
    // No cap at all — this duplicate key means another concurrent call
    // created the row a moment ago (a create-race, not a limit), so the
    // row now exists; just retry the bump against it.
    const retried = await CouponRedemption.findOneAndUpdate({ couponId, userId }, { $inc: { count: 1 } }, { new: true });
    return !!retried;
  }
}

// Atomic: only succeeds if BOTH the total cap and this user's own per-user
// cap (whichever are set) haven't been reached at the moment of the
// increment, closing the race two simultaneous checkouts on the very last
// slot would otherwise hit if this were a separate read-then-write. Checks
// the per-user cap first (cheaper, more specific error for the caller), then
// the total cap — if the total cap turns out to already be exhausted, the
// per-user bump just made is rolled back so it doesn't count against a
// redemption that never actually completed. Returns the updated coupon, or
// null if either guard failed (caller should treat this like
// COUPON_LIMIT_REACHED / COUPON_USER_LIMIT_REACHED).
export async function redeemCoupon(couponId: string, userId: string): Promise<ICoupon | null> {
  const coupon = await Coupon.findById(couponId).select("maxRedemptionsPerUser").lean();
  if (!coupon) return null;

  const perUserOk = await bumpPerUserRedemption(couponId, userId, coupon.maxRedemptionsPerUser);
  if (!perUserOk) return null;

  const updated = await Coupon.findOneAndUpdate(
    { _id: couponId, $or: [{ maxRedemptions: { $exists: false } }, { $expr: { $lt: ["$redeemedCount", "$maxRedemptions"] } }] },
    { $inc: { redeemedCount: 1 } },
    { new: true }
  );
  if (!updated) {
    await CouponRedemption.updateOne({ couponId, userId }, { $inc: { count: -1 } });
    return null;
  }
  return updated;
}
