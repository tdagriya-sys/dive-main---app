import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Subscription from "./Subscription";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));
jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const PLANS = [
  { key: "freemium", name: "Freemium", pricePaise: 0, interval: "one_time", trialDays: 0, benefits: ["Free forever", "2 edits/week"] },
  { key: "premium_monthly", name: "Premium (Monthly)", pricePaise: 11900, interval: "month", trialDays: 15, benefits: ["Unlimited edits", "Priority support"] },
  { key: "premium_annual", name: "Premium (Annual)", pricePaise: 109900, interval: "year", trialDays: 15, benefits: ["Unlimited edits", "~23% cheaper"] },
];
// Regression fixture: two plans sharing the same interval — the old
// billing-toggle design used `.find()` to pick ONE plan per interval, so a
// second Monthly plan silently disappeared from the user-facing screen the
// moment an admin created it, even though it existed and was publishable.
const PLANS_TWO_MONTHLY = [
  ...PLANS,
  { key: "premium_elite_monthly", name: "Premium Elite (Monthly)", pricePaise: 19900, interval: "month", trialDays: 0, benefits: ["Everything in Premium", "White-glove support"] },
];
// An admin-linked Monthly/Annual pair — should render as ONE toggle card,
// not two separate cards.
const PLANS_LINKED = [
  PLANS[0],
  { ...PLANS[1], linkedPlanKey: "premium_annual" },
  { ...PLANS[2], linkedPlanKey: "premium_monthly" },
];
const FREEMIUM_ENTITLEMENTS = {
  planKey: "freemium",
  planName: "Freemium",
  isPremium: false,
  subscription: null,
  hasUsedTrial: false,
  entitlements: { botScanWeekly: 1, botScanMonthly: 3, docUploadWeekly: 1, docUploadMonthly: 3, portfolioEditWeekly: 2, portfolioEditMonthly: 5 },
  usage: { bot_scan: { weekly: 0, monthly: 1 }, doc_upload: { weekly: 1, monthly: 2 }, portfolio_edit: { weekly: 0, monthly: 0 } },
  reportAccess: { total: 0, used: 0, remaining: 0, unlockedForCurrentPortfolio: false },
};
const PREMIUM_ENTITLEMENTS = {
  planKey: "premium_monthly",
  planName: "Premium (Monthly)",
  isPremium: true,
  hasUsedTrial: true,
  subscription: { status: "active", currentPeriodEnd: "2026-12-01T00:00:00.000Z", cancelAtPeriodEnd: false, razorpayCancelRequestedAt: null },
  entitlements: { botScanWeekly: null, botScanMonthly: null, docUploadWeekly: null, docUploadMonthly: null, portfolioEditWeekly: null, portfolioEditMonthly: null },
  usage: { bot_scan: { weekly: 2, monthly: 5 }, doc_upload: { weekly: 0, monthly: 1 }, portfolio_edit: { weekly: 3, monthly: 9 } },
  cancelNoticeBufferHours: 48,
  reportAccess: { total: 2, used: 1, remaining: 1, unlockedForCurrentPortfolio: false },
};
// A trial is a separate thing from a real paid subscription now — same
// planKey/isPremium shape as PREMIUM_ENTITLEMENTS, but subscription.status
// is "trialing" instead of "active".
const TRIALING_ENTITLEMENTS = {
  ...PREMIUM_ENTITLEMENTS,
  hasUsedTrial: true,
  subscription: { status: "trialing", currentPeriodEnd: "2026-12-01T00:00:00.000Z", cancelAtPeriodEnd: false },
};

function mockContext(overrides = {}) {
  useDive.mockReturnValue({
    user: { name: "Test User", email: "test@example.com", mobile: "9876543210" },
    goBack: jest.fn(),
    entitlements: FREEMIUM_ENTITLEMENTS,
    refreshEntitlements: jest.fn(),
    ...overrides,
  });
}

