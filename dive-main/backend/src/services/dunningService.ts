import Razorpay from "razorpay";
import { Types } from "mongoose";
import { env } from "../config/env";
import { Subscription, ISubscription } from "../models/Subscription";
import { User } from "../models/User";
import { UserNotification } from "../models/UserNotification";
import { IHighlightStyle } from "../models/NotificationCategory";
import { resolveDeliveryChannels } from "./notificationAudienceService";
import { buildNotificationHtml, buildInAppNotificationHtml, sendNotificationEmail } from "./notificationEmailService";
import { emitActivity } from "./activityLog";
import { logger } from "../lib/logger";

/**
 * Dunning / past-due flow (Phase 6b of docs/ADMIN_PANEL_PLAN.md §9's "6b"
 * row). `past_due` itself is set by subscriptionService.ts's webhook handler
 * (`subscription.halted` / `payment.failed`) — this file owns what happens
 * AFTER that: a one-off notice the moment it happens, and an automatic
 * cancellation once `env.dunningGraceDays` has passed with no successful
 * retry. Deliberately its own tiny Razorpay client (mirroring paymentService
 * .ts's and subscriptionService.ts's own private `getClient()`, each kept
 * separate rather than sharing one module) rather than importing from
 * subscriptionService.ts, which would create a subscriptionService ⇄
 * dunningService import cycle (subscriptionService calls sendPastDueNotice
 * the moment a subscription first goes past_due).
 */

let razorpayClient: Razorpay | null = null;
function getClient(): Razorpay {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return razorpayClient;
}

const CATEGORY_KEY = "subscription";

// Exported for reuse by subscriptionService.ts::runRenewalReminderSweep —
// the only other place a subscription notice needs the exact same
// category/channel-resolution/in-app+email delivery as dunning does. Safe to
// import there (no cycle): this file already deliberately avoids importing
// FROM subscriptionService.ts (see the module comment above), and
// subscriptionService.ts already imports sendPastDueNotice from here.
//
// `opts.popup` additionally requests the one-time popup-card channel
// (frontend/src/components/NotificationPopupCard.jsx) — every dunning call
// site below omits it (a past-due/cancellation notice is deliberately
// bell+email only), so only the renewal-reminder sweep's own admin toggle
// (AdminSetting.ts::IRenewalReminderValue.enablePopup) ever sets it. Since
// the "subscription" category has `userOptOutAllowed: false`,
// `resolveDeliveryChannels` returns whatever's requested verbatim — that
// admin toggle is the only thing gating popup delivery here.
export async function notifyUser(userId: Types.ObjectId, title: string, body: string, opts?: { popup?: boolean; highlightStyle?: IHighlightStyle }): Promise<void> {
  const user = await User.findById(userId).select("name email").lean();
  if (!user) return;
  const requested: ("in_app" | "email" | "popup")[] = opts?.popup ? ["in_app", "email", "popup"] : ["in_app", "email"];
  const { channels } = await resolveDeliveryChannels(userId, CATEGORY_KEY, requested);
  // Email/popup get the rich render (highlight styling); in_app gets the
  // reduced bold-only render — no callout concept exists here (dunning
  // messages have no callout field), but highlight spans and images still
  // need to be downgraded to plain text for the bell — see
  // notificationEmailService.ts::buildInAppNotificationHtml's own comment.
  const richBodyHtml = buildNotificationHtml(body, { highlightStyle: opts?.highlightStyle });
  const inAppBodyHtml = buildInAppNotificationHtml(body);
  for (const channel of channels) {
    if (channel === "in_app") {
      await UserNotification.create({ userId, categoryKey: CATEGORY_KEY, title, body, bodyHtml: inAppBodyHtml, link: "/subscription", channel: "in_app" });
    } else if (channel === "popup") {
      await UserNotification.create({ userId, categoryKey: CATEGORY_KEY, title, body, bodyHtml: richBodyHtml, link: "/subscription", channel: "popup" });
    } else if (channel === "email") {
      const delivered = await sendNotificationEmail(user.email, title, richBodyHtml, `dunning:${userId}`);
      await UserNotification.create({ userId, categoryKey: CATEGORY_KEY, title, body, bodyHtml: richBodyHtml, link: "/subscription", channel: "email", emailStatus: delivered ? "sent" : "failed" });
    }
  }
}

// Called once, right when a Subscription first flips to `past_due` (see
// subscriptionService.ts's webhook handler) — NOT on every subsequent retry
// or every cron tick, so a user gets exactly one "your payment failed" notice
// per billing failure, not a spammy repeat.
export async function sendPastDueNotice(subscription: ISubscription): Promise<void> {
  const graceEnd = new Date(Date.now() + env.dunningGraceDays * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN");
  await notifyUser(
    subscription.userId,
    "We couldn't process your last payment",
    `Your last Premium payment didn't go through. Please update your payment method — your Premium access continues for now, but will be cancelled on ${graceEnd} if this isn't resolved.`
  );
}

async function autoCancelOnePastDue(subscription: ISubscription): Promise<void> {
  if (subscription.razorpaySubscriptionId && !subscription.razorpaySubscriptionId.startsWith("mock_sub_") && !env.razorpay.isPlaceholder) {
    try {
      await getClient().subscriptions.cancel(subscription.razorpaySubscriptionId, false);
    } catch (err) {
      // Often already cancelled/halted on Razorpay's own side by the time the
      // grace period runs out — log and proceed with the local cancellation
      // regardless, since that's what actually revokes Premium access here.
      logger.warn({ err, subscriptionId: String(subscription._id) }, "[dunningService] Razorpay cancel failed during auto-cancel, proceeding locally");
    }
  }
  subscription.status = "cancelled";
  subscription.endedAt = new Date();
  await subscription.save();
  emitActivity("subscription_cancelled", { userId: String(subscription.userId), props: { viaDunning: true } });
  await notifyUser(
    subscription.userId,
    "Your Premium subscription has been cancelled",
    "We weren't able to collect payment for your Premium subscription within the grace period, so it's been cancelled. You're back on the Freemium plan — resubscribe any time from the Subscription screen."
  );
}

export interface DunningRunSummary {
  checked: number;
  cancelled: number;
}

// jobs/dunning.cron.ts's daily entry point (same SystemJobRun + distributed
// -lock wrapping every other cron in this app already uses).
export async function runDunningSweep(): Promise<DunningRunSummary> {
  const cutoff = new Date(Date.now() - env.dunningGraceDays * 24 * 60 * 60 * 1000);
  const overdue = await Subscription.find({ status: "past_due", updatedAt: { $lte: cutoff } });
  let cancelled = 0;
  for (const subscription of overdue) {
    await autoCancelOnePastDue(subscription);
    cancelled += 1;
  }
  return { checked: overdue.length, cancelled };
}
