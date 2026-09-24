import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "../../lib/api";
import Subscriptions from "./Subscriptions";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const SUBSCRIPTIONS = [
  { id: "sub1", userId: "u1", userName: "Ada Example", userEmail: "ada@example.com", planKey: "premium_monthly", planName: "Premium (Monthly)", status: "active", currentPeriodEnd: "2026-12-01T00:00:00.000Z", cancelAtPeriodEnd: false },
];
const PLANS = [
  { id: "p1", key: "freemium", name: "Freemium", pricePaise: 0, interval: "one_time", trialDays: 0, isActive: true, visibility: "public", razorpayPlanId: undefined, linkedPlanKey: null },
  { id: "p2", key: "premium_monthly", name: "Premium (Monthly)", pricePaise: 11900, interval: "month", trialDays: 15, isActive: true, visibility: "public", razorpayPlanId: undefined, linkedPlanKey: null },
  { id: "p3", key: "premium_annual", name: "Premium (Annual)", pricePaise: 109900, interval: "year", trialDays: 15, isActive: true, visibility: "public", razorpayPlanId: undefined, linkedPlanKey: null },
];

const COUPONS = [
  { id: "cp1", code: "SAVE20", type: "percent", value: 20, appliesToPlanKeys: [], maxRedemptions: 100, redeemedCount: 3, expiresAt: null, isActive: true },
];

const RENEWAL_REMINDER_MESSAGE = { title: "Test title", body: "Test body {{planName}}" };
const RENEWAL_REMINDER = {
  daysBefore: [7, 3, 0],
  enablePopup: false,
  messages: { trialEnding: RENEWAL_REMINDER_MESSAGE, renewal: RENEWAL_REMINDER_MESSAGE, accessEnding: RENEWAL_REMINDER_MESSAGE },
};