function mockGetOk(overrides = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/subscriptions/plans") return Promise.resolve({ data: { plans: overrides.plans || PLANS } });
    if (url === "/subscriptions/invoices") return Promise.resolve({ data: { invoices: overrides.invoices || [] } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("Subscription screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOk();
  });

  it("shows a loading state until entitlements and plans are both available", () => {
    mockContext({ entitlements: null });
    render(<Subscription />);
    expect(screen.getByTestId("subscription-loading")).toBeInTheDocument();
  });

  // Requirement: every plan gets its own card — Freemium plus EVERY active
  // premium plan the admin has published, none hidden behind a toggle.
  it("shows Freemium and every premium plan side by side, each with its own benefits", async () => {
    mockContext();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-current-plan-card")).toHaveTextContent("Freemium"));

    expect(screen.getByTestId("subscription-plan-freemium")).toHaveTextContent("Free forever");
    expect(screen.getByTestId("subscription-plan-freemium-current")).toHaveTextContent("Current plan");
    expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("Premium (Monthly)");
    expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("Unlimited edits");
    expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("₹119");
    expect(screen.getByTestId("subscription-plan-premium-premium_annual")).toHaveTextContent("Premium (Annual)");
    expect(screen.getByTestId("subscription-plan-premium-premium_annual")).toHaveTextContent("₹1,099");
  });

  // Regression: adding a second plan on the same billing interval must not
  // remove the earlier one from the user-facing screen.
  it("shows both plans when two premium plans share the same interval (e.g. two Monthly plans)", async () => {
    mockContext();
    mockGetOk({ plans: PLANS_TWO_MONTHLY });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
    expect(screen.getByTestId("subscription-plan-premium-premium_elite_monthly")).toHaveTextContent("Premium Elite (Monthly)");
    expect(screen.getByTestId("subscription-plan-premium-premium_elite_monthly")).toHaveTextContent("₹199");
  });

  // Requirement: an admin-linked Monthly/Annual pair renders as ONE card
  // with an internal toggle, not two separate always-visible cards, with a
  // correctly-calculated discount tag when Annual is selected.
  describe("a linked Monthly/Annual pair renders as one toggle card", () => {
    it("shows one card (keyed on the monthly plan) with a Monthly/Annual toggle, defaulting to Monthly", async () => {
      mockContext();
      mockGetOk({ plans: PLANS_LINKED });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

      // Only ONE card for the pair — no separate "premium_annual"-keyed card.
      expect(screen.queryByTestId("subscription-plan-premium-premium_annual")).not.toBeInTheDocument();
      expect(screen.getByTestId("subscription-plan-toggle-premium_monthly")).toBeInTheDocument();
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("₹119");
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("Unlimited edits");
    });

    it("switches price and benefits when toggled to Annual, showing a correctly-calculated discount tag", async () => {
      mockContext();
      mockGetOk({ plans: PLANS_LINKED });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("₹119"));
      expect(screen.queryByTestId("subscription-plan-discount-badge-premium_monthly")).not.toBeInTheDocument();

      await u.click(screen.getByTestId("subscription-plan-toggle-annual-premium_monthly"));
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("₹1,099");
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("~23% cheaper");
      // 11900*12 = 142800 vs 109900 -> ~23% cheaper.
      expect(screen.getByTestId("subscription-plan-discount-badge-premium_monthly")).toHaveTextContent("Save 23%");

      await u.click(screen.getByTestId("subscription-plan-toggle-monthly-premium_monthly"));
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toHaveTextContent("₹119");
      expect(screen.queryByTestId("subscription-plan-discount-badge-premium_monthly")).not.toBeInTheDocument();
    });

    it("defaults to Annual selected when the user's current plan is the Annual side of the pair", async () => {
      mockContext({ entitlements: { ...PREMIUM_ENTITLEMENTS, planKey: "premium_annual", planName: "Premium (Annual)" } });
      mockGetOk({ plans: PLANS_LINKED });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly-subscribed-badge")).toBeInTheDocument();
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly-current-note")).toHaveTextContent("This is your active plan");
    });

    it("subscribing sends whichever plan key is currently selected by the toggle", async () => {
      mockContext();
      mockGetOk({ plans: PLANS_LINKED });
      api.post.mockResolvedValue({ data: { subscriptionId: "mock_sub_1", mock: true } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-toggle-annual-premium_monthly")).toBeInTheDocument());

      await u.click(screen.getByTestId("subscription-plan-toggle-annual-premium_monthly"));
      await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions", { planKey: "premium_annual" }));
    });

    it("a plan that isn't linked to anything still renders as its own separate card alongside a linked pair", async () => {
      mockContext();
      mockGetOk({ plans: [...PLANS_LINKED, { key: "premium_elite_monthly", name: "Premium Elite (Monthly)", pricePaise: 19900, interval: "month", trialDays: 0, benefits: [] }] });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_elite_monthly")).toBeInTheDocument();
      expect(screen.queryByTestId("subscription-plan-toggle-premium_elite_monthly")).not.toBeInTheDocument(); // no toggle — it's unlinked
    });
  });

  // Requirement: up to 4 cards fit side by side without wrapping.
  describe("plan grid column count", () => {
    it("uses grid-cols-2 for Freemium + one premium plan", async () => {
      mockContext();
      mockGetOk({ plans: [PLANS[0], PLANS[1]] });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly").parentElement.className).toContain("grid-cols-2");
    });

    it("uses grid-cols-3 for Freemium + two premium plans", async () => {
      mockContext();
      render(<Subscription />); // default PLANS fixture: Freemium + Monthly + Annual = 3 cards
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly").parentElement.className).toContain("grid-cols-3");
    });

    it("uses grid-cols-4 for Freemium + three premium plans", async () => {
      mockContext();
      mockGetOk({ plans: PLANS_TWO_MONTHLY });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly").parentElement.className).toContain("grid-cols-4");
    });

    it("a linked pair counts as ONE card toward the column count", async () => {
      mockContext();
      mockGetOk({ plans: PLANS_LINKED }); // Freemium + 1 linked pair = 2 cards
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-plan-premium-premium_monthly").parentElement.className).toContain("grid-cols-2");
    });
  });

  // Requirement: a Premium user should still see every plan card (not have
  // them removed) — the one they're subscribed to is highlighted gold with
  // a "Subscribed" badge instead of a Subscribe button.
  it("keeps every plan card for a Premium user, highlighting the subscribed one, with a cancel button", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-current-plan-card")).toHaveTextContent("Premium (Monthly)"));

    expect(screen.getByTestId("subscription-plan-freemium")).toBeInTheDocument();
    expect(screen.queryByTestId("subscription-plan-freemium-subscribed-badge")).not.toBeInTheDocument();

    const premiumCard = screen.getByTestId("subscription-plan-premium-premium_monthly");
    expect(premiumCard).toBeInTheDocument();
    expect(screen.getByTestId("subscription-plan-premium-premium_monthly-subscribed-badge")).toBeInTheDocument();
    expect(screen.getByTestId("subscription-plan-premium-premium_monthly-current-note")).toHaveTextContent("This is your active plan");
    expect(screen.queryByTestId("subscription-subscribe-btn-premium_monthly")).not.toBeInTheDocument();
    // The OTHER plan (Annual) is still visible and still offers Subscribe.
    expect(screen.getByTestId("subscription-plan-premium-premium_annual")).toBeInTheDocument();
    expect(screen.getByTestId("subscription-subscribe-btn-premium_annual")).toBeInTheDocument();

    expect(screen.getByTestId("subscription-cancel-btn")).toBeInTheDocument();
  });

  // Requirement: "Your usage this period" must still show for Premium users
  // too — it was previously hidden once isPremium became true.
  it("shows the usage toggle and table for a Premium user as well", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
    await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
    expect(screen.getByTestId("subscription-usage-table")).toBeInTheDocument();
    expect(screen.getByTestId("subscription-usage-row-portfolio_edit")).toHaveTextContent("3 / Unlimited");
  });

  // Requirement: switching to a DIFFERENT plan while Premium is still
  // offered — only the CURRENT plan shows the "already subscribed" state.
  it("still offers Subscribe (as a plan switch) on the Annual card for a Premium Monthly user", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_annual")).toBeInTheDocument());

    expect(screen.queryByTestId("subscription-plan-premium-premium_annual-subscribed-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("subscription-subscribe-btn-premium_annual")).toHaveTextContent("Switch plan");
    expect(screen.getByTestId("subscription-plan-switch-note-premium_annual")).toBeInTheDocument();
  });

  // Requirement: a trial is a separate thing from a real paid subscription
  // — while trialing, the card must show "Trialing" (not "Subscribed") and
  // must still offer Subscribe, so the user can convert the trial into a
  // real paid subscription of the very same plan.
  it("shows a 'Trialing' badge (not 'Subscribed') and keeps Subscribe open while on a trial", async () => {
    mockContext({ entitlements: TRIALING_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

    expect(screen.getByTestId("subscription-plan-premium-premium_monthly-trialing-badge")).toHaveTextContent("Trialing");
    expect(screen.queryByTestId("subscription-plan-premium-premium_monthly-subscribed-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subscription-plan-premium-premium_monthly-current-note")).not.toBeInTheDocument();

    expect(screen.getByTestId("subscription-subscribe-btn-premium_monthly")).toHaveTextContent("Subscribe now");
    expect(screen.getByTestId("subscription-plan-switch-note-premium_monthly")).toBeInTheDocument();
  });

  it("subscribing while trialing the same plan calls the normal subscribe flow (clubbing remaining trial days)", async () => {
    mockContext({ entitlements: TRIALING_ENTITLEMENTS });
    api.post.mockResolvedValue({ data: { subscriptionId: "mock_sub_1", mock: true } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-subscribe-btn-premium_monthly")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions", { planKey: "premium_monthly" }));
  });

  // Requirement: the current-plan card should show an explicit validity
  // date for Premium, not just an implicit one folded into the
  // trial/renewal/cancellation framing.
  it("shows an explicit 'Valid until' date on the current-plan card for a Premium subscription", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-valid-until")).toBeInTheDocument());
    expect(screen.getByTestId("subscription-valid-until")).toHaveTextContent("Valid until");
    expect(screen.getByTestId("subscription-valid-until")).toHaveTextContent("1/12/2026");
  });

  // Requirement: the cancel action is about auto-renew, not the current
  // plan — the messaging and the "Cancel auto-renew" button reflect that,
  // and a "Turn auto-renew back on" reactivate control replaces the cancel
  // button once it's off.
  it("hides the cancel button once cancelAtPeriodEnd is already set, offering to turn auto-renew back on instead", async () => {
    mockContext({ entitlements: { ...PREMIUM_ENTITLEMENTS, subscription: { ...PREMIUM_ENTITLEMENTS.subscription, cancelAtPeriodEnd: true } } });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-period-note")).toHaveTextContent("Auto-renew is off"));
    expect(screen.getByTestId("subscription-period-note")).toHaveTextContent("plan stays active until");
    expect(screen.queryByTestId("subscription-cancel-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subscription-cancel-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("subscription-reactivate-btn")).toBeInTheDocument();
  });

  it("reactivates a cancelled subscription with a single click (no confirm needed)", async () => {
    const refreshEntitlements = jest.fn();
    mockContext({ entitlements: { ...PREMIUM_ENTITLEMENTS, subscription: { ...PREMIUM_ENTITLEMENTS.subscription, cancelAtPeriodEnd: true } }, refreshEntitlements });
    api.post.mockResolvedValue({ data: { status: "active", cancelAtPeriodEnd: false } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-reactivate-btn")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-reactivate-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions/reactivate"));
    expect(refreshEntitlements).toHaveBeenCalled();
  });

  // Requirement: a trial has no auto-renew to turn off, so the cancel
  // control (and its reactivate/confirm variants) must never appear for it.
  it("never offers to cancel a free trial (no auto-renew to turn off)", async () => {
    mockContext({ entitlements: TRIALING_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
    expect(screen.queryByTestId("subscription-cancel-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subscription-reactivate-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("subscription-period-note")).toHaveTextContent("Trial ends on");
  });

  // Requirement: cancelling must be confirmed first, not fired straight
  // from the initial click — same for a trial as for a real subscription.
  it("asks for confirmation before cancelling, then cancels and refreshes entitlements", async () => {
    const refreshEntitlements = jest.fn();
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS, refreshEntitlements });
    api.post.mockResolvedValue({ data: { status: "active", cancelAtPeriodEnd: true } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-cancel-btn")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-cancel-btn"));
    expect(api.post).not.toHaveBeenCalledWith("/subscriptions/cancel", expect.anything());
    expect(screen.getByTestId("subscription-cancel-confirm")).toBeInTheDocument();

    await u.click(screen.getByTestId("subscription-cancel-confirm-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions/cancel", { atPeriodEnd: true, notifyRazorpayNow: false }));
    expect(refreshEntitlements).toHaveBeenCalled();
  });

  // Requirement: explain why there's a buffer and exactly when Razorpay will
  // actually be told, plus an explicit opt-out to notify it immediately.
  it("explains the cancel-notice buffer and lets the user opt into an immediate Razorpay cancel", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    api.post.mockResolvedValue({ data: { status: "active", cancelAtPeriodEnd: true, razorpayCancelRequestedAt: null } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-cancel-btn")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-cancel-btn"));
    // currentPeriodEnd 2026-12-01 minus the 48h buffer -> 2026-11-29.
    expect(screen.getByTestId("subscription-cancel-buffer-note")).toHaveTextContent("29/11/2026");
    expect(screen.getByTestId("subscription-cancel-buffer-note")).toHaveTextContent("instant and free");

    await u.click(screen.getByTestId("subscription-cancel-notify-now-checkbox"));
    await u.click(screen.getByTestId("subscription-cancel-confirm-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions/cancel", { atPeriodEnd: true, notifyRazorpayNow: true }));
  });

  // Requirement: once Razorpay has actually been notified, reactivate must
  // not be offered at all (it would only fail) — an honest note explains why.
  it("shows an honest 'can't be undone' note instead of a reactivate button once Razorpay has been notified", async () => {
    mockContext({
      entitlements: { ...PREMIUM_ENTITLEMENTS, subscription: { ...PREMIUM_ENTITLEMENTS.subscription, cancelAtPeriodEnd: true, razorpayCancelRequestedAt: "2026-11-29T00:00:00.000Z" } },
    });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-period-note")).toHaveTextContent("Auto-renew is off"));
    expect(screen.getByTestId("subscription-cannot-reactivate-note")).toHaveTextContent("can't be undone");
    expect(screen.queryByTestId("subscription-reactivate-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subscription-cancel-btn")).not.toBeInTheDocument();
  });

  it("dismisses the cancel confirmation without cancelling", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-cancel-btn")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-cancel-btn"));
    await u.click(screen.getByTestId("subscription-cancel-dismiss-btn"));
    expect(api.post).not.toHaveBeenCalledWith("/subscriptions/cancel", expect.anything());
    expect(screen.getByTestId("subscription-cancel-btn")).toBeInTheDocument();
  });

  // Requirement: usage is no longer shown directly — it sits behind a "See
  // usage" button on the current-plan card, and now includes the limit
  // alongside the raw count.
  describe("usage behind a toggle, with limits shown", () => {
    it("is hidden until the toggle is clicked, then shows usage paired with its limit", async () => {
      mockContext();
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
      expect(screen.queryByTestId("subscription-usage-table")).not.toBeInTheDocument();

      await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
      expect(screen.getByTestId("subscription-usage-table")).toBeInTheDocument();
      // 0 used this week, weekly limit is 1 (botScanWeekly).
      expect(screen.getByTestId("subscription-usage-row-bot_scan")).toHaveTextContent("0 / 1");
      expect(screen.getByTestId("subscription-usage-row-bot_scan")).toHaveTextContent("1 / 3");
      // portfolioEditWeekly/Monthly are both 2/5 on Freemium.
      expect(screen.getByTestId("subscription-usage-row-portfolio_edit")).toHaveTextContent("0 / 2");
      expect(screen.getByTestId("subscription-usage-row-portfolio_edit")).toHaveTextContent("0 / 5");
    });

    it("shows Unlimited for a null limit", async () => {
      mockContext({
        entitlements: {
          ...FREEMIUM_ENTITLEMENTS,
          entitlements: { ...FREEMIUM_ENTITLEMENTS.entitlements, portfolioEditWeekly: null, portfolioEditMonthly: null },
        },
      });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
      await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
      expect(screen.getByTestId("subscription-usage-row-portfolio_edit")).toHaveTextContent("0 / Unlimited");
    });

    // Superseded — see "shows the usage toggle and table for a Premium user
    // as well" above: usage is now shown for Premium too, not hidden.
  });

  // Requirement: show real complimentary-report status (plan benefit + any
  // admin grant, already merged into one number server-side) instead of
  // nothing — and never mention "grant" separately or show 0/0.
  describe("complimentary report downloads", () => {
    it("shows used/total once the toggle is open, when there's a real benefit", async () => {
      mockContext({ entitlements: PREMIUM_ENTITLEMENTS }); // reportAccess: {total: 2, used: 1, ...}
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
      expect(screen.queryByTestId("subscription-report-complimentary")).not.toBeInTheDocument();

      await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
      expect(screen.getByTestId("subscription-report-complimentary")).toHaveTextContent("1 / 2");
      expect(screen.getByTestId("subscription-report-complimentary")).not.toHaveTextContent("grant");
    });

    it("shows 'Unlimited' when the plan grants unlimited complimentary downloads", async () => {
      mockContext({ entitlements: { ...PREMIUM_ENTITLEMENTS, reportAccess: { total: null, used: 4, remaining: null, unlockedForCurrentPortfolio: false } } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
      await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
      expect(screen.getByTestId("subscription-report-complimentary")).toHaveTextContent("4 / Unlimited");
    });

    // Nothing to show — and no "0" either — when there's genuinely no
    // complimentary benefit at all (no plan benefit, no admin grant).
    it("shows nothing at all when there's no complimentary benefit (total: 0)", async () => {
      mockContext(); // FREEMIUM_ENTITLEMENTS — reportAccess: {total: 0, ...}
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
      await u.click(screen.getByTestId("subscription-usage-toggle-btn"));
      expect(screen.queryByTestId("subscription-report-complimentary")).not.toBeInTheDocument();
      expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    });

    // Still offers "See usage" even for a Freemium user with usage data but
    // no report benefit — this row alone shouldn't gate the toggle's
    // existence when `usage` is also present (it already was).
    it("still shows the usage toggle when there's a report benefit but no metered usage object", async () => {
      mockContext({ entitlements: { ...FREEMIUM_ENTITLEMENTS, usage: undefined, reportAccess: { total: 3, used: 0, remaining: 3, unlockedForCurrentPortfolio: false } } });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-usage-toggle-btn")).toBeInTheDocument());
    });
  });

  // Requirement: a free trial claim never touches Razorpay/mock-checkout —
  // it's a direct, payment-free call, and the button disappears once used.
  describe("free trial", () => {
    it("shows a trial button alongside Subscribe when the trial hasn't been used yet", async () => {
      mockContext();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toHaveTextContent("Start 15-day free trial");
      expect(screen.getByTestId("subscription-subscribe-btn-premium_monthly")).toBeInTheDocument();
    });

    // Requirement: claiming is one-time-ever, so it's confirmed first —
    // the initial click must not fire the API call by itself.
    it("asks for confirmation before claiming, then calls the payment-free endpoint and refreshes entitlements, with no mock/Razorpay flow", async () => {
      const refreshEntitlements = jest.fn();
      mockContext({ refreshEntitlements });
      api.post.mockResolvedValue({ data: { status: "trialing", currentPeriodEnd: "2026-12-01T00:00:00.000Z" } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toBeInTheDocument());

      await u.click(screen.getByTestId("subscription-trial-btn-premium_monthly"));
      expect(api.post).not.toHaveBeenCalledWith("/subscriptions/trial/start", expect.anything());
      expect(screen.getByTestId("subscription-trial-confirm-premium_monthly")).toBeInTheDocument();

      await u.click(screen.getByTestId("subscription-trial-confirm-btn-premium_monthly"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions/trial/start", { planKey: "premium_monthly" }));
      expect(refreshEntitlements).toHaveBeenCalled();
      expect(screen.queryByTestId("subscription-mock-banner")).not.toBeInTheDocument();
    });

    it("dismisses the trial confirmation without claiming", async () => {
      mockContext();
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toBeInTheDocument());

      await u.click(screen.getByTestId("subscription-trial-btn-premium_monthly"));
      await u.click(screen.getByTestId("subscription-trial-dismiss-btn-premium_monthly"));
      expect(api.post).not.toHaveBeenCalledWith("/subscriptions/trial/start", expect.anything());
      expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toBeInTheDocument();
    });

    it("hides the trial button once hasUsedTrial is true, leaving only Subscribe", async () => {
      mockContext({ entitlements: { ...FREEMIUM_ENTITLEMENTS, hasUsedTrial: true } });
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
      expect(screen.queryByTestId("subscription-trial-btn-premium_monthly")).not.toBeInTheDocument();
      expect(screen.getByTestId("subscription-subscribe-btn-premium_monthly")).toBeInTheDocument();
    });

    it("shows an error if the trial claim is rejected (e.g. already used)", async () => {
      mockContext();
      api.post.mockRejectedValue({ response: { data: { message: "You've already used your one-time free trial." } } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toBeInTheDocument());
      await u.click(screen.getByTestId("subscription-trial-btn-premium_monthly"));
      await u.click(screen.getByTestId("subscription-trial-confirm-btn-premium_monthly"));
      await waitFor(() => expect(screen.getByText("You've already used your one-time free trial.")).toBeInTheDocument());
      // Reverts to the plain button (not left stuck showing the confirm banner).
      expect(screen.getByTestId("subscription-trial-btn-premium_monthly")).toBeInTheDocument();
    });
  });

  it("subscribing in mock mode shows a dev-mode confirm banner, and confirming verifies + refreshes entitlements", async () => {
    const refreshEntitlements = jest.fn();
    mockContext({ refreshEntitlements });
    api.post.mockImplementation((url) => {
      if (url === "/subscriptions") return Promise.resolve({ data: { subscriptionId: "mock_sub_1", mock: true, trialDays: 15 } });
      if (url === "/subscriptions/verify") return Promise.resolve({ data: { status: "trialing" } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
    await waitFor(() => expect(screen.getByTestId("subscription-mock-banner")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-mock-confirm-btn"));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/subscriptions/verify", {
        planKey: "premium_monthly",
        razorpay_payment_id: "mock_payment_mock_sub_1",
        razorpay_subscription_id: "mock_sub_1",
        razorpay_signature: "mock",
      })
    );
    expect(refreshEntitlements).toHaveBeenCalled();
  });

  it("shows a clear error if starting the subscription fails", async () => {
    mockContext();
    api.post.mockRejectedValue({ response: { data: { message: "This plan hasn't been published to Razorpay yet." } } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
    await waitFor(() => expect(screen.getByText("This plan hasn't been published to Razorpay yet.")).toBeInTheDocument());
  });

  it("dismisses the mock banner on Cancel without calling verify", async () => {
    mockContext();
    api.post.mockResolvedValue({ data: { subscriptionId: "mock_sub_2", mock: true, trialDays: 0 } });
    const u = userEvent.setup();
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());
    await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
    await waitFor(() => expect(screen.getByTestId("subscription-mock-banner")).toBeInTheDocument());

    await u.click(screen.getByTestId("subscription-mock-cancel-btn"));
    await waitFor(() => expect(screen.queryByTestId("subscription-mock-banner")).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1); // only the initial /subscriptions call, never verify
  });

  it("the back button calls goBack", async () => {
    const goBack = jest.fn();
    mockContext({ goBack });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-back-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("subscription-back-btn"));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  // Phase 6b of docs/ADMIN_PANEL_PLAN.md §9's "6b" row.
  it("shows a past-due banner when the subscription's last payment failed", async () => {
    mockContext({ entitlements: { ...PREMIUM_ENTITLEMENTS, subscription: { ...PREMIUM_ENTITLEMENTS.subscription, status: "past_due" } } });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-past-due-banner")).toBeInTheDocument());
  });

  it("does not show the past-due banner for a healthy active subscription", async () => {
    mockContext({ entitlements: PREMIUM_ENTITLEMENTS });
    render(<Subscription />);
    await waitFor(() => expect(screen.getByTestId("subscription-current-plan-card")).toBeInTheDocument());
    expect(screen.queryByTestId("subscription-past-due-banner")).not.toBeInTheDocument();
  });

  describe("coupons", () => {
    it("previews a discount and includes the coupon code in the subscribe call", async () => {
      mockContext();
      api.post.mockImplementation((url, body) => {
        if (url === "/subscriptions/coupons/preview") return Promise.resolve({ data: { code: "SAVE20", type: "percent", value: 20, originalPricePaise: 11900, discountedPricePaise: 9520 } });
        if (url === "/subscriptions") return Promise.resolve({ data: { subscriptionId: "mock_sub_c", mock: true, trialDays: 15 } });
        return Promise.reject(new Error("unexpected " + url + JSON.stringify(body)));
      });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

      await u.type(screen.getByTestId("subscription-coupon-input-premium_monthly"), "save20");
      await u.click(screen.getByTestId("subscription-coupon-apply-btn-premium_monthly"));
      await waitFor(() => expect(screen.getByTestId("subscription-coupon-applied-premium_monthly")).toBeInTheDocument());

      await u.click(screen.getByTestId("subscription-subscribe-btn-premium_monthly"));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/subscriptions", { planKey: "premium_monthly", couponCode: "SAVE20" }));
    });

    it("shows an error for an invalid coupon code", async () => {
      mockContext();
      api.post.mockRejectedValue({ response: { data: { message: "This coupon code isn't valid." } } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

      await u.type(screen.getByTestId("subscription-coupon-input-premium_monthly"), "BADCODE");
      await u.click(screen.getByTestId("subscription-coupon-apply-btn-premium_monthly"));
      await waitFor(() => expect(screen.getByTestId("subscription-coupon-error-premium_monthly")).toHaveTextContent("This coupon code isn't valid."));
    });

    // Requirement: each plan card owns its own coupon state now that every
    // plan is visible at once — a code typed/applied against one plan must
    // never leak onto another.
    it("keeps coupon state isolated per plan card", async () => {
      mockContext();
      api.post.mockResolvedValue({ data: { code: "SAVE20", type: "percent", value: 20, originalPricePaise: 11900, discountedPricePaise: 9520 } });
      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-plan-premium-premium_monthly")).toBeInTheDocument());

      await u.type(screen.getByTestId("subscription-coupon-input-premium_monthly"), "SAVE20");
      await u.click(screen.getByTestId("subscription-coupon-apply-btn-premium_monthly"));
      await waitFor(() => expect(screen.getByTestId("subscription-coupon-applied-premium_monthly")).toBeInTheDocument());

      expect(screen.queryByTestId("subscription-coupon-applied-premium_annual")).not.toBeInTheDocument();
      expect(screen.getByTestId("subscription-coupon-input-premium_annual")).toHaveValue("");
    });
  });

  describe("invoices", () => {
    it("lists invoices once loaded, and downloads one as a blob on click", async () => {
      mockContext();
      mockGetOk({ invoices: [{ id: "inv1", number: "DIV-INV-000001", totalPaise: 11900, issuedAt: "2026-01-01T00:00:00.000Z" }] });
      api.get.mockImplementation((url) => {
        if (url === "/subscriptions/plans") return Promise.resolve({ data: { plans: PLANS } });
        if (url === "/subscriptions/invoices") return Promise.resolve({ data: { invoices: [{ id: "inv1", number: "DIV-INV-000001", totalPaise: 11900, issuedAt: "2026-01-01T00:00:00.000Z" }] } });
        if (url === "/subscriptions/invoices/inv1/pdf") return Promise.resolve({ data: new Blob(["pdf"]) });
        return Promise.reject(new Error("unexpected " + url));
      });
      window.URL.createObjectURL = jest.fn(() => "blob:mock");
      window.URL.revokeObjectURL = jest.fn();

      const u = userEvent.setup();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-invoice-inv1")).toBeInTheDocument());
      expect(screen.getByTestId("subscription-invoices-list")).toHaveTextContent("DIV-INV-000001");

      await u.click(screen.getByTestId("subscription-invoice-inv1"));
      await waitFor(() => expect(api.get).toHaveBeenCalledWith("/subscriptions/invoices/inv1/pdf", { responseType: "blob" }));
    });

    it("shows no invoices section when there are none", async () => {
      mockContext();
      render(<Subscription />);
      await waitFor(() => expect(screen.getByTestId("subscription-current-plan-card")).toBeInTheDocument());
      expect(screen.queryByTestId("subscription-invoices-list")).not.toBeInTheDocument();
    });
  });
});
