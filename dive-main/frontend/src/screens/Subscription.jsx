import React, { useState, useEffect } from "react";
import { ChevronLeft, Loader2, Check, Crown, AlertTriangle, Download, Tag, Gift, ChevronDown, ChevronUp } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import { fmtINR } from "../lib/diveEngine";
import { loadRazorpayCheckout } from "../lib/loadRazorpayCheckout";

const USAGE_LABELS = { bot_scan: "Bot Scan AI extraction", doc_upload: "Doc Upload AI extraction", portfolio_edit: "Portfolio edits" };
// Pairs each usage key with the entitlements fields that carry its actual
// limit — usage[key] is keyed like "bot_scan", the limits on the plan's own
// `entitlements` object are keyed like "botScanWeekly"/"botScanMonthly".
const LIMIT_FIELDS = {
  bot_scan: { weekly: "botScanWeekly", monthly: "botScanMonthly" },
  doc_upload: { weekly: "docUploadWeekly", monthly: "docUploadMonthly" },
  portfolio_edit: { weekly: "portfolioEditWeekly", monthly: "portfolioEditMonthly" },
};
function fmtLimit(n) {
  return n == null ? "Unlimited" : n;
}

// One card per premium plan, OR one card per LINKED Monthly/Annual pair
// (see Subscription's own top comment on why this is a standalone
// component, not inline JSX in a .map()) — each card owns its own coupon
// input and trial-confirm state, since those are meaningless shared across
// plans (a coupon typed against one plan's price/key has nothing to do with
// another). `toggle` (from LinkedPlanCard below) adds the Monthly/Annual
// pill switch and discount badge for a linked pair; `testKey` keeps the
// card's own data-testid stable across a toggle flip even though `plan`
// itself changes (the card is one visual unit, not two).
function PremiumPlanCard({ plan, isPremium, currentPlanKey, subscriptionStatus, hasUsedTrial, subscribing, startingTrial, onSubscribe, onStartTrial, toggle, testKey }) {
  const key = testKey ?? plan.key;
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState(null); // { code, discountedPricePaise } | { error }
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [showTrialConfirm, setShowTrialConfirm] = useState(false);

  // A coupon/trial-confirm state validated against the PREVIOUS plan means
  // nothing once the toggle switches which plan is actually selected (this
  // is a no-op for a non-toggled single-plan card, since `plan.key` never
  // changes there for a mounted instance).
  useEffect(() => {
    setCouponInput("");
    setCoupon(null);
    setShowTrialConfirm(false);
  }, [plan.key]);

  const isCurrentPremiumCard = isPremium && plan.key === currentPlanKey;
  // A trial and a real paid subscription are two separate things (see
  // subscriptionService.ts's own comment) — the card for a trialing user
  // still marks this AS their current plan (gold border) but with a
  // "Trialing" badge instead of "Subscribed", and keeps the Subscribe flow
  // open so they can convert to a real paid subscription of the very same
  // plan (clubbing whatever trial days remain onto it), not just a
  // different one.
  const isTrialingHere = isCurrentPremiumCard && subscriptionStatus === "trialing";
  const isLockedPaidHere = isCurrentPremiumCard && !isTrialingHere;
  const canClaimTrialHere = !isPremium && !hasUsedTrial && plan.trialDays > 0;

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCheckingCoupon(true);
    try {
      const { data } = await api.post("/subscriptions/coupons/preview", { code, planKey: plan.key });
      setCoupon({ code: data.code, discountedPricePaise: data.discountedPricePaise });
    } catch (err) {
      setCoupon({ error: err?.response?.data?.message || "That coupon code isn't valid." });
    } finally {
      setCheckingCoupon(false);
    }
  }

  return (
    <div
      className={`relative h-full flex flex-col rounded-2xl bg-[var(--surface-card)] p-3 ${isCurrentPremiumCard ? "border-4 border-[var(--gold-b)]" : "border-2 border-[var(--gold-b)]/60"}`}
      data-testid={`subscription-plan-premium-${key}`}
    >
      {isLockedPaidHere && (
        <span className="absolute -top-2.5 left-2 bg-[var(--gold-b)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full" data-testid={`subscription-plan-premium-${key}-subscribed-badge`}>
          Subscribed
        </span>
      )}
      {isTrialingHere && (
        <span className="absolute -top-2.5 left-2 bg-[var(--dive-blue)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full" data-testid={`subscription-plan-premium-${key}-trialing-badge`}>
          Trialing
        </span>
      )}
      {toggle && toggle.billingInterval === "year" && toggle.savingsPercent != null && (
        <span className="absolute -top-2.5 right-2 bg-[var(--green)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" data-testid={`subscription-plan-discount-badge-${key}`}>
          Save {toggle.savingsPercent}%
        </span>
      )}

      {toggle && (
        <div className="flex justify-center mb-2 mt-1">
          <div className="inline-flex rounded-full border border-[var(--border)] p-0.5 text-[10px]" data-testid={`subscription-plan-toggle-${key}`}>
            <button
              type="button"
              data-testid={`subscription-plan-toggle-monthly-${key}`}
              onClick={() => toggle.setBillingInterval("month")}
              className={`px-2 py-0.5 rounded-full font-bold transition-colors ${toggle.billingInterval === "month" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}
            >
              Monthly
            </button>
            <button
              type="button"
              data-testid={`subscription-plan-toggle-annual-${key}`}
              onClick={() => toggle.setBillingInterval("year")}
              className={`px-2 py-0.5 rounded-full font-bold transition-colors ${toggle.billingInterval === "year" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}
            >
              Annual
            </button>
          </div>
        </div>
      )}

      <p className="font-heading font-black text-xs leading-tight">{plan.name}</p>
      {coupon?.discountedPricePaise != null ? (
        <p className="text-lg font-black mt-1 leading-tight">
          {fmtINR(coupon.discountedPricePaise / 100)}
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">/{plan.interval}</span>{" "}
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)] line-through">{fmtINR(plan.pricePaise / 100)}</span>
        </p>
      ) : (
        <p className="text-lg font-black mt-1 leading-tight">
          {fmtINR(plan.pricePaise / 100)}
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">/{plan.interval}</span>
        </p>
      )}
      {plan.trialDays > 0 && !hasUsedTrial && <p className="text-[10px] text-[var(--green)] font-semibold mt-1">{plan.trialDays}-day free trial</p>}

      <ul className="mt-2 space-y-1">
        {(plan.benefits || []).map((b, i) => (
          <li key={i} className="flex items-start gap-1 text-[10px] text-[var(--text-secondary)]">
            <Check size={11} className="text-[var(--green)] shrink-0 mt-0.5" /> {b}
          </li>
        ))}
      </ul>

      {isLockedPaidHere ? (
        <p className="mt-3 text-center text-[11px] font-bold text-[var(--gold-c)]" data-testid={`subscription-plan-premium-${key}-current-note`}>
          This is your active plan
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5">
              <Tag size={13} className="text-[var(--text-tertiary)] shrink-0" />
              <input
                type="text"
                data-testid={`subscription-coupon-input-${key}`}
                placeholder="Coupon code"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                className="w-full bg-transparent text-xs outline-none min-w-0"
              />
            </div>
            <button
              type="button"
              data-testid={`subscription-coupon-apply-btn-${key}`}
              onClick={applyCoupon}
              disabled={checkingCoupon || !couponInput}
              className="text-xs font-bold text-[var(--dive-blue)] disabled:opacity-40 shrink-0"
            >
              {checkingCoupon ? "…" : "Apply"}
            </button>
          </div>
          {coupon?.error && (
            <p className="text-xs text-[var(--red)] mt-1.5" data-testid={`subscription-coupon-error-${key}`}>
              {coupon.error}
            </p>
          )}
          {coupon?.code && (
            <p className="text-xs text-[var(--green)] font-semibold mt-1.5" data-testid={`subscription-coupon-applied-${key}`}>
              "{coupon.code}" applied
            </p>
          )}

          {isPremium && (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-2" data-testid={`subscription-plan-switch-note-${key}`}>
              Subscribing now adds this plan's full period on top of any days you already have left.
            </p>
          )}

          {canClaimTrialHere &&
            (showTrialConfirm ? (
              <div className="mt-4 rounded-xl border border-[var(--gold-b)]/40 bg-[var(--gold-b)]/10 p-3" data-testid={`subscription-trial-confirm-${key}`}>
                <p className="text-xs text-[var(--text-secondary)] mb-2">Start your {plan.trialDays}-day free trial? No payment required — you can cancel anytime.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid={`subscription-trial-confirm-btn-${key}`}
                    onClick={async () => {
                      const ok = await onStartTrial(plan.key);
                      if (!ok) setShowTrialConfirm(false); // reverts to the plain button rather than staying stuck on a failed claim
                    }}
                    disabled={startingTrial}
                    className="flex-1 gold-btn rounded-full py-2 text-xs font-bold disabled:opacity-60"
                  >
                    {startingTrial ? "Starting…" : "Yes, start trial"}
                  </button>
                  <button
                    type="button"
                    data-testid={`subscription-trial-dismiss-btn-${key}`}
                    onClick={() => setShowTrialConfirm(false)}
                    disabled={startingTrial}
                    className="flex-1 border border-[var(--border)] rounded-full py-2 text-xs font-bold disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid={`subscription-trial-btn-${key}`}
                onClick={() => setShowTrialConfirm(true)}
                disabled={startingTrial || Boolean(subscribing)}
                className="w-full rounded-full py-2.5 font-bold mt-4 border-2 border-[var(--gold-b)] text-[var(--gold-c)] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Gift size={16} />
                {`Start ${plan.trialDays}-day free trial`}
              </button>
            ))}
          <button
            type="button"
            data-testid={`subscription-subscribe-btn-${key}`}
            onClick={() => onSubscribe(plan.key, coupon?.code)}
            disabled={Boolean(subscribing) || startingTrial}
            className="w-full gold-btn rounded-full py-2.5 font-bold mt-2 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {subscribing === plan.key ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {subscribing === plan.key ? "Starting…" : isTrialingHere ? "Subscribe now" : isPremium ? "Switch plan" : "Subscribe"}
          </button>
        </>
      )}
    </div>
  );
}

