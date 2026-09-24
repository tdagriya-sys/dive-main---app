import Razorpay from "razorpay";
import { env } from "../config/env";
import { connectDb, disconnectDb } from "../db/connect";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { SubscriptionPlan } from "../models/SubscriptionPlan";
import { Coupon } from "../models/Coupon";
import { Payment } from "../models/Payment";

/**
 * READ-ONLY diagnostic: for one user's most recent subscription, says what the
 * NEXT renewal will actually charge — comparing what this app recorded with
 * what Razorpay itself reports (GET requests only; nothing is created, updated
 * or cancelled, in the database or at Razorpay).
 *
 * Built for the "first charge only" (`discountDuration: "once"`) coupon: a
 * discounted Razorpay plan is used for the first cycle, and after that charge
 * the app asks Razorpay to switch the subscription to the full-price plan from
 * the next cycle (subscriptionService.ts::revertToFullPriceIfOneTimeCoupon).
 * Razorpay shows the DISCOUNTED amount for the autopay mandate until then —
 * that alone is not a fault. This tells you whether the switch was actually
 * scheduled.
 *
 *   npm run inspect-subscription -- --email someone@example.com
 */

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export interface RenewalVerdictInput {
  couponCode?: string | null;
  // null = the coupon code on the subscription no longer exists.
  couponDuration?: "once" | "recurring" | null;
  catalogPricePaise: number;
  revertScheduledLocally: boolean;
  firstChargeRecorded: boolean;
  // undefined = Razorpay couldn't be queried (mock/placeholder keys, no
  // Razorpay id, or the call failed).
  razorpay?: {
    status: string;
    currentPlanAmountPaise: number;
    hasScheduledChanges: boolean;
    pendingPlanAmountPaise?: number;
  };
}

export interface RenewalVerdict {
  level: "ok" | "problem" | "info";
  message: string;
}

// Pure: decides what to tell the owner. Exported for tests.
export function renewalVerdict(i: RenewalVerdictInput): RenewalVerdict {
  const catalog = rupees(i.catalogPricePaise);
  if (!i.couponCode) {
    return { level: "info", message: `No coupon on this subscription — renewals charge the normal ${catalog}.` };
  }
  if (i.couponDuration === null || i.couponDuration === undefined) {
    return { level: "info", message: `Coupon "${i.couponCode}" no longer exists in the coupon list, so its duration can't be checked here.` };
  }
  if (i.couponDuration === "recurring") {
    return {
      level: "info",
      message: `Coupon "${i.couponCode}" is set to "recurring" — the discount is meant to apply on EVERY renewal, not just the first. That is by design; a coupon set to "once" is the one that returns to ${catalog} after the first charge.`,
    };
  }

  // "once" coupon from here on.
  if (!i.firstChargeRecorded) {
    return { level: "info", message: `Coupon "${i.couponCode}" is "once", but no first charge has been recorded yet — the switch to ${catalog} is only scheduled after the first charge succeeds.` };
  }
  const rz = i.razorpay;
  if (!rz) {
    return {
      level: i.revertScheduledLocally ? "ok" : "problem",
      message: i.revertScheduledLocally
        ? `Coupon "${i.couponCode}" is "once", and the app recorded that the switch to ${catalog} was scheduled (Razorpay itself couldn't be queried to confirm).`
        : `Coupon "${i.couponCode}" is "once", but the switch to ${catalog} was NEVER scheduled (and Razorpay couldn't be queried). Renewals will keep charging the discounted amount.`,
    };
  }
  if (rz.currentPlanAmountPaise === i.catalogPricePaise) {
    return { level: "ok", message: `Razorpay's plan on this subscription is already the full ${catalog} — renewals charge ${catalog}.` };
  }
  if (rz.hasScheduledChanges && rz.pendingPlanAmountPaise === i.catalogPricePaise) {
    return {
      level: "ok",
      message: `Working as designed: this cycle stays at ${rupees(rz.currentPlanAmountPaise)}, and Razorpay has a scheduled switch to ${catalog} for the next cycle. (The autopay mandate showing ${rupees(rz.currentPlanAmountPaise)} until then is expected.)`,
    };
  }
  if (rz.hasScheduledChanges) {
    return { level: "problem", message: `Razorpay has a scheduled change, but to ${rz.pendingPlanAmountPaise != null ? rupees(rz.pendingPlanAmountPaise) : "an unexpected plan"}, not the full ${catalog}. Look at it in the Razorpay dashboard.` };
  }
  return {
    level: "problem",
    message: `PROBLEM: coupon "${i.couponCode}" is "once" but Razorpay has NO scheduled switch to ${catalog}. It will keep charging ${rupees(rz.currentPlanAmountPaise)} every cycle. ${i.revertScheduledLocally ? "(The app believed it had scheduled it — the schedule seems to have been lost.)" : "The app never managed to schedule it — search the server log for \"failed to revert one-time-coupon\"."}`,
  };
}

type RazorpayLike = Pick<Razorpay, "subscriptions" | "plans">;