function mockLoadOk(overrides = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
    if (url === "/admin/plans") return Promise.resolve({ data: { plans: overrides.plans || PLANS } });
    if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: overrides.coupons || COUPONS } });
    if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: overrides.renewalReminder || RENEWAL_REMINDER });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("Subscriptions (admin)", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state then the subscriptions table by default", async () => {
    mockLoadOk();
    render(<Subscriptions />);
    expect(screen.getByTestId("admin-subscriptions-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  // Requirement: search/filter/sort controls for the Subscriptions table,
  // so an admin can find one specific user instead of only paging through.
  it("searches, filters by status, and sorts the subscriptions table (each debounced)", async () => {
    mockLoadOk();
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    api.get.mockClear();

    fireEvent.change(screen.getByTestId("admin-subscriptions-search-input"), { target: { value: "ada" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions", { params: { q: "ada", status: undefined, sort: "newest" } }), { timeout: 2000 });

    fireEvent.change(screen.getByTestId("admin-subscriptions-status-filter"), { target: { value: "active" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions", { params: { q: "ada", status: "active", sort: "newest" } }), { timeout: 2000 });

    fireEvent.change(screen.getByTestId("admin-subscriptions-sort-select"), { target: { value: "expiring_soon" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions", { params: { q: "ada", status: "active", sort: "expiring_soon" } }), { timeout: 2000 });
  });

  // Requirement: the search box autoloads matching names/emails as you
  // type (a dropdown, like the Grant form's own picker) — picking one
  // filters the table to exactly that user via an exact userId param.
  it("search box shows an autocomplete dropdown of matching users, and picking one filters by exact userId", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/users") return Promise.resolve({ data: { users: [{ id: "u1", name: "Ada Example", email: "a***@example.com", mobile: "**********10", age: 30, status: "active", createdAt: "2026-01-01" }] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    api.get.mockClear();

    fireEvent.change(screen.getByTestId("admin-subscriptions-search-input"), { target: { value: "ada" } });
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-search-option-u1")).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByTestId("admin-subscriptions-search-option-u1"));
    expect(screen.getByTestId("admin-subscriptions-search-selected")).toHaveTextContent("Ada Example (a***@example.com)");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions", { params: { q: undefined, userId: "u1", status: undefined, sort: "newest" } }), { timeout: 2000 });
  });

  it("grants a complimentary subscription, prompting for step-up when required", async () => {
    mockLoadOk();
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }).mockResolvedValueOnce({ data: { subscription: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-subscriptions-grant-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-subscriptions-grant-user-input"), { target: { value: "u2" } });
    fireEvent.change(screen.getByTestId("admin-subscriptions-grant-days-input"), { target: { value: "60" } });
    fireEvent.click(screen.getByTestId("admin-subscriptions-grant-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith("/admin/subscriptions/grant", { userIdOrEmail: "u2", planKey: "premium_monthly", days: 60 }, expect.anything());
  });

  // Requirement: the grant form should be usable by searching name/email,
  // not just typing the raw Mongo _id blind.
  it("grant form: typing searches users, and picking a match fills the field with the real id", async () => {
    mockLoadOk();
    api.get.mockImplementation((url, config) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/users") return Promise.resolve({ data: { users: [{ id: "real-user-id-1", name: "Ada Example", email: "a***@example.com", mobile: "**********10", age: 30, status: "active", createdAt: "2026-01-01" }] } });
      return Promise.reject(new Error("unexpected " + url + JSON.stringify(config)));
    });
    api.post.mockResolvedValue({ data: { subscription: {} } });

    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-grant-toggle-btn"));

    fireEvent.change(screen.getByTestId("admin-subscriptions-grant-user-input"), { target: { value: "ada" } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/users", { params: { q: "ada", limit: 5 } }));
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-grant-user-option-real-user-id-1")).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByTestId("admin-subscriptions-grant-user-option-real-user-id-1"));
    expect(screen.getByTestId("admin-subscriptions-grant-user-selected")).toHaveTextContent("Ada Example (a***@example.com)");

    fireEvent.click(screen.getByTestId("admin-subscriptions-grant-submit-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/subscriptions/grant", { userIdOrEmail: "real-user-id-1", planKey: "premium_monthly", days: 30 }, expect.anything()));
  });

  it("opens a user's subscription history from the History button", async () => {
    mockLoadOk();
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/by-user/u1")
        return Promise.resolve({
          data: {
            user: { id: "u1", name: "Ada Example", email: "ada@example.com" },
            subscriptions: [
              { id: "s2", planKey: "premium_annual", planName: "Premium (Annual)", status: "active", currentPeriodStart: "2026-06-01", currentPeriodEnd: "2027-06-01", trialDaysGranted: null, cancelAtPeriodEnd: false },
              { id: "s1", planKey: "premium_monthly", planName: "Premium (Monthly)", status: "cancelled", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-02-01", trialDaysGranted: 15, cancelAtPeriodEnd: false },
            ],
          },
        });
      return Promise.reject(new Error("unexpected " + url));
    });

    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-history-btn-sub1"));

    await waitFor(() => expect(screen.getByTestId("admin-subscription-history-row-s2")).toBeInTheDocument());
    expect(screen.getByTestId("admin-subscription-history-row-s2")).toHaveTextContent("Premium (Annual)");
    expect(screen.getByTestId("admin-subscription-history-row-s1")).toHaveTextContent("15-day trial");

    fireEvent.click(screen.getByTestId("admin-subscription-history-close-btn"));
    expect(screen.queryByTestId("admin-subscription-history-modal")).not.toBeInTheDocument();
  });

  it("cancels a subscription with step-up", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { subscription: { status: "cancelled" } } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-subscriptions-cancel-btn-sub1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/subscriptions/sub1/cancel", { atPeriodEnd: false }, expect.anything()));
  });

  it("changes a subscription's plan once a different one is selected", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { subscription: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-subscriptions-planselect-sub1"), { target: { value: "premium_annual" } });
    fireEvent.click(screen.getByTestId("admin-subscriptions-changeplan-btn-sub1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/subscriptions/sub1/change-plan", { planKey: "premium_annual" }, expect.anything()));
  });

  it("switches to the Plans tab, creates a plan, and publishes it to Razorpay", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { plan: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));
    expect(screen.getByTestId("admin-plans-row-p2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-plans-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-plans-new-key-input"), { target: { value: "premium_lifetime" } });
    fireEvent.change(screen.getByTestId("admin-plans-new-name-input"), { target: { value: "Premium Lifetime" } });
    fireEvent.click(screen.getByTestId("admin-plans-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/plans", expect.objectContaining({ key: "premium_lifetime", name: "Premium Lifetime" })));
  });

  it("publishing a plan to Razorpay prompts for step-up", async () => {
    mockLoadOk();
    api.post.mockRejectedValue({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-publish-btn-p2"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("archives a plan without step-up", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { plan: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-archive-btn-p2"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/plans/p2/archive"));
  });

  // Requirement: an admin archiving a plan that has live subscribers should
  // see that auto-renew was turned off for them (access unaffected) — not a
  // silent no-op.
  it("shows a confirmation naming how many subscribers had auto-renew turned off when archiving a plan", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { plan: {}, subscribersAffected: 3 } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-archive-btn-p2"));
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-notice")).toHaveTextContent("Auto-renew turned off for 3 existing subscribers"));
    expect(screen.getByTestId("admin-subscriptions-notice")).toHaveTextContent("they keep access until their plan ends");
  });

  it("shows no notice when archiving a plan with no live subscribers", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { plan: {}, subscribersAffected: 0 } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-archive-btn-p2"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/plans/p2/archive"));
    expect(screen.queryByTestId("admin-subscriptions-notice")).not.toBeInTheDocument();
  });

  // Requirement: a per-user, standing extra allowance for one metered key,
  // independent of Freemium/Premium.
  it("grants extra usage limits by email, step-up gated", async () => {
    mockLoadOk();
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } }).mockResolvedValueOnce({ data: { grant: {} } });

    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-usagegrant-toggle-btn"));

    fireEvent.change(screen.getByTestId("admin-usagegrant-user-input"), { target: { value: "target@example.com" } });
    fireEvent.change(screen.getByTestId("admin-usagegrant-key-select"), { target: { value: "doc_upload" } });
    fireEvent.change(screen.getByTestId("admin-usagegrant-weekly-input"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("admin-usagegrant-monthly-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("admin-usagegrant-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith(
      "/admin/subscriptions/usage-grants",
      { userIdOrEmail: "target@example.com", key: "doc_upload", bonusWeekly: 5, bonusMonthly: 10, bonusTotal: 0 },
      expect.anything()
    );
  });

  // Requirement: grant extra free resilience-report downloads to a specific
  // user via this same "Grant extra limits" action.
  it("grants extra complimentary report downloads via the score_report key", async () => {
    mockLoadOk();
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.post.mockResolvedValueOnce({ data: { grant: {} } });

    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-usagegrant-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-usagegrant-user-input"), { target: { value: "target@example.com" } });
    fireEvent.change(screen.getByTestId("admin-usagegrant-key-select"), { target: { value: "score_report" } });
    expect(screen.queryByTestId("admin-usagegrant-weekly-input")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("admin-usagegrant-total-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("admin-usagegrant-submit-btn"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/admin/subscriptions/usage-grants",
        { userIdOrEmail: "target@example.com", key: "score_report", bonusWeekly: 0, bonusMonthly: 0, bonusTotal: 2 },
        expect.anything()
      )
    );
  });

  // Requirement: editing trialDays/benefits on an EXISTING plan — there was
  // previously no "Edit" affordance at all outside of plan creation.
  it("edits an existing plan's trial days and benefits, without step-up", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { plan: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-edit-btn-p2"));
    fireEvent.change(screen.getByTestId("admin-plans-edit-trialdays-input-p2"), { target: { value: "30" } });
    fireEvent.change(screen.getByTestId("admin-plans-edit-benefits-input-p2"), { target: { value: "Unlimited edits\nPriority support" } });
    fireEvent.click(screen.getByTestId("admin-plans-edit-save-btn-p2"));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/plans/p2", { trialDays: 30, entitlements: { complimentaryReportDownloads: 0 }, benefits: ["Unlimited edits", "Priority support"], linkedPlanKey: null }));
  });

  // Requirement: complimentary report downloads editable both at creation
  // and on an existing plan — "in the plan creation itself" plus after.
  it("sets complimentaryReportDownloads when creating a plan", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { plan: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-plans-new-key-input"), { target: { value: "premium_lifetime" } });
    fireEvent.change(screen.getByTestId("admin-plans-new-name-input"), { target: { value: "Premium Lifetime" } });
    fireEvent.change(screen.getByTestId("admin-plans-entitlement-complimentary-report-input"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("admin-plans-new-create-btn"));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/admin/plans",
        expect.objectContaining({ entitlements: expect.objectContaining({ complimentaryReportDownloads: 3 }) })
      )
    );
  });

  it("edits an existing plan's complimentary report downloads (blank = unlimited)", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { plan: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));

    fireEvent.click(screen.getByTestId("admin-plans-edit-btn-p2"));
    fireEvent.change(screen.getByTestId("admin-plans-edit-complimentary-report-input-p2"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("admin-plans-edit-save-btn-p2"));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/plans/p2", expect.objectContaining({ entitlements: { complimentaryReportDownloads: null } })));
  });

  // Requirement: link a Monthly and Annual plan so the user-facing screen
  // shows them as one toggle card instead of two separate ones.
  describe("linking plans", () => {
    it("offers only opposite-interval plans as link candidates, and saves the chosen link", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: { plan: {} } });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));
      fireEvent.click(screen.getByTestId("admin-plans-edit-btn-p2"));

      const select = screen.getByTestId("admin-plans-edit-link-select-p2");
      const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(optionValues).toEqual(["", "premium_annual"]); // never itself, never the one_time Freemium plan

      fireEvent.change(select, { target: { value: "premium_annual" } });
      fireEvent.click(screen.getByTestId("admin-plans-edit-save-btn-p2"));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/plans/p2", expect.objectContaining({ linkedPlanKey: "premium_annual" })));
    });

    it("does not offer the link control at all for a one_time plan (Freemium)", async () => {
      mockLoadOk();
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));
      fireEvent.click(screen.getByTestId("admin-plans-edit-btn-p1"));
      expect(screen.queryByTestId("admin-plans-edit-link-select-p1")).not.toBeInTheDocument();
    });

    it("shows a linked-partner note on the plan row once linked", async () => {
      mockLoadOk({ plans: [PLANS[0], { ...PLANS[1], linkedPlanKey: "premium_annual" }, { ...PLANS[2], linkedPlanKey: "premium_monthly" }] });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));
      expect(screen.getByTestId("admin-plans-linked-note-p2")).toHaveTextContent("Linked with Premium (Annual)");
    });

    it("unlinking sends linkedPlanKey: null", async () => {
      mockLoadOk({ plans: [PLANS[0], { ...PLANS[1], linkedPlanKey: "premium_annual" }, { ...PLANS[2], linkedPlanKey: "premium_monthly" }] });
      api.patch.mockResolvedValue({ data: { plan: {} } });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-plans"));
      fireEvent.click(screen.getByTestId("admin-plans-edit-btn-p2"));

      fireEvent.change(screen.getByTestId("admin-plans-edit-link-select-p2"), { target: { value: "" } });
      fireEvent.click(screen.getByTestId("admin-plans-edit-save-btn-p2"));
      await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/plans/p2", expect.objectContaining({ linkedPlanKey: null })));
    });
  });

  describe("renewal reminder settings", () => {
    // Its own tab, separate from the Subscriptions table — matching Plans/
    // Coupons/Trials, each already a sibling tab rather than sharing one.
    it("shows the current thresholds and message templates, and the Save button stays disabled until something changes", async () => {
      mockLoadOk();
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      expect(screen.getByTestId("admin-renewal-reminder-days-input")).toHaveValue("7, 3, 0");
      expect(screen.getByTestId("admin-renewal-reminder-trialEnding-title-input")).toHaveValue("Test title");
      expect(screen.getByTestId("admin-renewal-reminder-save-btn")).toBeDisabled();
    });

    it("saves new thresholds and shows a Saved confirmation", async () => {
      mockLoadOk();
      const saved = { daysBefore: [14, 5], messages: RENEWAL_REMINDER.messages };
      api.patch.mockResolvedValue({ data: saved });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      fireEvent.change(screen.getByTestId("admin-renewal-reminder-days-input"), { target: { value: "14, 5" } });
      expect(screen.getByTestId("admin-renewal-reminder-save-btn")).not.toBeDisabled();
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-save-btn"));

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith("/admin/subscriptions/renewal-reminder-settings", { daysBefore: [14, 5], enablePopup: false, messages: RENEWAL_REMINDER.messages })
      );
      expect(await screen.findByText("Saved")).toBeInTheDocument();
    });

    it("edits a category's message template and saves it", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: RENEWAL_REMINDER });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      fireEvent.change(screen.getByTestId("admin-renewal-reminder-renewal-title-input"), { target: { value: "Renewal coming up" } });
      fireEvent.change(screen.getByTestId("admin-renewal-reminder-renewal-body-input"), { target: { value: "{{planName}} renews on {{periodEnd}}." } });
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-save-btn"));

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith("/admin/subscriptions/renewal-reminder-settings", {
          daysBefore: RENEWAL_REMINDER.daysBefore,
          enablePopup: false,
          messages: { ...RENEWAL_REMINDER.messages, renewal: { title: "Renewal coming up", body: "{{planName}} renews on {{periodEnd}}." } },
        })
      );
    });

    it("toggles the pop-up card option and saves it", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: { ...RENEWAL_REMINDER, enablePopup: true } });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      expect(screen.getByTestId("admin-renewal-reminder-popup-checkbox")).not.toBeChecked();
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-popup-checkbox"));
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-save-btn"));

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith("/admin/subscriptions/renewal-reminder-settings", {
          daysBefore: RENEWAL_REMINDER.daysBefore,
          enablePopup: true,
          messages: RENEWAL_REMINDER.messages,
        })
      );
    });

    it("edits a category's highlight style and saves it", async () => {
      mockLoadOk();
      api.patch.mockResolvedValue({ data: RENEWAL_REMINDER });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      fireEvent.change(screen.getByTestId("admin-renewal-reminder-renewal-highlight-color-input"), { target: { value: "#D4AF37" } });
      fireEvent.change(screen.getByTestId("admin-renewal-reminder-renewal-highlight-fontweight-select"), { target: { value: "bold" } });
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-save-btn"));

      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith("/admin/subscriptions/renewal-reminder-settings", {
          daysBefore: RENEWAL_REMINDER.daysBefore,
          enablePopup: false,
          messages: { ...RENEWAL_REMINDER.messages, renewal: { ...RENEWAL_REMINDER_MESSAGE, highlightStyle: { color: "#D4AF37", fontWeight: "bold" } } },
        })
      );
    });

    it("disables Save when a threshold list is emptied out", async () => {
      mockLoadOk();
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      fireEvent.change(screen.getByTestId("admin-renewal-reminder-days-input"), { target: { value: "" } });
      expect(screen.getByTestId("admin-renewal-reminder-save-btn")).toBeDisabled();
    });

    it("shows an error if saving fails", async () => {
      mockLoadOk();
      api.patch.mockRejectedValue({ response: { data: { message: "Couldn't save it." } } });
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));

      fireEvent.change(screen.getByTestId("admin-renewal-reminder-days-input"), { target: { value: "10" } });
      fireEvent.click(screen.getByTestId("admin-renewal-reminder-save-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-error")).toHaveTextContent("Couldn't save it."));
    });

    it("shows the Subscriptions table without the reminder card, and vice versa", async () => {
      mockLoadOk();
      render(<Subscriptions />);
      await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
      expect(screen.queryByTestId("admin-subscriptions-renewal-reminder-card")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("admin-subscriptions-tab-reminders"));
      expect(screen.getByTestId("admin-subscriptions-renewal-reminder-card")).toBeInTheDocument();
      expect(screen.queryByTestId("admin-subscriptions-table")).not.toBeInTheDocument();
    });
  });
});

