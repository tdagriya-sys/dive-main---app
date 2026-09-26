import axios from "axios";
import { env } from "../config/env";

/**
 * Reads a Razorpay Subscription Offer (created in the Razorpay Dashboard — the
 * SDK has no offers resource, so this is a plain read-only HTTP GET) and says
 * whether it can actually apply to a plan.
 *
 * Why this exists: Razorpay SILENTLY ignores an offer whose rules don't fit
 * the subscription — e.g. an offer with the Dashboard's default "maximum order
 * amount ₹100" on a ₹119 plan is accepted at `subscriptions.create` but never
 * linked, and the customer is charged full price. That was found on the first
 * test. Checking the offer's own rules up front turns that silent failure into
 * a plain-English warning.
 */

type BenefitList = Array<{ unit?: string; value?: string; max_benefit_value?: string }>;

interface RazorpayOffer {
  id: string;
  name?: string;
  status?: string;
  starts_at?: string | number;
  ends_at?: string | number;
  applicable_channels?: string[];
  // e.g. [{ on: "OFFER", limit_type: "COUNT", limit_value: "1" }] = usable once IN TOTAL.
  usage_limits?: Array<{ on?: string; limit_type?: string; limit_value?: string }>;
  rules?: {
    items?: Array<{
      criteria?: { includes?: { paymentInstrument?: { methods?: string[] } | null; order?: { min_amount?: string; max_amount?: string } | null } };
      // Razorpay wraps this as { entity: "collection", items: [...] }; a plain array is accepted too.
      benefits?: BenefitList | { items?: BenefitList };
    }>;
  };
}