async function queryRazorpay(client: RazorpayLike, razorpaySubscriptionId: string): Promise<RenewalVerdictInput["razorpay"] & { planId: string; changeScheduledAt?: number; chargeAt?: number; paidCount?: number; remainingCount?: number; pendingPlanId?: string }> {
  const sub = (await client.subscriptions.fetch(razorpaySubscriptionId)) as unknown as Record<string, unknown>;
  const plan = (await client.plans.fetch(String(sub.plan_id))) as unknown as { item: { amount: number } };
  const hasScheduledChanges = Boolean(sub.has_scheduled_changes);
  let pendingPlanAmountPaise: number | undefined;
  let pendingPlanId: string | undefined;
  if (hasScheduledChanges) {
    const pending = (await client.subscriptions.pendingUpdate(razorpaySubscriptionId)) as unknown as Record<string, unknown>;
    pendingPlanId = pending.plan_id ? String(pending.plan_id) : undefined;
    if (pendingPlanId) pendingPlanAmountPaise = ((await client.plans.fetch(pendingPlanId)) as unknown as { item: { amount: number } }).item.amount;
  }
  return {
    status: String(sub.status),
    planId: String(sub.plan_id),
    currentPlanAmountPaise: plan.item.amount,
    hasScheduledChanges,
    pendingPlanAmountPaise,
    pendingPlanId,
    changeScheduledAt: sub.change_scheduled_at as number | undefined,
    chargeAt: sub.charge_at as number | undefined,
    paidCount: sub.paid_count as number | undefined,
    remainingCount: sub.remaining_count as number | undefined,
  };
}

export interface InspectionResult {
  found: boolean;
  lines: string[];
  verdict?: RenewalVerdict;
}

// `client` is injectable so tests never touch the network.
export async function inspectSubscription(email: string, client?: RazorpayLike): Promise<InspectionResult> {
  const lines: string[] = [];
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("email").lean();
  if (!user) return { found: false, lines: [`No user with email ${email}.`] };
  const sub = await Subscription.findOne({ userId: user._id }).sort({ createdAt: -1 });
  if (!sub) return { found: false, lines: [`${user.email} has no subscription.`] };

  const plan = await SubscriptionPlan.findById(sub.planId).lean();
  const catalogPricePaise = plan?.pricePaise ?? 0;
  const coupon = sub.couponCode ? await Coupon.findOne({ code: sub.couponCode }).lean() : null;
  const payments = await Payment.find({ subscriptionId: sub._id }).sort({ createdAt: 1 }).lean();
  const firstChargeRecorded = payments.some((p) => p.status === "paid");

  lines.push(`User          : ${user.email}`);
  lines.push(`Plan          : ${plan?.name ?? "?"} (${plan?.key ?? "?"}) — catalog price ${rupees(catalogPricePaise)}`);
  lines.push(`Status        : ${sub.status}${sub.cancelAtPeriodEnd ? " (set to cancel at period end)" : ""}`);
  lines.push(`Period        : ${sub.currentPeriodStart?.toISOString().slice(0, 10)} → ${sub.currentPeriodEnd?.toISOString().slice(0, 10)}`);
  lines.push(`Razorpay sub  : ${sub.razorpaySubscriptionId ?? "(none)"}`);
  lines.push(
    `Coupon        : ${sub.couponCode ?? "(none)"}${coupon ? ` — ${coupon.type === "percent" ? `${coupon.value}%` : rupees(coupon.value)} off, duration "${coupon.discountDuration}"` : sub.couponCode ? " — not found in coupon list" : ""}`
  );
  lines.push(`Switch to full price scheduled (per app): ${sub.couponOnceRevertScheduledAt ? sub.couponOnceRevertScheduledAt.toISOString() : "no"}`);
  lines.push(`Charges recorded: ${payments.length ? payments.map((p) => `${rupees(p.amount)} (${p.status})`).join(", ") : "none"}`);

  let razorpay: RenewalVerdictInput["razorpay"];
  const razorpayId = sub.razorpaySubscriptionId;
  const canQuery = razorpayId && !razorpayId.startsWith("mock_sub_") && (client || !env.razorpay.isPlaceholder);
  if (canQuery) {
    try {
      const live = await queryRazorpay(client ?? new Razorpay({ key_id: env.razorpay.keyId as string, key_secret: env.razorpay.keySecret as string }), razorpayId as string);
      razorpay = live;
      lines.push("");
      lines.push("Razorpay says (live, read-only):");
      lines.push(`  status               : ${live.status}   (paid cycles: ${live.paidCount ?? "?"}, remaining: ${live.remainingCount ?? "?"})`);
      lines.push(`  current plan amount  : ${rupees(live.currentPlanAmountPaise)}`);
      lines.push(`  next charge          : ${live.chargeAt ? new Date(live.chargeAt * 1000).toISOString().slice(0, 10) : "?"}`);
      lines.push(`  scheduled plan change: ${live.hasScheduledChanges ? `yes → ${live.pendingPlanAmountPaise != null ? rupees(live.pendingPlanAmountPaise) : "?"}${live.changeScheduledAt ? ` on ${new Date(live.changeScheduledAt * 1000).toISOString().slice(0, 10)}` : ""}` : "none"}`);
    } catch (err) {
      lines.push("");
      lines.push(`(Couldn't read Razorpay: ${err instanceof Error ? err.message : JSON.stringify(err)})`);
    }
  }

  const verdict = renewalVerdict({
    couponCode: sub.couponCode ?? null,
    couponDuration: sub.couponCode ? (coupon?.discountDuration ?? null) : undefined,
    catalogPricePaise,
    revertScheduledLocally: Boolean(sub.couponOnceRevertScheduledAt),
    firstChargeRecorded,
    razorpay,
  });
  return { found: true, lines, verdict };
}

// Allows `npm run inspect-subscription -- --email someone@example.com`.
if (require.main === module) {
  const idx = process.argv.indexOf("--email");
  const email = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error("Usage: npm run inspect-subscription -- --email someone@example.com");
    process.exit(1);
  }
  connectDb()
    .then(() => inspectSubscription(email))
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(r.lines.join("\n"));
      if (r.verdict) {
        // eslint-disable-next-line no-console
        console.log(`\n${r.verdict.level === "problem" ? "❌" : r.verdict.level === "ok" ? "✅" : "ℹ️"}  ${r.verdict.message}`);
        // eslint-disable-next-line no-console
        console.log("\n(Read-only: nothing was changed.)");
      }
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