// Requirement: a user-wise list of who has claimed a trial, with a way to
// regrant one.
describe("Trials tab", () => {
  afterEach(() => jest.clearAllMocks());

  const TRIALS = [
    { id: "t1", userId: "u1", userName: "Ada Example", userEmail: "ada@example.com", planKey: "premium_monthly", planName: "Premium (Monthly)", trialDaysGranted: 15, status: "trialing", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-01-16", hasUsedTrial: true },
  ];

  function mockLoadOkWithTrials() {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/trials") return Promise.resolve({ data: { trials: TRIALS } });
      return Promise.reject(new Error("unexpected " + url));
    });
  }

  it("lists trial users, lazily loaded on first visit to the tab", async () => {
    mockLoadOkWithTrials();
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    expect(api.get).not.toHaveBeenCalledWith("/admin/subscriptions/trials");

    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-row-t1")).toBeInTheDocument());
    expect(screen.getByTestId("admin-trials-row-t1")).toHaveTextContent("Ada Example");
    expect(screen.getByTestId("admin-trials-row-t1")).toHaveTextContent("15d");
  });

  it("regrants a trial with step-up, then refreshes the list", async () => {
    mockLoadOkWithTrials();
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });

    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-regrant-btn-t1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-trials-regrant-btn-t1"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith("/admin/users/u1/trial/reset", {}, expect.anything());
  });

  // Requirement: a legacy trial (claimed before trialDaysGranted existed)
  // must still show up, marked as such rather than disappearing.
  it("shows a legacy trial row with an unknown trial length", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/trials")
        return Promise.resolve({
          data: {
            trials: [
              { id: "legacy-u2", userId: "u2", userName: "Legacy User", userEmail: "legacy@example.com", planKey: "premium_monthly", planName: "Premium (Monthly)", trialDaysGranted: null, status: "cancelled", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-01-16", hasUsedTrial: true, legacy: true },
            ],
          },
        });
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-row-legacy-u2")).toBeInTheDocument());
    expect(screen.getByTestId("admin-trials-row-legacy-u2")).toHaveTextContent("Legacy User");
    expect(screen.getByTestId("admin-trials-row-legacy-u2")).toHaveTextContent("Legacy");
    expect(screen.getByTestId("admin-trials-regrant-btn-legacy-u2")).toBeInTheDocument();
  });

  it("shows an empty state with no trials claimed", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/trials") return Promise.resolve({ data: { trials: [] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-empty")).toBeInTheDocument());
  });

  it("searches and sorts the trials table (debounced), without double-fetching on the initial tab open", async () => {
    mockLoadOkWithTrials();
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-row-t1")).toBeInTheDocument());
    const trialsCallsAfterOpen = api.get.mock.calls.filter((c) => c[0] === "/admin/subscriptions/trials").length;
    expect(trialsCallsAfterOpen).toBe(1); // the tab-click load, not a redundant second one from the debounce effect

    fireEvent.change(screen.getByTestId("admin-trials-search-input"), { target: { value: "ada" } });
    await waitFor(
      () => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions/trials", { params: { q: "ada", status: undefined, sort: "newest" } }),
      { timeout: 2000 }
    );

    fireEvent.change(screen.getByTestId("admin-trials-status-filter"), { target: { value: "legacy" } });
    await waitFor(
      () => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions/trials", { params: { q: "ada", status: "legacy", sort: "newest" } }),
      { timeout: 2000 }
    );
  });

  it("trials search box shows an autocomplete dropdown, and picking a user filters by exact userId", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/trials") return Promise.resolve({ data: { trials: TRIALS } });
      if (url === "/admin/users") return Promise.resolve({ data: { users: [{ id: "u1", name: "Ada Example", email: "a***@example.com", mobile: "**********10", age: 30, status: "active", createdAt: "2026-01-01" }] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-row-t1")).toBeInTheDocument());
    api.get.mockClear();

    fireEvent.change(screen.getByTestId("admin-trials-search-input"), { target: { value: "ada" } });
    await waitFor(() => expect(screen.getByTestId("admin-trials-search-option-u1")).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId("admin-trials-search-option-u1"));
    expect(screen.getByTestId("admin-trials-search-selected")).toHaveTextContent("Ada Example (a***@example.com)");
    await waitFor(
      () => expect(api.get).toHaveBeenCalledWith("/admin/subscriptions/trials", { params: { q: undefined, userId: "u1", status: undefined, sort: "newest" } }),
      { timeout: 2000 }
    );
  });

  // Requirement: a user who subscribed directly without ever claiming a
  // trial shows up distinctly from "legacy" (a real historical claim).
  it("shows a forfeited (never-claimed) trial row distinctly from legacy", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/admin/subscriptions") return Promise.resolve({ data: { subscriptions: SUBSCRIPTIONS } });
      if (url === "/admin/plans") return Promise.resolve({ data: { plans: PLANS } });
      if (url === "/admin/coupons") return Promise.resolve({ data: { coupons: COUPONS } });
      if (url === "/admin/subscriptions/renewal-reminder-settings") return Promise.resolve({ data: RENEWAL_REMINDER });
      if (url === "/admin/subscriptions/trials")
        return Promise.resolve({
          data: {
            trials: [
              { id: "forfeited-u3", userId: "u3", userName: "Forfeited User", userEmail: "forfeited@example.com", planKey: "premium_monthly", planName: "Premium (Monthly)", trialDaysGranted: null, status: "active", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-02-01", hasUsedTrial: true, legacy: false, forfeited: true },
            ],
          },
        });
      return Promise.reject(new Error("unexpected " + url));
    });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-trials"));
    await waitFor(() => expect(screen.getByTestId("admin-trials-row-forfeited-u3")).toBeInTheDocument());
    expect(screen.getByTestId("admin-trials-row-forfeited-u3")).toHaveTextContent("Not claimed");
    expect(screen.getByTestId("admin-trials-row-forfeited-u3")).toHaveTextContent("subscribed directly");
    expect(screen.getByTestId("admin-trials-regrant-btn-forfeited-u3")).toBeInTheDocument();
  });
});

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3 — coupons, folded into this same
// screen as a third tab.
describe("Coupons tab", () => {
  afterEach(() => jest.clearAllMocks());

  it("switches to the Coupons tab and lists existing coupons", async () => {
    mockLoadOk();
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));
    expect(screen.getByTestId("admin-coupons-table")).toBeInTheDocument();
    expect(screen.getByTestId("admin-coupons-row-cp1")).toHaveTextContent("SAVE20");
    expect(screen.getByTestId("admin-coupons-row-cp1")).toHaveTextContent("3 / 100");
  });

  it("creates a new coupon (no step-up required)", async () => {
    mockLoadOk();
    api.post.mockResolvedValue({ data: { coupon: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));

    fireEvent.click(screen.getByTestId("admin-coupons-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-coupons-new-code-input"), { target: { value: "welcome10" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-value-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("admin-coupons-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/coupons", expect.objectContaining({ code: "welcome10", type: "percent", value: 10 })));
  });

  // Requirement: coupon eligibility sub-categories (new users, first-time,
  // renewal) on top of the existing plan-targeting categories.
  it("creates a coupon with an eligibility category, and lists it on existing rows", async () => {
    mockLoadOk({
      coupons: [
        { id: "cp1", code: "SAVE20", type: "percent", value: 20, appliesToPlanKeys: [], eligibility: "new_user", maxRedemptions: 100, redeemedCount: 3, expiresAt: null, isActive: true },
      ],
    });
    api.post.mockResolvedValue({ data: { coupon: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));

    expect(screen.getByTestId("admin-coupons-eligibility-cp1")).toHaveTextContent("New users (within 7 days of signup)");

    fireEvent.click(screen.getByTestId("admin-coupons-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-coupons-new-code-input"), { target: { value: "renewers" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-value-input"), { target: { value: "15" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-eligibility-select"), { target: { value: "renewal" } });
    fireEvent.click(screen.getByTestId("admin-coupons-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/coupons", expect.objectContaining({ code: "renewers", eligibility: "renewal" })));
  });

  // Requirement: a coupon on a recurring plan can discount just the first
  // charge instead of every future auto-renewal.
  it("defaults a new coupon to recurring, shows the duration on existing rows, and can create a one-time coupon", async () => {
    mockLoadOk({
      coupons: [
        { id: "cp1", code: "SAVE20", type: "percent", value: 20, appliesToPlanKeys: [], eligibility: "any", discountDuration: "recurring", maxRedemptions: 100, redeemedCount: 3, expiresAt: null, isActive: true },
        { id: "cp2", code: "FIRSTHALF", type: "percent", value: 50, appliesToPlanKeys: [], eligibility: "any", discountDuration: "once", maxRedemptions: 100, redeemedCount: 3, expiresAt: null, isActive: true },
      ],
    });
    api.post.mockResolvedValue({ data: { coupon: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));

    expect(screen.getByTestId("admin-coupons-duration-cp1")).toHaveTextContent("Every renewal");
    expect(screen.getByTestId("admin-coupons-duration-cp2")).toHaveTextContent("First charge only");

    fireEvent.click(screen.getByTestId("admin-coupons-new-toggle-btn"));
    expect(screen.getByTestId("admin-coupons-new-duration-select")).toHaveValue("recurring");
    fireEvent.change(screen.getByTestId("admin-coupons-new-code-input"), { target: { value: "onetime" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-value-input"), { target: { value: "50" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-duration-select"), { target: { value: "once" } });
    fireEvent.click(screen.getByTestId("admin-coupons-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/coupons", expect.objectContaining({ code: "onetime", discountDuration: "once" })));
  });

  // Requirement: total and per-user max-use limits are both optional and
  // independent of each other.
  it("creates a coupon with a per-user max-use limit, shown alongside the total on existing rows", async () => {
    mockLoadOk({
      coupons: [
        { id: "cp1", code: "SAVE20", type: "percent", value: 20, appliesToPlanKeys: [], eligibility: "any", maxRedemptions: 100, maxRedemptionsPerUser: 1, redeemedCount: 3, expiresAt: null, isActive: true },
      ],
    });
    api.post.mockResolvedValue({ data: { coupon: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));

    expect(screen.getByTestId("admin-coupons-row-cp1")).toHaveTextContent("3 / 100");
    expect(screen.getByTestId("admin-coupons-row-cp1")).toHaveTextContent("1/user");

    fireEvent.click(screen.getByTestId("admin-coupons-new-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-coupons-new-code-input"), { target: { value: "onceonly" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-value-input"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("admin-coupons-new-maxredemptionsperuser-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("admin-coupons-new-create-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/coupons", expect.objectContaining({ code: "onceonly", maxRedemptionsPerUser: 1 })));
  });

  it("toggles a coupon's active state", async () => {
    mockLoadOk();
    api.patch.mockResolvedValue({ data: { coupon: {} } });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));

    fireEvent.click(screen.getByTestId("admin-coupons-toggle-btn-cp1"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/coupons/cp1", { isActive: false }));
  });

  it("shows an empty state with no coupons", async () => {
    mockLoadOk({ coupons: [] });
    render(<Subscriptions />);
    await waitFor(() => expect(screen.getByTestId("admin-subscriptions-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-subscriptions-tab-coupons"));
    expect(screen.getByTestId("admin-coupons-empty")).toBeInTheDocument();
  });
});
