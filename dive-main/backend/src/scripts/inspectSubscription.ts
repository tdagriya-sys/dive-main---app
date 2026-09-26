import Razorpay from "razorpay";
import { env } from "../config/env";
import { connectDb, disconnectDb } from "../db/connect";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { SubscriptionPlan } from "../models/SubscriptionPlan";
import { Coupon } from "../models/Coupon";
import { Payment } from "../models/Payment";
import { WebhookEvent } from "../models/WebhookEvent";
import { checkOfferForPlans, OfferAnalysis } from "../services/razorpayOfferService";

/**
 * READ-ONLY diagnostic: for one user's most recent subscription, says what the
 * NEXT renewal will actually charge — comparing what this app recorded with
 * what Razorpay itself reports (GET requests only; nothing is created, updated
 * or cancelled, in the database or at Razorpay).
 *
 * Built around first-month discounts. These now work through a Razorpay OFFER
 * ("offer mode": the subscription stays on the normal plan and Razorpay applies
 * the discount itself). The old approach — a discounted plan for cycle 1 and a
 * plan switch afterwards — was removed because Razorpay refuses plan changes on
 * UPI subscriptions. This tells you whether the offer was really applied, and
 * flags any leftover subscription still stuck on a discounted plan.
 *
 *   npm run inspect-subscription -- --email someone@example.com
 */

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export interface RenewalVerdictInput {
  couponCode?: string | null;
  // null = the coupon code on the subscription no longer exists.
  couponDuration?: "once" | "recurring" | null;
  // The Razorpay-Dashboard offer id set on the coupon ("offer mode"), if any.
  couponOfferId?: string | null;
  // What the first paid charge actually was (from the ledger / Razorpay's own payment).
  firstChargeAmountPaise?: number;
  catalogPricePaise: number;
  firstChargeRecorded: boolean;
  // undefined = Razorpay couldn't be queried (mock/placeholder keys, no
  // Razorpay id, or the call failed).
  razorpay?: {
    status: string;
    currentPlanAmountPaise: number;
    hasScheduledChanges: boolean;
    pendingPlanAmountPaise?: number;
    // How many charges Razorpay says it has collected.
    paidCount?: number;
    // "upi" | "card" | "emandate" | ... — Razorpay refuses plan changes on UPI.
    paymentMethod?: string;
    // The Razorpay offer linked to this subscription, if any.
    offerId?: string;
  };
  // A payment for this user exists in the ledger but is filed under a
  // DIFFERENT local subscription row than this one.
  chargeRecordedOnAnotherRow?: boolean;
}

export interface RenewalVerdict {
  level: "ok" | "problem" | "info";
  message: string;
}