// Wraps a linked Monthly/Annual pair (admin-set — see plansController.ts::
// setSymmetricPlanLink) as ONE card with an internal toggle, instead of two
// separate always-visible cards — for two plans that are really the same
// premium tier at two billing periods, a toggle reads far better than
// forcing the user to compare two cards side by side. Delegates everything
// else (coupon, trial, subscribe, subscribed/trialing state) straight to
// PremiumPlanCard for whichever plan is currently selected, so none of that
// logic is duplicated.
function LinkedPlanCard({ monthly, annual, isPremium, currentPlanKey, subscriptionStatus, hasUsedTrial, subscribing, startingTrial, onSubscribe, onStartTrial }) {
  // Defaults to whichever variant is the user's actual current plan, so a
  // Premium Annual subscriber lands on "Annual" already selected instead of
  // seeing "Subscribe" for the wrong interval on first render.
  const [billingInterval, setBillingInterval] = useState(currentPlanKey === annual.key ? "year" : "month");
  const selected = billingInterval === "year" ? annual : monthly;

  // "Save N%" comparing 12x the monthly price against the annual price —
  // only shown once there's a genuine saving to report.
  let savingsPercent = null;
  if (monthly.pricePaise > 0) {
    const fullYearAtMonthlyRate = monthly.pricePaise * 12;
    if (fullYearAtMonthlyRate > annual.pricePaise) {
      savingsPercent = Math.round((1 - annual.pricePaise / fullYearAtMonthlyRate) * 100);
    }
  }

  return (
    <PremiumPlanCard
      plan={selected}
      testKey={monthly.key}
      isPremium={isPremium}
      currentPlanKey={currentPlanKey}
      subscriptionStatus={subscriptionStatus}
      hasUsedTrial={hasUsedTrial}
      subscribing={subscribing}
      startingTrial={startingTrial}
      onSubscribe={onSubscribe}
      onStartTrial={onStartTrial}
      toggle={{ billingInterval, setBillingInterval, savingsPercent }}
    />
  );
}

