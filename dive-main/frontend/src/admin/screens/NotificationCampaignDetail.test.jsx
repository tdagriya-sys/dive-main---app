import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { api } from "../../lib/api";
import NotificationCampaignDetail from "./NotificationCampaignDetail";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const DRAFT_CAMPAIGN = {
  id: "camp1", name: "Announcement", status: "draft", categoryKey: "product", audience: "all", segmentQuery: {}, userIds: [], stats: null,
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/notifications/campaigns/:id" element={<NotificationCampaignDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockGetCampaign(campaign) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/notification-campaigns/camp1") return Promise.resolve({ data: { campaign } });
    if (url === "/admin/notification-campaigns/camp1/preview") return Promise.resolve({ data: { count: 3, sample: [{ name: "Ada", email: "a***@example.com" }] } });
    if (url === "/admin/notification-campaigns/camp1/stats") return Promise.resolve({ data: { stats: { targeted: 10, sent: 10, failed: 0, delivered: 10, opened: 4 } } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("NotificationCampaignDetail", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads a draft campaign and switches audience mode", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-audience-segment"));
    expect(screen.getByTestId("admin-campaign-segment-hasholdings")).toBeInTheDocument();
  });

  it("saves the audience", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-audience-segment"));
    fireEvent.change(screen.getByTestId("admin-campaign-segment-activesince"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("admin-campaign-save-audience-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", { audience: "segment", segmentQuery: { activeSinceDays: 30 } }));
  });

  it("shows the new subscription/report segment dropdowns and saves them", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-audience-segment"));
    expect(screen.getByTestId("admin-campaign-segment-subscriptionfilter")).toBeInTheDocument();
    expect(screen.getByTestId("admin-campaign-segment-reportfilter")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("admin-campaign-segment-subscriptionfilter"), { target: { value: "active_subscription" } });
    fireEvent.change(screen.getByTestId("admin-campaign-segment-reportfilter"), { target: { value: "never_purchased_report" } });
    fireEvent.click(screen.getByTestId("admin-campaign-save-audience-btn"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", {
        audience: "segment",
        segmentQuery: { subscriptionFilter: "active_subscription", reportFilter: "never_purchased_report" },
      })
    );
  });

  it("disables the new segment dropdowns once the campaign is no longer a draft", async () => {
    mockGetCampaign({ ...DRAFT_CAMPAIGN, status: "sent", audience: "segment", segmentQuery: { subscriptionFilter: "lapsed_payer" }, stats: { targeted: 1, sent: 1, failed: 0 } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    expect(screen.getByTestId("admin-campaign-segment-subscriptionfilter")).toBeDisabled();
    expect(screen.getByTestId("admin-campaign-segment-reportfilter")).toBeDisabled();
  });

  it("previews the audience", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-preview-audience-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-preview-result")).toHaveTextContent("3 recipient(s)"));
  });

  it("sends a test email", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.post.mockResolvedValue({ data: { ok: true } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-campaign-test-email-input"), { target: { value: "staff@example.com" } });
    fireEvent.click(screen.getByTestId("admin-campaign-test-send-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns/camp1/test-send", { email: "staff@example.com" }));
  });

  it("prompts for step-up when scheduling requires it", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-campaign-schedule-input"), { target: { value: "2030-01-01T10:00" } });
    fireEvent.click(screen.getByTestId("admin-campaign-schedule-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument());
  });

  it("requires confirmation before sending now", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.post.mockResolvedValueOnce({ data: { campaign: { status: "sent" } } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-send-now-btn"));
    expect(screen.getByTestId("admin-campaign-send-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-campaign-send-confirm-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns/camp1/send", {}, { headers: { "x-step-up-token": undefined } }));
  });

  it("cancels a draft campaign", async () => {
    mockGetCampaign(DRAFT_CAMPAIGN);
    api.post.mockResolvedValue({ data: { campaign: { status: "cancelled" } } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-cancel-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/admin/notification-campaigns/camp1/cancel"));
  });

  it("shows the delivery dashboard for a sent campaign", async () => {
    mockGetCampaign({ ...DRAFT_CAMPAIGN, status: "sent", stats: { targeted: 10, sent: 10, failed: 0 } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-stat-opened")).toHaveTextContent("4"));
    expect(screen.getByTestId("admin-campaign-stat-targeted")).toHaveTextContent("10");
  });
});

// The Content / Details / audience-summary cards: editing a draft's content,
// and seeing everything about a campaign once it's been sent.
const PREVIEW = {
  content: { subject: "Big sale", bodyMarkdown: "Get ==50% off== [here](https://example.com)", callout: { text: "Hurry", linkUrl: "/?go=signup" }, button: { label: "Shop now", url: "/?go=home" } },
  richHtml: '<div>Hurry</div>Get <span style="color:#D4AF37">50% off</span><div><a href="/?go=home">Shop now</a></div>',
  inAppHtml: "Get 50% off here",
  inAppLink: { link: "http://localhost:3000/?go=home", linkLabel: "Shop now" },
};

const FULL_DRAFT = {
  ...DRAFT_CAMPAIGN,
  channels: ["in_app", "popup"],
  inlineContent: { subject: "Big sale", bodyMarkdown: "Get ==50% off== [here](https://example.com)", callout: { text: "Hurry", linkUrl: "/?go=signup" }, button: { label: "Shop now", url: "/?go=home" } },
  createdAt: "2026-09-10T10:00:00.000Z",
  createdBy: { name: "Asha Admin", email: "asha@example.com" },
  preview: PREVIEW,
};

function mockDetail(campaign) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/notification-campaigns/camp1") return Promise.resolve({ data: { campaign } });
    if (url === "/admin/notification-campaigns/camp1/stats") return Promise.resolve({ data: { stats: { targeted: 2, sent: 4, failed: 0, delivered: 4, opened: 1 } } });
    if (url === "/admin/notification-categories") return Promise.resolve({ data: { categories: [{ key: "product", label: "Product updates" }, { key: "marketing", label: "Marketing" }] } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("NotificationCampaignDetail — viewing and editing content", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the draft's details and a rendered preview of what recipients will see", async () => {
    mockDetail(FULL_DRAFT);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-content-card")).toBeInTheDocument());

    expect(screen.getByTestId("admin-campaign-detail-channels")).toHaveTextContent("In-app (bell), Pop-up card");
    expect(screen.getByTestId("admin-campaign-detail-category")).toHaveTextContent("product");
    expect(screen.getByTestId("admin-campaign-detail-created")).toHaveTextContent("by Asha Admin");
    expect(screen.getByTestId("admin-campaign-content-subject")).toHaveTextContent("Big sale");
    expect(screen.getByTestId("admin-campaign-content-rich").querySelector("a")).toHaveTextContent("Shop now");
    expect(screen.getByTestId("admin-campaign-content-bell")).toHaveTextContent("Get 50% off here");
    expect(screen.getByTestId("admin-campaign-content-bell-link")).toHaveTextContent("Shop now → http://localhost:3000/?go=home");
    expect(screen.getByTestId("admin-campaign-content-raw")).toHaveTextContent("Get ==50% off== [here](https://example.com)");
    expect(screen.getByTestId("admin-campaign-content-button")).toHaveTextContent("→ /?go=home");
  });

  it("lets a draft's content be edited: 'Edit content' opens a prefilled editor, and saving PATCHes the full content", async () => {
    mockDetail(FULL_DRAFT);
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-edit-content-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));
    expect(screen.getByTestId("admin-campaign-edit-name-input")).toHaveValue("Announcement");
    expect(screen.getByTestId("admin-campaign-edit-subject-input")).toHaveValue("Big sale");
    expect(screen.getByTestId("admin-campaign-edit-body-input")).toHaveValue("Get ==50% off== [here](https://example.com)");
    expect(screen.getByTestId("admin-campaign-edit-callout-text-input")).toHaveValue("Hurry");
    expect(screen.getByTestId("admin-campaign-edit-callout-link-input")).toHaveValue("/?go=signup");
    expect(screen.getByTestId("admin-campaign-edit-button-label-input")).toHaveValue("Shop now");
    expect(screen.getByTestId("admin-campaign-edit-channel-popup")).toBeChecked();
    expect(screen.getByTestId("admin-campaign-edit-channel-email")).not.toBeChecked();

    fireEvent.change(screen.getByTestId("admin-campaign-edit-subject-input"), { target: { value: "Big sale tomorrow" } });
    fireEvent.click(screen.getByTestId("admin-campaign-edit-channel-email"));
    fireEvent.change(screen.getByTestId("admin-campaign-edit-button-label-input"), { target: { value: "Shop today" } });
    fireEvent.click(screen.getByTestId("admin-campaign-edit-save-btn"));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", {
        name: "Announcement",
        categoryKey: "product",
        channels: ["in_app", "popup", "email"],
        inlineContent: {
          subject: "Big sale tomorrow",
          bodyMarkdown: "Get ==50% off== [here](https://example.com)",
          callout: { text: "Hurry", linkUrl: "/?go=signup" },
          button: { label: "Shop today", url: "/?go=home" },
        },
      })
    );
  });

  it("cancelling the edit discards changes and returns to the preview", async () => {
    mockDetail(FULL_DRAFT);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-edit-content-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));
    fireEvent.change(screen.getByTestId("admin-campaign-edit-subject-input"), { target: { value: "Changed my mind" } });
    fireEvent.click(screen.getByTestId("admin-campaign-edit-cancel-btn"));
    expect(screen.getByTestId("admin-campaign-content-subject")).toHaveTextContent("Big sale");
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("disables Save until the name, subject, body and at least one channel are present", async () => {
    mockDetail(FULL_DRAFT);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-edit-content-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));
    expect(screen.getByTestId("admin-campaign-edit-save-btn")).not.toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-campaign-edit-body-input"), { target: { value: "  " } });
    expect(screen.getByTestId("admin-campaign-edit-save-btn")).toBeDisabled();
  });

  it("for a template-based draft, starts from the template's wording and switches to custom content on save (templateKey: null)", async () => {
    mockDetail({
      ...DRAFT_CAMPAIGN,
      channels: ["in_app"],
      templateKey: "welcome",
      templateName: "Welcome",
      templateContent: { subject: "Hi from the template", bodyMarkdown: "Template body" },
      preview: { content: { subject: "Hi from the template", bodyMarkdown: "Template body" }, richHtml: "Template body", inAppHtml: "Template body" },
    });
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-content-template-note")).toHaveTextContent("Welcome"));
    expect(screen.getByTestId("admin-campaign-detail-template")).toHaveTextContent("Welcome");

    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));
    expect(screen.getByTestId("admin-campaign-edit-template-note")).toBeInTheDocument();
    expect(screen.getByTestId("admin-campaign-edit-subject-input")).toHaveValue("Hi from the template");

    fireEvent.change(screen.getByTestId("admin-campaign-edit-subject-input"), { target: { value: "Custom subject" } });
    fireEvent.click(screen.getByTestId("admin-campaign-edit-save-btn"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", {
        name: "Announcement",
        categoryKey: "product",
        channels: ["in_app"],
        templateKey: null,
        inlineContent: { subject: "Custom subject", bodyMarkdown: "Template body" },
      })
    );
  });

  it("shows the backend's message if saving the content fails", async () => {
    mockDetail(FULL_DRAFT);
    api.patch.mockRejectedValue({ response: { data: { message: "Only a draft campaign can be edited." } } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-edit-content-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));
    fireEvent.click(screen.getByTestId("admin-campaign-edit-save-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-detail-action-error")).toHaveTextContent("Only a draft campaign can be edited."));
  });

  it("a SENT campaign shows everything read-only: content preview, when/who, delivery, and the audience it went to", async () => {
    mockDetail({
      ...FULL_DRAFT,
      status: "sent",
      sentAt: "2026-09-12T09:30:00.000Z",
      audience: "segment",
      segmentQuery: { subscriptionFilter: "lapsed_payer", reportFilter: "never_purchased_report", hasHoldings: true, activeSinceDays: 30 },
      stats: { targeted: 2, sent: 4, failed: 0 },
      sentContent: FULL_DRAFT.inlineContent,
    });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-detail-sent")).toBeInTheDocument());

    // content, exactly as sent — no edit button any more
    expect(screen.getByTestId("admin-campaign-content-subject")).toHaveTextContent("Big sale");
    expect(screen.getByTestId("admin-campaign-content-callout")).toHaveTextContent("Hurry");
    expect(screen.queryByTestId("admin-campaign-edit-content-btn")).not.toBeInTheDocument();

    // who / when
    expect(screen.getByTestId("admin-campaign-detail-created")).toHaveTextContent("Asha Admin");
    expect(screen.getByTestId("admin-campaign-detail-sent")).not.toHaveTextContent("—");

    // the audience it went to, as plain sentences
    const summary = screen.getByTestId("admin-campaign-audience-summary");
    expect(summary).toHaveTextContent("No active subscription, but bought at least once");
    expect(summary).toHaveTextContent("Never bought the resilience report");
    expect(summary).toHaveTextContent("Has holdings");
    expect(summary).toHaveTextContent("Active in the last 30 days");

    // delivery stats still there
    await waitFor(() => expect(screen.getByTestId("admin-campaign-stat-targeted")).toHaveTextContent("2"));
  });

  it("a sent campaign for specific users lists who they were (masked)", async () => {
    mockDetail({
      ...FULL_DRAFT,
      status: "sent",
      sentAt: "2026-09-12T09:30:00.000Z",
      audience: "user_ids",
      userIds: ["u1", "u2"],
      audienceUsers: [{ id: "u1", name: "Ada Lovelace", email: "a***@example.com" }, { id: "u2", name: "Alan Turing", email: "a***@example.com" }],
      stats: { targeted: 2, sent: 4, failed: 0 },
    });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-audience-users")).toBeInTheDocument());
    expect(screen.getByTestId("admin-campaign-audience-summary")).toHaveTextContent("2 specific user(s)");
    expect(screen.getByTestId("admin-campaign-audience-users")).toHaveTextContent("Ada Lovelace — a***@example.com");
  });

  it("a sent campaign for everyone says so", async () => {
    mockDetail({ ...FULL_DRAFT, status: "sent", sentAt: "2026-09-12T09:30:00.000Z", audience: "all", stats: { targeted: 5, sent: 5, failed: 0 } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-audience-summary")).toHaveTextContent("Every active user."));
  });

  it("copes with a campaign that has no content configured", async () => {
    mockDetail({ ...DRAFT_CAMPAIGN, channels: ["in_app"], preview: null });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-content-unavailable")).toBeInTheDocument());
  });
});