// Pure: decides what to tell the owner. Exported for tests.
export function renewalVerdict(i: RenewalVerdictInput): RenewalVerdict {
  const catalog = rupees(i.catalogPricePaise);
  // Whatever the coupon: Razorpay collected money the app has no record of.
  if (!i.firstChargeRecorded && (i.razorpay?.paidCount ?? 0) > 0) {
    return {
      level: "problem",
      message: i.chargeRecordedOnAnotherRow
        ? `PROBLEM: Razorpay has collected ${i.razorpay?.paidCount} charge(s), but this subscription row has none recorded — the payment is filed under ANOTHER local row for the same user (a duplicate created by the webhook/browser-confirmation race). See the row list above.`
        : `PROBLEM: Razorpay has collected ${i.razorpay?.paidCount} charge(s), but the app has NO payment recorded for this user against it — neither the browser confirmation nor the webhook recorded it. Check the webhook list above for a failed/missing "subscription.charged".`,
    };
  }
  if (!i.couponCode) {
    return { level: "info", message: `No coupon on this subscription — renewals charge the normal ${catalog}.` };
  }
  if (i.couponDuration === null || i.couponDuration === undefined) {
    return { level: "info", message: `Coupon "${i.couponCode}" no longer exists in the coupon list, so its duration can't be checked here.` };
  }
  // Offer mode: Razorpay applies the discount itself, so there is no plan
  // switch to schedule — what matters is that the offer is linked and the plan
  // on Razorpay is the normal catalog one.
  if (i.couponOfferId) {
    const rzo = i.razorpay;
    if (!rzo) return { level: "info", message: `Coupon "${i.couponCode}" is in OFFER mode (Razorpay offer ${i.couponOfferId}) — Razorpay applies the discount itself; it couldn't be queried to confirm the offer is linked.` };
    if (!rzo.offerId) {
      // Razorpay clears an offer's link once its cycles are used up, so "no offer
      // linked" AFTER a discounted first charge is the normal, successful outcome.
      const discountApplied = i.firstChargeAmountPaise !== undefined && i.firstChargeAmountPaise < i.catalogPricePaise;
      if (discountApplied && rzo.currentPlanAmountPaise === i.catalogPricePaise) {
        return {
          level: "ok",
          message: `Offer applied and used up, as designed: the first charge was ${rupees(i.firstChargeAmountPaise as number)} (discounted), and Razorpay's plan on this subscription is the normal ${catalog}, so later cycles charge ${catalog}. (Razorpay drops the offer link once the offer's cycles are used, which is why "offer linked" shows none.)`,
        };
      }
      return { level: "problem", message: `PROBLEM: coupon "${i.couponCode}" is in offer mode (${i.couponOfferId}) but this Razorpay subscription has NO offer linked — the customer would not get the discount from Razorpay.` };
    }
    if (rzo.currentPlanAmountPaise !== i.catalogPricePaise) {
      return { level: "problem", message: `PROBLEM: offer mode expects the subscription to be on the normal ${catalog} plan, but Razorpay's plan amount is ${rupees(rzo.currentPlanAmountPaise)}.` };
    }
    return {
      level: "ok",
      message: `Offer mode working as designed: the subscription is on the normal ${catalog} plan with offer ${rzo.offerId} linked, so Razorpay discounts only the cycles the offer is set up for (see it in the Razorpay Dashboard → Offers) and every later cycle charges ${catalog}. No plan switch is needed, so UPI is fine.`,
    };
  }

  if (i.couponDuration === "recurring") {
    return {
      level: "info",
      message: `Coupon "${i.couponCode}" is set to "recurring" — the discount is meant to apply on EVERY renewal, not just the first. That is by design (the customer stays on the discounted plan; the normal price is ${catalog}). For a first-month-only discount use a coupon with a Razorpay offer.`,
    };
  }

  // A "first charge only" coupon WITHOUT a Razorpay offer — the old plan-switch
  // approach. The automatic switch to full price no longer exists (Razorpay
  // refuses plan changes on UPI subscriptions) and such a coupon can no longer
  // be redeemed, so this is a leftover from before.
  const rz = i.razorpay;
  if (rz && rz.currentPlanAmountPaise < i.catalogPricePaise) {
    return {
      level: "problem",
      message: `LEGACY: coupon "${i.couponCode}" is an old-style "first charge only" coupon with no Razorpay offer. The automatic switch to full price was removed, so this subscription keeps charging ${rupees(rz.currentPlanAmountPaise)} every cycle (the normal price is ${catalog}). Cancel it, or move the customer to a new subscription at full price.`,
    };
  }
  return {
    level: "info",
    message: `Coupon "${i.couponCode}" is an old-style "first charge only" coupon with no Razorpay offer (it can no longer be redeemed).${rz ? ` Razorpay's plan on this subscription is ${rupees(rz.currentPlanAmountPaise)}.` : ""}`,
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
    paymentMethod: typeof sub.payment_method === "string" ? sub.payment_method : undefined,
    offerId: typeof sub.offer_id === "string" && sub.offer_id ? sub.offer_id : undefined,
    remainingCount: sub.remaining_count as number | undefined,
  };
}

export interface InspectionResult {
  found: boolean;
  lines: string[];
  verdict?: RenewalVerdict;
}

