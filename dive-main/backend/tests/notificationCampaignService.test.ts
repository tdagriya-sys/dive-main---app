import axios from "axios";
import { User } from "../src/models/User";
import { NotificationCategory } from "../src/models/NotificationCategory";
import { NotificationTemplate } from "../src/models/NotificationTemplate";
import { NotificationCampaign } from "../src/models/NotificationCampaign";
import { UserNotification } from "../src/models/UserNotification";
import { UserNotificationPref } from "../src/models/UserNotificationPref";
import * as campaignService from "../src/services/notificationCampaignService";

// Deterministic Resend mock — the real key in backend/.env fails with a 422
// in this sandbox (same as every other Resend-calling test file), which
// would make every "sent" assertion here flaky/slow. Mocking axios keeps
// this file fast and independent of that outside network state.
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CATEGORY = { key: "product", label: "Product", defaultChannels: ["in_app", "email"] as const, userOptOutAllowed: true };

let mobileCounter = 9860000000;
async function makeUser(name = "Recipient") {
  return User.create({ name, mobile: String(mobileCounter++), email: `recipient-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}
async function makeStaff() {
  return User.create({ name: "Staff", mobile: String(mobileCounter++), email: `staff-${mobileCounter}@example.com`, age: 30, passwordHash: "x", staffRole: "admin" });
}

beforeEach(() => {
  mockedAxios.post.mockResolvedValue({ data: { id: "resend_mock_id" } });
});

describe("createCampaign / updateCampaign", () => {
  it("rejects a nonexistent templateKey", async () => {
    const staff = await makeStaff();
    await expect(
      campaignService.createCampaign({ name: "C", templateKey: "nope", categoryKey: "product", channels: ["in_app"], audience: "all", createdBy: String(staff._id) })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates a draft with inline content", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Announcement",
      inlineContent: { subject: "Hi {{name}}", bodyMarkdown: "Hello **{{name}}**!" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    expect(campaign.status).toBe("draft");
  });

  it("only allows editing a draft campaign", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "A",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await NotificationCampaign.updateOne({ _id: campaign._id }, { status: "sent" });
    await expect(campaignService.updateCampaign(String(campaign._id), { name: "B" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("scheduleCampaign / cancelCampaign", () => {
  async function draftCampaign() {
    const staff = await makeStaff();
    return campaignService.createCampaign({
      name: "A",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
  }

  it("schedules a draft campaign for the future", async () => {
    const campaign = await draftCampaign();
    const scheduleAt = new Date(Date.now() + 60 * 60 * 1000);
    const scheduled = await campaignService.scheduleCampaign(String(campaign._id), scheduleAt);
    expect(scheduled.status).toBe("scheduled");
  });

  it("refuses to schedule a campaign with no content configured", async () => {
    const staff = await makeStaff();
    const campaign = await NotificationCampaign.create({ name: "Empty", categoryKey: "product", channels: ["in_app"], audience: "all", createdBy: staff._id, status: "draft" });
    await expect(campaignService.scheduleCampaign(String(campaign._id), new Date(Date.now() + 1000))).rejects.toMatchObject({ status: 400 });
  });

  it("cancels a draft or scheduled campaign but not a sent one", async () => {
    const campaign = await draftCampaign();
    const cancelled = await campaignService.cancelCampaign(String(campaign._id));
    expect(cancelled.status).toBe("cancelled");

    const sentCampaign = await draftCampaign();
    await NotificationCampaign.updateOne({ _id: sentCampaign._id }, { status: "sent" });
    await expect(campaignService.cancelCampaign(String(sentCampaign._id))).rejects.toMatchObject({ status: 400 });
  });
});

describe("sendCampaignNow", () => {
  it("delivers in_app + email to the resolved audience and records stats", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "Blast",
      inlineContent: { subject: "Hi {{name}}", bodyMarkdown: "Hello **{{name}}**, welcome!" },
      categoryKey: "product",
      channels: ["in_app", "email"],
      audience: "all",
      createdBy: String(staff._id),
    });

    const sent = await campaignService.sendCampaignNow(String(campaign._id));
    expect(sent.status).toBe("sent");
    expect(sent.stats?.targeted).toBe(1);
    expect(sent.stats?.sent).toBe(2); // one in_app + one email row for the single recipient

    const rows = await UserNotification.find({ userId: recipient._id }).lean();
    expect(rows.length).toBe(2);
    const inApp = rows.find((r) => r.channel === "in_app");
    expect(inApp?.title).toBe(`Hi ${recipient.name}`);
    expect(inApp?.body).toContain(recipient.name);
    const email = rows.find((r) => r.channel === "email");
    expect(email?.emailStatus).toBe("sent");
  });

  it("respects a per-user opt-out for one channel without blocking the other", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    await UserNotificationPref.create({ userId: recipient._id, categoryKey: "product", channel: "email", enabled: false });

    const campaign = await campaignService.createCampaign({
      name: "Blast2",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app", "email"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    const rows = await UserNotification.find({ userId: recipient._id }).lean();
    expect(rows.map((r) => r.channel)).toEqual(["in_app"]);
  });

  it("stores a bodyHtml on the in_app row too — not just email/popup — but downgraded: bold only, no highlight styling", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "Rich in_app",
      inlineContent: { subject: "S", bodyMarkdown: "Only ==3 days left==!" },
      categoryKey: "product",
      channels: ["in_app", "popup"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    const inApp = await UserNotification.findOne({ userId: recipient._id, channel: "in_app" }).lean();
    expect(inApp?.bodyHtml).toBe("Only 3 days left!");

    const popup = await UserNotification.findOne({ userId: recipient._id, channel: "popup" }).lean();
    expect(popup?.bodyHtml).toBe('Only <span style="color:#D4AF37;font-weight:bold">3 days left</span>!');
  });

  it("renders the callout above the body for email/popup, but never for in_app — and strips body images from in_app too", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "With callout",
      inlineContent: {
        subject: "S",
        bodyMarkdown: "Regular body text with a **bold** word and ![chart](https://example.com/chart.png).",
        callout: { text: "Hi {{name}}, big news!", imageUrl: "https://example.com/banner.gif" },
      },
      categoryKey: "product",
      channels: ["in_app", "popup"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    const popup = await UserNotification.findOne({ userId: recipient._id, channel: "popup" }).lean();
    expect(popup?.bodyHtml).toContain("<img"); // both the callout image and the body image
    expect(popup?.bodyHtml).toContain(`Hi ${recipient.name}, big news!`);
    expect(popup!.bodyHtml!.indexOf("big news")).toBeLessThan(popup!.bodyHtml!.indexOf("Regular body"));

    const inApp = await UserNotification.findOne({ userId: recipient._id, channel: "in_app" }).lean();
    expect(inApp?.bodyHtml).toBe("Regular body text with a <b>bold</b> word and .");
    expect(inApp?.bodyHtml).not.toContain("<img");
    expect(inApp?.bodyHtml).not.toContain("big news");
    expect(inApp?.bodyHtml).not.toContain("chart");
  });

  it("rejects sending a campaign that's already been sent", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Once",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ status: 400 });
  });
});

describe("getCampaignStats", () => {
  it("computes 'opened' live from readAt", async () => {
    const staff = await makeStaff();
    await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "Stats",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    const before = await campaignService.getCampaignStats(String(campaign._id));
    expect(before.opened).toBe(0);

    await UserNotification.updateMany({ campaignId: campaign._id }, { readAt: new Date() });
    const after = await campaignService.getCampaignStats(String(campaign._id));
    expect(after.opened).toBe(1);
    expect(after.delivered).toBe(1);
  });
});

describe("dispatchDueCampaigns", () => {
  it("sends only the campaigns whose scheduleAt has passed", async () => {
    const staff = await makeStaff();
    const due = await campaignService.createCampaign({
      name: "Due",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await NotificationCampaign.updateOne({ _id: due._id }, { status: "scheduled", scheduleAt: new Date(Date.now() - 1000) });

    const notYetDue = await campaignService.createCampaign({
      name: "NotYet",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await NotificationCampaign.updateOne({ _id: notYetDue._id }, { status: "scheduled", scheduleAt: new Date(Date.now() + 60 * 60 * 1000) });

    const result = await campaignService.dispatchDueCampaigns();
    expect(result.sent).toBe(1);

    const dueAfter = await NotificationCampaign.findById(due._id).lean();
    const notYetDueAfter = await NotificationCampaign.findById(notYetDue._id).lean();
    expect(dueAfter?.status).toBe("sent");
    expect(notYetDueAfter?.status).toBe("scheduled");
  });
});

describe("testSendCampaign", () => {
  it("sends a one-off test email without touching real UserNotification rows", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Test",
      inlineContent: { subject: "Hi {{name}}", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app", "email"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.testSendCampaign(String(campaign._id), "tester@example.com");
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ to: ["tester@example.com"], subject: expect.stringContaining("[TEST]") }),
      expect.anything()
    );
    const count = await UserNotification.countDocuments({});
    expect(count).toBe(0);
  });
});

describe("createCampaign with user_ids audience", () => {
  it("stores the given userIds as ObjectIds", async () => {
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "Direct",
      inlineContent: { subject: "S", bodyMarkdown: "B" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "user_ids",
      userIds: [String(recipient._id)],
      createdBy: String(staff._id),
    });
    expect(campaign.userIds?.map(String)).toEqual([String(recipient._id)]);
  });
});

describe("redirect links and the button", () => {
  it("bakes the button into popup/email HTML, but gives in_app only a plain body plus link/linkLabel fields", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "With button",
      inlineContent: {
        subject: "S",
        bodyMarkdown: "Read [our guide](https://example.com/guide) now.",
        button: { label: "Get started", url: "/?go=signup" },
      },
      categoryKey: "product",
      channels: ["in_app", "popup", "email"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    const popup = await UserNotification.findOne({ userId: recipient._id, channel: "popup" }).lean();
    expect(popup?.bodyHtml).toContain(">Get started</a>");
    expect(popup?.bodyHtml).toContain(">our guide</a>");

    const email = await UserNotification.findOne({ userId: recipient._id, channel: "email" }).lean();
    expect(email?.bodyHtml).toContain(">Get started</a>");

    const inApp = await UserNotification.findOne({ userId: recipient._id, channel: "in_app" }).lean();
    expect(inApp?.bodyHtml).toBe("Read our guide now.");
    expect(inApp?.link).toMatch(/\/\?go=signup$/);
    expect(inApp?.link).toMatch(/^https?:\/\//);
    expect(inApp?.linkLabel).toBe("Get started");
  });

  it("leaves link/linkLabel unset when the campaign has no button", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const recipient = await makeUser();
    const campaign = await campaignService.createCampaign({
      name: "No button",
      inlineContent: { subject: "S", bodyMarkdown: "Plain" },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.sendCampaignNow(String(campaign._id));
    const inApp = await UserNotification.findOne({ userId: recipient._id, channel: "in_app" }).lean();
    expect(inApp?.link).toBeUndefined();
    expect(inApp?.linkLabel).toBeUndefined();
  });

  it("sends a test email with the button included", async () => {
    await NotificationCategory.create(CATEGORY);
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Test button",
      inlineContent: { subject: "S", bodyMarkdown: "B", button: { label: "Go", url: "https://example.com/x" } },
      categoryKey: "product",
      channels: ["email"],
      audience: "all",
      createdBy: String(staff._id),
    });
    await campaignService.testSendCampaign(String(campaign._id), "qa@example.com");
    const sentHtml = (mockedAxios.post.mock.calls.at(-1)![1] as { html: string }).html;
    expect(sentHtml).toContain(">Go</a>");
  });
});

describe("editing a draft's content, and the send-time snapshot", () => {
  it("replaces inline content wholesale on update (so a removed button/callout really goes away)", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Editable",
      inlineContent: { subject: "Old subject", bodyMarkdown: "Old", callout: { text: "Old callout" }, button: { label: "Old", url: "/?go=login" } },
      categoryKey: "product",
      channels: ["in_app"],
      audience: "all",
      createdBy: String(staff._id),
    });
    const updated = await campaignService.updateCampaign(String(campaign._id), { inlineContent: { subject: "New subject", bodyMarkdown: "New body" }, channels: ["in_app", "email"] });
    expect(updated.inlineContent?.subject).toBe("New subject");
    expect(updated.inlineContent?.callout).toBeUndefined();
    expect(updated.inlineContent?.button).toBeUndefined();
    expect(updated.channels).toEqual(["in_app", "email"]);
  });

  it("switches a template-based draft to custom content by clearing templateKey", async () => {
    await NotificationCategory.create(CATEGORY);
    await NotificationTemplate.create({ key: "tpl", name: "Tpl", categoryKey: "product", subject: "Template subject", bodyMarkdown: "Template body", channels: ["in_app"] });
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({ name: "From tpl", templateKey: "tpl", categoryKey: "product", channels: ["in_app"], audience: "all", createdBy: String(staff._id) });
    const updated = await campaignService.updateCampaign(String(campaign._id), { templateKey: null, inlineContent: { subject: "Custom", bodyMarkdown: "Custom body" } });
    expect(updated.templateKey).toBeUndefined();
    const content = await campaignService.resolveContent(updated);
    expect(content.subject).toBe("Custom");
  });

  it("snapshots the resolved content at send time, so a later template edit doesn't change what the campaign shows", async () => {
    await NotificationCategory.create(CATEGORY);
    await NotificationTemplate.create({ key: "snap", name: "Snap", categoryKey: "product", subject: "Original subject", bodyMarkdown: "Original body", button: { label: "Original", url: "/?go=login" }, channels: ["in_app"] });
    const staff = await makeStaff();
    await makeUser();
    const campaign = await campaignService.createCampaign({ name: "Snap", templateKey: "snap", categoryKey: "product", channels: ["in_app"], audience: "all", createdBy: String(staff._id) });
    await campaignService.sendCampaignNow(String(campaign._id));

    await NotificationTemplate.updateOne({ key: "snap" }, { subject: "Edited later", bodyMarkdown: "Edited body", button: null });

    const sent = await NotificationCampaign.findById(campaign._id).lean();
    expect(sent?.sentContent?.subject).toBe("Original subject");
    expect(sent?.sentContent?.button?.label).toBe("Original");

    const preview = await campaignService.buildCampaignPreview(sent!);
    expect(preview.content.subject).toBe("Original subject");
    expect(preview.richHtml).toContain("Original body");
    expect(preview.richHtml).toContain(">Original</a>");
    expect(preview.inAppHtml).toBe("Original body");
  });

  it("previews a draft from its current content, with sample values for {{name}}", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({
      name: "Draft preview",
      inlineContent: { subject: "S", bodyMarkdown: "Hi **{{name}}**, see [this](https://example.com)", callout: { text: "Hello {{name}}" }, button: { label: "Go", url: "/?go=login" } },
      categoryKey: "product",
      channels: ["in_app", "popup"],
      audience: "all",
      createdBy: String(staff._id),
    });
    const preview = await campaignService.buildCampaignPreview(campaign);
    expect(preview.richHtml).toContain("Hello Recipient");
    expect(preview.richHtml).toContain("<b>Recipient</b>");
    expect(preview.richHtml).toContain(">Go</a>");
    expect(preview.inAppHtml).toBe("Hi <b>Recipient</b>, see this");
    expect(preview.inAppLink?.linkLabel).toBe("Go");
  });
});