// The "Email list" audience: people who aren't on Divve yet, emailed only.
const EMAIL_LISTS = [
  { name: "Launch", total: 10, subscribed: 8, unsubscribed: 2 },
  { name: "Beta", total: 3, subscribed: 3, unsubscribed: 0 },
];

function mockEmailListDetail(campaign, { lists = EMAIL_LISTS, previewResponse } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/admin/notification-campaigns/camp1") return Promise.resolve({ data: { campaign } });
    if (url === "/admin/notification-campaigns/camp1/stats") return Promise.resolve({ data: { stats: { targeted: 6, sent: 5, failed: 1, delivered: 5, opened: 0 } } });
    if (url === "/admin/notification-campaigns/camp1/preview") return Promise.resolve({ data: previewResponse });
    if (url === "/admin/external-lists") return Promise.resolve({ data: { lists, suppressedTotal: 2 } });
    if (url === "/admin/notification-categories") return Promise.resolve({ data: { categories: [{ key: "marketing", label: "Marketing" }] } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("NotificationCampaignDetail — email-list audience", () => {
  afterEach(() => jest.clearAllMocks());

  it("choosing 'Email list' loads the lists, and saving sends the list AND email-only channels", async () => {
    mockEmailListDetail({ ...FULL_DRAFT, channels: ["in_app", "popup"] });
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-audience-external")).toBeInTheDocument());
    expect(api.get).not.toHaveBeenCalledWith("/admin/external-lists");

    fireEvent.click(screen.getByTestId("admin-campaign-audience-external"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-external-list-select")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith("/admin/external-lists");
    expect(screen.getByTestId("admin-campaign-external-note")).toHaveTextContent("Goes by email only");
    await waitFor(() => expect(screen.getByRole("option", { name: "Launch (8 subscribed)" })).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("admin-campaign-external-list-select"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByTestId("admin-campaign-save-audience-btn"));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", { audience: "external", externalListKey: "Launch", channels: ["email"] })
    );
  });

  it("points to the Email lists tab when there are no lists yet", async () => {
    mockEmailListDetail(FULL_DRAFT, { lists: [] });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-audience-external")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-audience-external"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-external-no-lists")).toHaveTextContent("import one in the “Email lists” tab"));
  });

  it("loads the lists straight away for a draft that's already an email-list campaign, and previews with what's skipped", async () => {
    mockEmailListDetail(
      { ...FULL_DRAFT, audience: "external", externalListKey: "Launch", channels: ["email"] },
      { previewResponse: { count: 6, sample: [{ name: "Ada", email: "a**@example.com" }], skippedRegistered: 3, skippedUnsubscribed: 2 } }
    );
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-external-list-select")).toHaveValue("Launch"));
    fireEvent.click(screen.getByTestId("admin-campaign-preview-audience-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-preview-result")).toHaveTextContent("6 recipient(s)"));
    expect(screen.getByTestId("admin-campaign-preview-skipped")).toHaveTextContent("3 already on Divve, 2 unsubscribed");
  });

  it("an ordinary preview doesn't mention skipped people", async () => {
    mockEmailListDetail(FULL_DRAFT, { previewResponse: { count: 3, sample: [{ name: "Ada", email: "a***@example.com" }] } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-preview-audience-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-preview-audience-btn"));
    await waitFor(() => expect(screen.getByTestId("admin-campaign-preview-result")).toHaveTextContent("3 recipient(s)"));
    expect(screen.queryByTestId("admin-campaign-preview-skipped")).not.toBeInTheDocument();
  });

  it("the content editor locks an email-list campaign to the email channel, and saves it that way", async () => {
    mockEmailListDetail({ ...FULL_DRAFT, audience: "external", externalListKey: "Launch", channels: ["email"] });
    api.patch.mockResolvedValue({ data: { campaign: {} } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-edit-content-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-edit-content-btn"));

    expect(screen.getByTestId("admin-campaign-edit-channel-email")).toBeChecked();
    expect(screen.getByTestId("admin-campaign-edit-channel-in_app")).toBeDisabled();
    expect(screen.getByTestId("admin-campaign-edit-channel-popup")).toBeDisabled();
    expect(screen.getByTestId("admin-campaign-edit-email-only-note")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-campaign-edit-save-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/admin/notification-campaigns/camp1", expect.objectContaining({ channels: ["email"] })));
  });

  it("the send confirmation names the list and points at the preview count", async () => {
    mockEmailListDetail({ ...FULL_DRAFT, audience: "external", externalListKey: "Launch", channels: ["email"] });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-send-now-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("admin-campaign-send-now-btn"));
    expect(screen.getByTestId("admin-campaign-send-confirm")).toHaveTextContent("“Launch”");
    expect(screen.getByTestId("admin-campaign-send-confirm")).toHaveTextContent("Preview audience");
  });

  it("a SENT email-list campaign shows the list, what was skipped, and delivery WITHOUT 'Opened' (emails aren't tracked)", async () => {
    mockEmailListDetail({
      ...FULL_DRAFT,
      status: "sent",
      sentAt: "2026-09-12T09:30:00.000Z",
      audience: "external",
      externalListKey: "Launch",
      channels: ["email"],
      externalList: { name: "Launch", total: 10, subscribed: 8, unsubscribed: 2 },
      stats: { targeted: 6, sent: 5, failed: 1, skippedRegistered: 3, skippedUnsubscribed: 2 },
    });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-audience-external-title")).toHaveTextContent("Email list “Launch” — people who aren't on Divve yet"));
    expect(screen.getByTestId("admin-campaign-audience-external-list")).toHaveTextContent("10 contact(s): 8 subscribed, 2 unsubscribed");
    expect(screen.getByTestId("admin-campaign-audience-external-skipped")).toHaveTextContent("3 already on Divve, 2 unsubscribed");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-stat-failed")).toHaveTextContent("1"));
    expect(screen.queryByTestId("admin-campaign-stat-opened")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-campaign-stats-external-note")).toHaveTextContent("Opens aren't tracked");
  });

  it("a normal sent campaign still shows 'Opened' and no email-list wording", async () => {
    mockEmailListDetail({ ...FULL_DRAFT, status: "sent", sentAt: "2026-09-12T09:30:00.000Z", audience: "all", stats: { targeted: 5, sent: 5, failed: 0 } });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-stat-opened")).toBeInTheDocument());
    expect(screen.queryByTestId("admin-campaign-stat-failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-campaign-audience-external-title")).not.toBeInTheDocument();
  });
});

// Which address a campaign's emails go out from (no-reply vs the separate marketing address).
describe("NotificationCampaignDetail — email sender", () => {
  afterEach(() => jest.clearAllMocks());

  function mockWithSender(campaign, sender) {
    api.get.mockImplementation((url) => {
      if (url === "/admin/notification-campaigns/camp1") return Promise.resolve({ data: { campaign } });
      if (url === "/admin/notification-campaigns/camp1/sender") return sender instanceof Error ? Promise.reject(sender) : Promise.resolve({ data: { sender } });
      if (url === "/admin/notification-campaigns/camp1/stats") return Promise.resolve({ data: { stats: { targeted: 1, sent: 1, failed: 0, delivered: 1, opened: 0 } } });
      return Promise.reject(new Error("unexpected " + url));
    });
  }
  const MARKETING = { sendsEmail: true, kind: "marketing", from: "Divve Offers <offers@mail.example.com>", replyTo: null, ready: true, problem: null };

  it("shows the marketing address for a marketing-category campaign", async () => {
    mockWithSender({ ...DRAFT_CAMPAIGN, categoryKey: "marketing", channels: ["email"] }, MARKETING);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-detail-sender")).toHaveTextContent("Marketing address — Divve Offers <offers@mail.example.com>"));
    expect(screen.queryByTestId("admin-campaign-sender-warning")).not.toBeInTheDocument();
  });

  it("shows the no-reply address for any other category", async () => {
    mockWithSender({ ...DRAFT_CAMPAIGN, channels: ["email", "in_app"] }, { sendsEmail: true, kind: "system", from: "Divve <noreply@example.com>", replyTo: null, ready: true, problem: null });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-detail-sender")).toHaveTextContent("No-reply address — Divve <noreply@example.com>"));
  });

  it("warns on the send card when the marketing address isn't set up", async () => {
    mockWithSender(
      { ...DRAFT_CAMPAIGN, categoryKey: "marketing", channels: ["email"] },
      { sendsEmail: true, kind: "marketing", from: null, replyTo: null, ready: false, problem: "No marketing sender is set up. Set MARKETING_EMAIL_FROM in the backend .env and restart." }
    );
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByTestId("admin-campaign-sender-warning")).toHaveTextContent("Set MARKETING_EMAIL_FROM"));
    expect(screen.getByTestId("admin-campaign-dispatch-card")).toContainElement(screen.getByTestId("admin-campaign-sender-warning"));
  });

  it("shows nothing about a sender when the campaign sends no email", async () => {
    mockWithSender({ ...DRAFT_CAMPAIGN, categoryKey: "marketing", channels: ["in_app"] }, { sendsEmail: false, kind: null, from: null, replyTo: null, ready: true, problem: null });
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/notification-campaigns/camp1/sender"));
    expect(screen.queryByTestId("admin-campaign-detail-sender")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-campaign-sender-warning")).not.toBeInTheDocument();
  });

  it("the page still works if the sender can't be loaded", async () => {
    mockWithSender({ ...DRAFT_CAMPAIGN, channels: ["email"] }, new Error("boom"));
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/admin/notification-campaigns/camp1/sender"));
    expect(screen.queryByTestId("admin-campaign-detail-sender")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-campaign-send-now-btn")).toBeInTheDocument();
  });

  it("doesn't ask about the sender for a campaign that's already been sent", async () => {
    mockWithSender({ ...DRAFT_CAMPAIGN, status: "sent", categoryKey: "marketing", channels: ["email"], stats: { targeted: 1, sent: 1, failed: 0 } }, MARKETING);
    renderAt("/admin/notifications/campaigns/camp1");
    await waitFor(() => expect(screen.getByText("Announcement")).toBeInTheDocument());
    expect(api.get).not.toHaveBeenCalledWith("/admin/notification-campaigns/camp1/sender");
    expect(screen.queryByTestId("admin-campaign-detail-sender")).not.toBeInTheDocument();
  });
});