// `client` is injectable so tests never touch the network.
export async function inspectSubscription(
  email: string,
  client?: RazorpayLike,
  // Injectable so tests never touch the network.
  checkOffer: (offerId: string, plans: Array<{ name: string; pricePaise: number }>, couponPercent?: number, couponMaxRedemptions?: number) => Promise<OfferAnalysis | undefined> = checkOfferForPlans
): Promise<InspectionResult> {
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
  const allRows = await Subscription.find({ userId: user._id }).sort({ createdAt: -1 }).limit(8).lean();
  const userPayments = await Payment.find({ userId: user._id, subscriptionId: { $exists: true } }).lean();
  const chargeRecordedOnAnotherRow = !firstChargeRecorded && userPayments.some((p) => p.status === "paid" && String(p.subscriptionId) !== String(sub._id) && allRows.some((r) => String(r._id) === String(p.subscriptionId) && r.razorpaySubscriptionId === sub.razorpaySubscriptionId));

  lines.push(`User          : ${user.email}`);
  lines.push(`Plan          : ${plan?.name ?? "?"} (${plan?.key ?? "?"}) — catalog price ${rupees(catalogPricePaise)}`);
  lines.push(`Status        : ${sub.status}${sub.cancelAtPeriodEnd ? " (set to cancel at period end)" : ""}`);
  lines.push(`Period        : ${sub.currentPeriodStart?.toISOString().slice(0, 10)} → ${sub.currentPeriodEnd?.toISOString().slice(0, 10)}`);
  lines.push(`Razorpay sub  : ${sub.razorpaySubscriptionId ?? "(none)"}`);
  lines.push(
    `Coupon        : ${sub.couponCode ?? "(none)"}${coupon ? ` — ${coupon.type === "percent" ? `${coupon.value}%` : rupees(coupon.value)} off, duration "${coupon.discountDuration}"${coupon.razorpayOfferId ? `, OFFER MODE (${coupon.razorpayOfferId})` : ""}` : sub.couponCode ? " — not found in coupon list" : ""}`
  );
  lines.push(`Charges recorded: ${payments.length ? payments.map((p) => `${rupees(p.amount)} (${p.status})`).join(", ") : "none"}`);

  // Every local row for this user, so a duplicate (same Razorpay id twice) is visible.
  lines.push("");
  lines.push(`All subscription rows for this user (newest first):`);
  for (const r of allRows) {
    const n = userPayments.filter((p) => String(p.subscriptionId) === String(r._id)).length;
    lines.push(`  ${r._id === sub._id || String(r._id) === String(sub._id) ? "→" : " "} ${String(r._id).slice(-6)}  ${r.status.padEnd(9)} ${r.razorpaySubscriptionId ?? "(no razorpay id)"}  coupon=${r.couponCode ?? "-"}  payments=${n}  created ${(r as unknown as { createdAt?: Date }).createdAt?.toISOString().slice(0, 16).replace("T", " ") ?? "?"}`);
  }
  const rzId = sub.razorpaySubscriptionId;
  if (rzId) {
    const events = await WebhookEvent.find({
      provider: "razorpay",
      $or: [{ "payload.payload.subscription.entity.id": rzId }, { "payload.payload.payment.entity.subscription_id": rzId }],
    })
      .sort({ receivedAt: 1 })
      .limit(20)
      .lean();
    lines.push("");
    lines.push("Webhooks Razorpay sent for this subscription:");
    if (!events.length) lines.push("  (none recorded — Razorpay may not be reaching /api/payments/webhook)");
    for (const e of events) {
      lines.push(`  ${e.receivedAt.toISOString().slice(0, 19).replace("T", " ")}  ${(e.eventType ?? "?").padEnd(24)} signature=${e.signatureValid === false ? "INVALID" : "ok"}  processed=${e.processedOk ? "ok" : "FAILED"}${e.error ? "  error: " + e.error : ""}`);
    }
  }

  let razorpay: RenewalVerdictInput["razorpay"];
  const razorpayId = sub.razorpaySubscriptionId;
  const canQuery = razorpayId && !razorpayId.startsWith("mock_sub_") && (client || !env.razorpay.isPlaceholder);
  if (canQuery) {
    try {
      const live = await queryRazorpay(client ?? new Razorpay({ key_id: env.razorpay.keyId as string, key_secret: env.razorpay.keySecret as string }), razorpayId as string);
      razorpay = { ...live, paidCount: live.paidCount, paymentMethod: live.paymentMethod, offerId: live.offerId };
      lines.push("");
      lines.push("Razorpay says (live, read-only):");
      lines.push(`  offer linked         : ${live.offerId ?? "none"}`);
      if (live.paymentMethod) lines.push(`  payment method       : ${live.paymentMethod}`);
      lines.push(`  status               : ${live.status}   (paid cycles: ${live.paidCount ?? "?"}, remaining: ${live.remainingCount ?? "?"})`);
      lines.push(`  current plan amount  : ${rupees(live.currentPlanAmountPaise)}`);
      lines.push(`  next charge          : ${live.chargeAt ? new Date(live.chargeAt * 1000).toISOString().slice(0, 10) : "?"}`);
      lines.push(`  scheduled plan change: ${live.hasScheduledChanges ? `yes → ${live.pendingPlanAmountPaise != null ? rupees(live.pendingPlanAmountPaise) : "?"}${live.changeScheduledAt ? ` on ${new Date(live.changeScheduledAt * 1000).toISOString().slice(0, 10)}` : ""}` : "none"}`);
    } catch (err) {
      lines.push("");
      lines.push(`(Couldn't read Razorpay: ${err instanceof Error ? err.message : JSON.stringify(err)})`);
    }
  }

  // For an offer-mode coupon, read the OFFER itself and show whether its rules fit the plan.
  let offerAnalysis: OfferAnalysis | undefined;
  if (coupon?.razorpayOfferId && plan) {
    offerAnalysis = await checkOffer(coupon.razorpayOfferId, [{ name: plan.name, pricePaise: plan.pricePaise }], coupon.type === "percent" ? coupon.value : undefined, coupon.maxRedemptions);
    if (offerAnalysis) {
      lines.push("");
      lines.push(`The Razorpay offer (${coupon.razorpayOfferId}) itself:`);
      for (const n of offerAnalysis.notes) lines.push(`  ${n}`);
      for (const pr of offerAnalysis.problems) lines.push(`  ⚠ ${pr}`);
      if (!offerAnalysis.problems.length) lines.push("  ✓ its rules fit this plan");
    }
  }

  let verdict = renewalVerdict({
    couponCode: sub.couponCode ?? null,
    couponDuration: sub.couponCode ? (coupon?.discountDuration ?? null) : undefined,
    couponOfferId: coupon?.razorpayOfferId ?? null,
    firstChargeAmountPaise: payments.find((p) => p.status === "paid")?.amount,
    catalogPricePaise,
    firstChargeRecorded,
    razorpay,
    chargeRecordedOnAnotherRow,
  });
  if (verdict.level === "problem" && offerAnalysis?.problems.length) {
    verdict = { ...verdict, message: `${verdict.message} LIKELY CAUSE — ${offerAnalysis.problems[0]}` };
  }
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