// Groups premium plans into display units: an admin-linked Monthly/Annual
// pair becomes ONE group (rendered by LinkedPlanCard), everything else
// stays its own single-plan group (rendered by PremiumPlanCard directly) —
// see SubscriptionPlan.ts's own comment on linkedPlanKey. A dangling link
// (the partner isn't in this list — e.g. it was archived) is treated as
// unlinked rather than erroring, so the plan still shows as its own card.
function groupPremiumPlans(premiumPlans) {
  const byKey = new Map(premiumPlans.map((p) => [p.key, p]));
  const seen = new Set();
  const groups = [];
  for (const plan of premiumPlans) {
    if (seen.has(plan.key)) continue;
    const partner = plan.linkedPlanKey ? byKey.get(plan.linkedPlanKey) : null;
    if (partner && !seen.has(partner.key)) {
      seen.add(plan.key);
      seen.add(partner.key);
      const monthly = plan.interval === "month" ? plan : partner;
      const annual = plan.interval === "year" ? plan : partner;
      groups.push({ groupKey: `${monthly.key}__${annual.key}`, monthly, annual });
    } else {
      seen.add(plan.key);
      groups.push({ groupKey: plan.key, single: plan });
    }
  }
  return groups;
}

/**
 * The user's own plan screen (Phase 6a of docs/ADMIN_PANEL_PLAN.md §7,
 * redesigned per later product requests) — one card per plan, Freemium
 * first then EVERY active premium plan the admin has published (no
 * Monthly/Annual toggle hiding any of them — an admin can publish as many
 * premium plans as they like and every one stays visible here), a
 * payment-free one-time trial claim per eligible plan, and usage kept
 * behind a "See usage" toggle rather than always shown. Mirrors
 * useDownloadReport.js's real-vs-mock Razorpay split exactly (see
 * startSubscription's own comment on the backend) for the paid Subscribe
 * path — `mock: true` means no real RAZORPAY_KEY_ID/SECRET is configured,
 * so this shows an inline "simulate" confirm instead of loading real
 * Checkout.js. The trial path never touches Razorpay at all — see
 * subscriptionService.ts::startFreeTrial's own comment.
 */
