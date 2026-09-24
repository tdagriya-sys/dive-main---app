import { Schema, model, Document, Types } from "mongoose";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";

/**
 * A user's subscription to a `SubscriptionPlan` (Phase 6a of
 * docs/ADMIN_PANEL_PLAN.md §4.3). Deliberately no row at all is how
 * "Freemium" is represented — `entitlementService.ts::getPlan` falls back
 * to the built-in Freemium plan whenever a user has no
 * `trialing`/`active`/`past_due` row, so every pre-existing account is
 * Freemium the instant this collection exists, with no migration script
 * needed (see this phase's own changelog entry).
 */
export interface ISubscription extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  cancelAtPeriodEnd: boolean;
  // Stamped the moment Razorpay is actually told to stop auto-renewing this
  // subscription — either jobs/subscriptionCancelNotice.cron.ts's daily
  // sweep (the default path) or an explicit immediate-notify cancel (see
  // subscriptionService.ts::cancelSubscriptionDoc). Undefined/null means
  // Razorpay hasn't been told yet, so `cancelAtPeriodEnd` is still purely
  // local and reactivateSubscription can freely undo it; once set, Razorpay
  // has no endpoint to undo the schedule, so reactivate must honestly refuse
  // instead of pretending it can restore auto-billing.
  razorpayCancelRequestedAt?: Date | null;
  startedAt: Date;
  endedAt?: Date;
  lastPaymentId?: Types.ObjectId;
  // Phase 6b — the coupon redeemed at subscribe time, if any (see
  // couponService.ts/subscriptionService.ts::startSubscription). Purely a
  // record of what was applied; the discount itself is already baked into
  // whatever `Payment.amount` was actually charged, which is what every
  // invoice/revenue number derives from — this field is for admin visibility
  // and audit, never re-read to compute a price.
  couponCode?: string;
  // Stamped once subscriptionService.ts::revertToFullPriceIfOneTimeCoupon has
  // actually told Razorpay to switch this subscription back to the catalog
  // plan's full price starting the next cycle — only relevant when
  // `couponCode` redeemed a `discountDuration: "once"` coupon. Undefined
  // means either no coupon, a "recurring" coupon (nothing to revert, ever),
  // or a "once" coupon whose first charge hasn't been processed yet.
  couponOnceRevertScheduledAt?: Date | null;
  // Set once at creation (upsertLocalSubscription) to the trial length this
  // SPECIFIC subscription instance actually granted, if any. A durable
  // per-instance record, deliberately independent of the plan's CURRENT
  // trialDays (an admin can change that later) and of `status` (which moves
  // on once the trial period ends) — this is what the admin "who has used a
  // trial" list and a user's subscription history both query, rather than
  // trying to infer "was this a trial" after the fact.
  trialDaysGranted?: number;
  // Which of the admin-configured reminder thresholds (e.g. [7, 3, 0] days
  // before currentPeriodEnd — see jobs/renewalReminder.cron.ts) have already
  // fired for the CURRENT billing period. `renewalReminderPeriodEnd` records
  // which `currentPeriodEnd` that list applies to — the moment a real
  // renewal or reactivation moves `currentPeriodEnd` forward, the sweep sees
  // the mismatch and resets `renewalRemindersSentDays` to `[]`, so every
  // threshold is eligible again next cycle with no separate reset step.
  renewalReminderPeriodEnd?: Date | null;
  renewalRemindersSentDays?: number[];
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
    status: { type: String, enum: ["trialing", "active", "past_due", "cancelled", "expired"], required: true, index: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    razorpaySubscriptionId: { type: String, index: true },
    razorpayCustomerId: { type: String },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    razorpayCancelRequestedAt: { type: Date },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    lastPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    couponCode: { type: String },
    couponOnceRevertScheduledAt: { type: Date },
    trialDaysGranted: { type: Number },
    renewalReminderPeriodEnd: { type: Date },
    renewalRemindersSentDays: { type: [Number] },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });

export const Subscription = model<ISubscription>("Subscription", subscriptionSchema);