export interface OfferAnalysis {
  found: boolean;
  // Things that will stop the offer applying, or make it behave differently from the coupon.
  problems: string[];
  // Plain facts about the offer, for display.
  notes: string[];
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2).replace(/\.00$/, "")}`;
const epoch = (v: string | number | undefined) => (v === undefined || v === null || v === "" ? undefined : Number(v) * 1000);

// Pure — exported for tests.
export function analyzeOffer(
  offer: RazorpayOffer | null,
  opts: { plans: Array<{ name: string; pricePaise: number }>; couponPercent?: number; couponMaxRedemptions?: number; now?: number }
): OfferAnalysis {
  if (!offer) {
    return { found: false, problems: ["This offer id wasn't found in Razorpay (check it was copied exactly, and that it's from the same Test/Live mode as your API keys)."], notes: [] };
  }
  const now = opts.now ?? Date.now();
  const problems: string[] = [];
  const notes: string[] = [];

  if (offer.status && offer.status.toUpperCase() !== "ACTIVE") problems.push(`The offer's status is "${offer.status}", not ACTIVE — Razorpay won't apply it.`);

  const start = epoch(offer.starts_at);
  const end = epoch(offer.ends_at);
  if (start !== undefined && now < start) problems.push(`The offer hasn't started yet (starts ${new Date(start).toISOString().slice(0, 16).replace("T", " ")} UTC).`);
  if (end !== undefined && now > end) problems.push(`The offer has expired (ended ${new Date(end).toISOString().slice(0, 16).replace("T", " ")} UTC).`);
  if (start !== undefined && end !== undefined) notes.push(`Valid ${new Date(start).toISOString().slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)} (UTC).`);

  const rule = offer.rules?.items?.[0];
  const methods = rule?.criteria?.includes?.paymentInstrument?.methods;
  if (methods && methods.length) {
    notes.push(`Applies to: ${methods.join(", ")}.`);
    if (!methods.includes("upi")) problems.push("This offer isn't enabled for UPI, so UPI customers won't get the discount.");
  }
  if (offer.applicable_channels && offer.applicable_channels.length && !offer.applicable_channels.includes("RZP_CHECKOUT")) {
    problems.push("This offer isn't enabled for Razorpay Checkout, which is what the app uses.");
  }

  const order = rule?.criteria?.includes?.order;
  const min = order?.min_amount ? Number(order.min_amount) : 0;
  const max = order?.max_amount ? Number(order.max_amount) : 0;
  if (min || max) notes.push(`Order amount range: ${min ? rupees(min) : "no minimum"} to ${max ? rupees(max) : "no maximum"}.`);
  for (const plan of opts.plans) {
    if (max > 0 && plan.pricePaise > max) {
      problems.push(`The offer's MAXIMUM order amount is ${rupees(max)}, but ${plan.name} costs ${rupees(plan.pricePaise)} — Razorpay will NOT apply the offer to that plan (it silently ignores it and the customer pays full price). In the Razorpay Dashboard edit the offer's maximum amount to at least ${rupees(plan.pricePaise)}.`);
    }
    if (min > 0 && plan.pricePaise < min) {
      problems.push(`The offer's MINIMUM order amount is ${rupees(min)}, but ${plan.name} costs only ${rupees(plan.pricePaise)} — the offer won't apply.`);
    }
  }

  // Total uses across ALL customers. Once reached, Razorpay stops applying the
  // offer (silently) and checkout would refuse — fine for a test offer, wrong for a
  // real promotion.
  const totalLimit = offer.usage_limits?.find((u) => u.on === "OFFER" && u.limit_type === "COUNT" && u.limit_value);
  if (totalLimit) {
    const n = Number(totalLimit.limit_value);
    notes.push(`Total uses allowed across all customers: ${n}.`);
    const wanted = opts.couponMaxRedemptions ?? Infinity;
    if (n < wanted) {
      problems.push(
        `The offer can only be used ${n} time${n === 1 ? "" : "s"} IN TOTAL (across all customers) — after that Razorpay stops applying it and customers using this coupon would be refused at checkout. ${opts.couponMaxRedemptions !== undefined ? `This coupon allows ${opts.couponMaxRedemptions} uses.` : "This coupon has no use limit."} Raise the offer's maximum usage in the Razorpay Dashboard.`
      );
    }
  }

  const rawBenefits = rule?.benefits;
  const benefit = (Array.isArray(rawBenefits) ? rawBenefits : rawBenefits?.items)?.[0];
  if (benefit?.unit === "PERCENTAGE" && benefit.value) {
    const percent = Number(benefit.value) / 100;
    notes.push(`Discount: ${percent}%${benefit.max_benefit_value ? ` (up to ${rupees(Number(benefit.max_benefit_value))})` : ""}.`);
    if (opts.couponPercent !== undefined && Math.abs(percent - opts.couponPercent) > 0.001) {
      problems.push(`The offer gives ${percent}% off but this coupon says ${opts.couponPercent}% — the price shown in the app won't match what Razorpay charges. Make them equal.`);
    }
  } else if (benefit?.value) {
    notes.push(`Discount value: ${benefit.value} (${benefit.unit ?? "flat"}).`);
  }
  return { found: true, problems, notes };
}

// Real-mode only; null when Razorpay can't be asked (placeholder keys, network error).
export async function fetchOffer(offerId: string): Promise<RazorpayOffer | null | undefined> {
  if (env.razorpay.isPlaceholder) return undefined;
  try {
    const { data } = await axios.get("https://api.razorpay.com/v1/offers", {
      auth: { username: env.razorpay.keyId as string, password: env.razorpay.keySecret as string },
      params: { count: 100 },
      timeout: 15000,
    });
    const items = (data?.items ?? []) as RazorpayOffer[];
    return items.find((o) => o.id === offerId) ?? null;
  } catch {
    return undefined; // couldn't ask — don't claim the offer is missing
  }
}

// undefined = couldn't be checked (mock mode or Razorpay unreachable).
export async function checkOfferForPlans(offerId: string, plans: Array<{ name: string; pricePaise: number }>, couponPercent?: number, couponMaxRedemptions?: number): Promise<OfferAnalysis | undefined> {
  const offer = await fetchOffer(offerId);
  if (offer === undefined) return undefined;
  return analyzeOffer(offer, { plans, couponPercent, couponMaxRedemptions });
}