export default function Subscription() {
  const { user, goBack, entitlements, refreshEntitlements } = useDive();
  const [plans, setPlans] = useState(null);
  const [subscribing, setSubscribing] = useState(null); // planKey currently being subscribed to
  const [startingTrial, setStartingTrial] = useState(false);
  const [mockPending, setMockPending] = useState(null); // { planKey, subscriptionId, couponCode }
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [notifyRazorpayNow, setNotifyRazorpayNow] = useState(false);
  const [invoices, setInvoices] = useState(null);
  const [showUsage, setShowUsage] = useState(false);

  useEffect(() => {
    refreshEntitlements();
    api
      .get("/subscriptions/plans")
      .then(({ data }) => setPlans(data.plans))
      .catch(() => setPlans([]));
    api
      .get("/subscriptions/invoices")
      .then(({ data }) => setInvoices(data.invoices))
      .catch(() => setInvoices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const freemiumPlan = plans?.find((p) => p.key === "freemium");
  // Every published, active premium plan — not just one picked by a billing
  // -period toggle, which used to silently hide any plan sharing an
  // interval with another (e.g. two Monthly plans: only the first one
  // `.find()` happened to match ever showed).
  const premiumPlans = plans?.filter((p) => p.key !== "freemium") ?? [];
  // An admin-linked Monthly/Annual pair collapses to ONE group — see
  // groupPremiumPlans's own comment.
  const premiumGroups = groupPremiumPlans(premiumPlans);
  // Fits every card on one row, up to 4 — a linked Monthly/Annual pair only
  // counts once (it's one card). Beyond 4, wraps to further rows of up to 4
  // rather than cramming a 5th+ card into an illegibly narrow column.
  const totalPlanCards = (freemiumPlan ? 1 : 0) + premiumGroups.length;
  const plansGridColsClass = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[totalPlanCards] || "grid-cols-4";

  // Mirrors useDownloadReport.js's triggerBlobDownload — a plain <a href>
  // pointing at the API can't carry the Authorization header (it lives in
  // JS memory, not a cookie a browser navigation sends automatically), so
  // this endpoint has to be fetched through the authenticated `api` client
  // and turned into a local blob URL instead.
  async function downloadInvoice(invoiceId, number) {
    const res = await api.get(`/subscriptions/invoices/${invoiceId}/pdf`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async function verify(planKey, paymentId, subscriptionId, signature, couponCode) {
    await api.post("/subscriptions/verify", { planKey, razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature, ...(couponCode ? { couponCode } : {}) });
    setMockPending(null);
    setSubscribing(null);
    await refreshEntitlements();
    api
      .get("/subscriptions/invoices")
      .then(({ data }) => setInvoices(data.invoices))
      .catch(() => undefined);
  }

  async function subscribe(planKey, couponCode) {
    setError("");
    setSubscribing(planKey);
    try {
      const { data: start } = await api.post("/subscriptions", { planKey, ...(couponCode ? { couponCode } : {}) });
      if (start.mock) {
        setMockPending({ planKey, subscriptionId: start.subscriptionId, couponCode });
        setSubscribing(null);
        return;
      }

      await loadRazorpayCheckout();
      const rzp = new window.Razorpay({
        key: start.keyId,
        subscription_id: start.subscriptionId,
        name: "DIVVE",
        description: "Divve Premium",
        prefill: { name: user?.name, email: user?.email, contact: user?.mobile },
        theme: { color: "#E3B856" },
        handler: (response) => {
          verify(planKey, response.razorpay_payment_id, response.razorpay_subscription_id, response.razorpay_signature, couponCode).catch(() => {
            setError("Payment succeeded, but we couldn't confirm it just now. Reopen this page in a minute — it won't charge you again.");
            setSubscribing(null);
          });
        },
        modal: { ondismiss: () => setSubscribing(null) },
      });
      rzp.on("payment.failed", (resp) => {
        setError(resp?.error?.description || "Payment failed. Please try again.");
        setSubscribing(null);
      });
      rzp.open();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't start the subscription. Please try again.");
      setSubscribing(null);
    }
  }

  // Genuinely payment-free — no Razorpay order, no Checkout.js, no card
  // ever requested. See subscriptionService.ts::startFreeTrial. Claiming is
  // one-time-ever, so it's confirmed first (see each card's own confirm
  // banner) rather than firing the instant the button is clicked.
  async function startTrial(planKey) {
    setError("");
    setStartingTrial(true);
    try {
      await api.post("/subscriptions/trial/start", { planKey });
      await refreshEntitlements();
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't start your free trial. Please try again.");
      return false;
    } finally {
      setStartingTrial(false);
    }
  }

  async function confirmMock() {
    if (!mockPending) return;
    setSubscribing(mockPending.planKey);
    try {
      await verify(mockPending.planKey, `mock_payment_${mockPending.subscriptionId}`, mockPending.subscriptionId, "mock", mockPending.couponCode);
    } catch {
      setError("Couldn't complete the simulated subscription.");
      setSubscribing(null);
    }
  }

  // Cancelling is a deliberate, confirmed action (see the cancel confirm
  // banner below) — never fires straight from the initial button click.
  // Only ever offered for a real paid subscription (see the render below) —
  // a trial has no auto-renew behind it to turn off in the first place, so
  // there's nothing for this to meaningfully do there. By default this only
  // records local intent — Razorpay isn't actually told until close to
  // renewal (see subscriptionService.ts::cancelSubscriptionDoc) — unless
  // the user explicitly checked "stop billing with Razorpay right now
  // instead".
  async function cancel() {
    setCancelling(true);
    setError("");
    try {
      await api.post("/subscriptions/cancel", { atPeriodEnd: true, notifyRazorpayNow });
      setShowCancelConfirm(false);
      setNotifyRazorpayNow(false);
      await refreshEntitlements();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't cancel your subscription.");
      setShowCancelConfirm(false);
    } finally {
      setCancelling(false);
    }
  }

  // Undoes an at-period-end cancel — a single click, no confirm needed
  // (turning auto-renew back ON is the low-stakes direction).
  async function reactivate() {
    setReactivating(true);
    setError("");
    try {
      await api.post("/subscriptions/reactivate");
      await refreshEntitlements();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't turn auto-renew back on.");
    } finally {
      setReactivating(false);
    }
  }

  if (!entitlements || !plans) {
    return (
      <div className="min-h-full dive-app-surface flex items-center justify-center" data-testid="subscription-loading">
        <Loader2 size={20} className="animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  const { isPremium, planKey: currentPlanKey, planName, subscription, usage, entitlements: limits, hasUsedTrial, cancelNoticeBufferHours, reportAccess } = entitlements;
  // When Razorpay will actually be told to stop billing, absent an explicit
  // immediate-notify cancel — see subscriptionService.ts::cancelSubscriptionDoc.
  const cancelNoticeDate =
    subscription && cancelNoticeBufferHours != null
      ? new Date(new Date(subscription.currentPeriodEnd).getTime() - cancelNoticeBufferHours * 60 * 60 * 1000)
      : null;
  // Once Razorpay has actually been notified (either the buffer window
  // sweep already ran, or the user chose the immediate option), there's
  // nothing left to reactivate — see reactivateSubscription's own comment.
  const autoRenewRestorable = subscription?.cancelAtPeriodEnd && !subscription?.razorpayCancelRequestedAt;
  const autoRenewLockedOff = subscription?.cancelAtPeriodEnd && Boolean(subscription?.razorpayCancelRequestedAt);
  // Nothing to show when there's genuinely no complimentary benefit at all
  // (plan grants 0 and no admin grant exists) — a "0 / 0" row would just be
  // confusing. Plan benefit and any per-user admin grant are already merged
  // into one number server-side (paymentService.ts::getReportComplimentaryStatus)
  // — this never breaks that down or mentions "grant" specifically.
  const showReportComplimentary = reportAccess && (reportAccess.total === null || reportAccess.total > 0);

  return (
    <div className="min-h-full dive-app-surface pb-10" data-testid="subscription-screen">
      <div className="px-6 pt-8 flex items-center gap-3">
        <button data-testid="subscription-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Subscription</h1>
      </div>

      {error && <p className="px-6 mt-3 text-xs text-[var(--red)] font-semibold">{error}</p>}

      {subscription?.status === "past_due" && (
        <div className="px-6 mt-4">
          <div className="rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 p-4 flex items-start gap-3" data-testid="subscription-past-due-banner">
            <AlertTriangle size={18} className="text-[var(--amber)] shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--text-secondary)]">
              <span className="font-bold text-[var(--text-primary)]">We couldn't process your last payment.</span> Please update your payment method — your Premium access continues for now, but will be cancelled soon if this isn't resolved.
            </p>
          </div>
        </div>
      )}

      <div className="px-6 mt-5">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid="subscription-current-plan-card">
          <div className="flex items-center gap-2 mb-1">
            {isPremium && <Crown size={16} className="text-[var(--gold-b)]" />}
            <p className="font-heading font-black text-lg">{planName}</p>
          </div>
          {subscription && (
            <>
              {/* Explicit, unambiguous validity date — kept separate from
                  the status-framed note below (which explains WHY that date
                  matters: a trial ending, a renewal, or a cancellation), so
                  "how long is my plan good for" never depends on parsing
                  that framing. */}
              <p className="text-xs font-bold text-[var(--text-primary)] mt-1" data-testid="subscription-valid-until">
                Valid until {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN")}
              </p>
              <p
                className={subscription.cancelAtPeriodEnd ? "text-xs font-bold text-[var(--amber)]" : "text-xs text-[var(--text-secondary)]"}
                data-testid="subscription-period-note"
              >
                {subscription.cancelAtPeriodEnd
                  ? `Auto-renew is off — plan stays active until ${new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN")}`
                  : `${subscription.status === "trialing" ? "Trial ends" : "Renews"} on ${new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN")}`}
              </p>
              {autoRenewLockedOff && (
                <p className="text-[11px] text-[var(--text-tertiary)] mt-1" data-testid="subscription-cannot-reactivate-note">
                  Razorpay has already been told to stop billing, so this can't be undone — you're welcome to subscribe again once your plan ends.
                </p>
              )}
            </>
          )}
          {/* Cancelling only means anything for a real paid subscription —
              a trial has no auto-renew behind it to turn off (see
              subscriptionService.ts's own comment), so the control is
              simply not offered while trialing. */}
          {isPremium && subscription && subscription.status !== "trialing" && (
            autoRenewRestorable ? (
              <button
                type="button"
                data-testid="subscription-reactivate-btn"
                onClick={reactivate}
                disabled={reactivating}
                className="mt-3 text-xs font-bold text-[var(--dive-blue)] hover:underline disabled:opacity-50"
              >
                {reactivating ? "Turning back on…" : "Turn auto-renew back on"}
              </button>
            ) : autoRenewLockedOff ? null : showCancelConfirm ? (
              <div className="mt-3 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-3" data-testid="subscription-cancel-confirm">
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  Turn off auto-renew? This won't end your current plan — you'll keep Premium access until{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN")}. You just won't be charged again after that.
                </p>
                {/* Explains the deferred-notify design (see
                    subscriptionService.ts::cancelSubscriptionDoc) so a user
                    who reactivates within the buffer window understands why
                    that's guaranteed to work, and gives them an explicit way
                    to opt out of the wait if they'd rather lock it in now. */}
                <p className="text-[11px] text-[var(--text-tertiary)] mb-2" data-testid="subscription-cancel-buffer-note">
                  {cancelNoticeDate
                    ? `We won't tell Razorpay to actually stop billing until ${cancelNoticeDate.toLocaleDateString("en-IN")} (shortly before your renewal) — so if you change your mind before then, turning auto-renew back on is instant and free.`
                    : "We won't tell Razorpay to actually stop billing until shortly before your renewal — so if you change your mind before then, turning auto-renew back on is instant and free."}
                </p>
                <label className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)] mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="subscription-cancel-notify-now-checkbox"
                    checked={notifyRazorpayNow}
                    onChange={(e) => setNotifyRazorpayNow(e.target.checked)}
                    disabled={cancelling}
                    className="mt-0.5"
                  />
                  <span>Stop billing with Razorpay right now instead — once confirmed, this can't be undone.</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="subscription-cancel-confirm-btn"
                    onClick={cancel}
                    disabled={cancelling}
                    className="flex-1 bg-[var(--red)] text-white rounded-full py-2 text-xs font-bold disabled:opacity-60"
                  >
                    {cancelling ? "Turning off…" : "Yes, turn off"}
                  </button>
                  <button
                    type="button"
                    data-testid="subscription-cancel-dismiss-btn"
                    onClick={() => {
                      setShowCancelConfirm(false);
                      setNotifyRazorpayNow(false);
                    }}
                    disabled={cancelling}
                    className="flex-1 border border-[var(--border)] rounded-full py-2 text-xs font-bold disabled:opacity-60"
                  >
                    No, keep it
                  </button>
                </div>
              </div>
            ) : (
              <button data-testid="subscription-cancel-btn" onClick={() => setShowCancelConfirm(true)} className="mt-3 text-xs font-bold text-[var(--red)] hover:underline">
                Cancel auto-renew
              </button>
            )
          )}

          {(usage || showReportComplimentary) && (
            <button
              type="button"
              data-testid="subscription-usage-toggle-btn"
              onClick={() => setShowUsage((s) => !s)}
              className="mt-3 flex items-center gap-1 text-xs font-bold text-[var(--dive-blue)]"
            >
              {showUsage ? "Hide usage" : "See usage"} {showUsage ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          {showUsage && (
            <>
              {usage && (
                <div className="mt-3 rounded-xl border border-[var(--border)] overflow-hidden" data-testid="subscription-usage-table">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[var(--text-tertiary)] uppercase tracking-wide bg-[var(--surface-card-hover)]">
                        <th className="px-3 py-2 font-bold">Feature</th>
                        <th className="px-3 py-2 font-bold text-right">This week</th>
                        <th className="px-3 py-2 font-bold text-right">This month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(usage).map(([key, u]) => {
                        const fields = LIMIT_FIELDS[key];
                        return (
                          <tr key={key} className="border-t border-[var(--border)]" data-testid={`subscription-usage-row-${key}`}>
                            <td className="px-3 py-2 text-[var(--text-secondary)]">{USAGE_LABELS[key]}</td>
                            <td className="px-3 py-2 text-right font-bold">
                              {u.weekly} / {fmtLimit(limits?.[fields.weekly])}
                            </td>
                            <td className="px-3 py-2 text-right font-bold">
                              {u.monthly} / {fmtLimit(limits?.[fields.monthly])}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Resilience-report complimentary status — a lifetime count,
                  not weekly/monthly like the table above, so it gets its own
                  small line rather than a mismatched row in that table.
                  `used`/`total` already have any admin per-user grant merged
                  in server-side; this never says "grant" or shows a
                  breakdown, just the final number. */}
              {showReportComplimentary && (
                <p className="mt-3 text-xs text-[var(--text-secondary)]" data-testid="subscription-report-complimentary">
                  Resilience report downloads: <span className="font-bold text-[var(--text-primary)]">{reportAccess.used} / {reportAccess.total === null ? "Unlimited" : reportAccess.total}</span> used
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="px-6 mt-6">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Plans</p>

        {/* items-stretch (the grid default) makes every card in a row match
            its tallest neighbor. Column count is dynamic (up to 4 — see
            plansGridColsClass) so up to 4 cards always sit side by side
            instead of wrapping after 2; nothing here is ever hidden behind
            a toggle except an admin-linked Monthly/Annual pair, which is
            deliberately ONE card by design (LinkedPlanCard). */}
        <div className={`grid ${plansGridColsClass} gap-2`}>
          {freemiumPlan && (
            <div
              className={`relative h-full rounded-2xl bg-[var(--surface-card)] p-3 ${!isPremium ? "border-2 border-[var(--gold-b)]" : "border border-[var(--border)]"}`}
              data-testid="subscription-plan-freemium"
            >
              {!isPremium && (
                <span className="absolute -top-2.5 right-2 bg-[var(--gold-b)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full" data-testid="subscription-plan-freemium-subscribed-badge">
                  Subscribed
                </span>
              )}
              <p className="font-heading font-black text-xs leading-tight">{freemiumPlan.name}</p>
              <p className="text-lg font-black mt-1 leading-tight">Free</p>
              {!isPremium && <p className="text-[10px] font-bold text-[var(--dive-blue)] mt-1.5" data-testid="subscription-plan-freemium-current">Current plan</p>}
              <ul className="mt-2 space-y-1">
                {(freemiumPlan.benefits || []).map((b, i) => (
                  <li key={i} className="flex items-start gap-1 text-[10px] text-[var(--text-secondary)]">
                    <Check size={11} className="text-[var(--green)] shrink-0 mt-0.5" /> {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {premiumGroups.map((group) =>
            group.single ? (
              <PremiumPlanCard
                key={group.groupKey}
                plan={group.single}
                isPremium={isPremium}
                currentPlanKey={currentPlanKey}
                subscriptionStatus={subscription?.status}
                hasUsedTrial={hasUsedTrial}
                subscribing={subscribing}
                startingTrial={startingTrial}
                onSubscribe={subscribe}
                onStartTrial={startTrial}
              />
            ) : (
              <LinkedPlanCard
                key={group.groupKey}
                monthly={group.monthly}
                annual={group.annual}
                isPremium={isPremium}
                currentPlanKey={currentPlanKey}
                subscriptionStatus={subscription?.status}
                hasUsedTrial={hasUsedTrial}
                subscribing={subscribing}
                startingTrial={startingTrial}
                onSubscribe={subscribe}
                onStartTrial={startTrial}
              />
            )
          )}
        </div>
      </div>

      {invoices && invoices.length > 0 && (
        <div className="px-6 mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Invoices</p>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] divide-y divide-[var(--border)]" data-testid="subscription-invoices-list">
            {invoices.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => downloadInvoice(inv.id, inv.number)}
                data-testid={`subscription-invoice-${inv.id}`}
                className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--surface-card-hover)] text-left"
              >
                <div>
                  <p className="font-bold">{inv.number}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">{new Date(inv.issuedAt).toLocaleDateString("en-IN")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{fmtINR(inv.totalPaise / 100)}</span>
                  <Download size={14} className="text-[var(--text-tertiary)]" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mockPending && (
        <div className="px-6 mt-4">
          <div className="rounded-2xl border border-dashed border-[var(--dive-blue)]/40 bg-[var(--dive-blue)]/10 p-4 text-center" data-testid="subscription-mock-banner">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--dive-blue-dark)] mb-1">🧪 Dev Mode — Razorpay isn't configured</p>
            <p className="text-xs text-[var(--text-secondary)] mb-3">No real payment will happen. Simulate subscribing?</p>
            <div className="flex gap-2">
              <button data-testid="subscription-mock-confirm-btn" onClick={confirmMock} disabled={Boolean(subscribing)} className="flex-1 gold-btn rounded-full py-2.5 text-sm font-bold disabled:opacity-60">
                {subscribing ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Simulate subscribe"}
              </button>
              <button data-testid="subscription-mock-cancel-btn" onClick={() => setMockPending(null)} disabled={Boolean(subscribing)} className="flex-1 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-2.5 text-sm font-bold disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
