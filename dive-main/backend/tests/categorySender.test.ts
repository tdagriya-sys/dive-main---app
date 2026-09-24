import axios from "axios";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { NotificationCategory } from "../src/models/NotificationCategory";
import { NotificationCampaign } from "../src/models/NotificationCampaign";
import { UserNotification } from "../src/models/UserNotification";
import * as campaignService from "../src/services/notificationCampaignService";
import { describeCampaignSender } from "../src/services/campaignSenderService";
import { seedDefaultNotificationCategoriesIfEmpty } from "../src/services/notificationService";
import { requestOtp } from "../src/services/otpService";

// Which address a campaign to REGISTERED users is emailed from, decided by its
// category: a "marketing"-sender category goes out from the marketing address,
// every other category (and the sign-in code path) stays on the no-reply
// address — and a marketing send with no usable marketing address refuses
// rather than falling back to no-reply.

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NO_REPLY = "Divve <no-reply@example.com>";
const MARKETING_FROM = "Divve Offers <offers@marketing.example.com>";
type SentEmail = { from: string; reply_to?: string; to: string[]; subject: string };
const sentEmails = () => mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails")).map((c) => c[1] as SentEmail);

const realEnv = { placeholder: env.emailApiKeyIsPlaceholder, marketingFrom: env.marketingEmailFrom, replyTo: env.marketingEmailReplyTo, from: env.emailFrom };
beforeAll(() => {
  // Force the real-send branch so what's asserted is exactly what would go to Resend.
  env.emailApiKeyIsPlaceholder = false;
});
afterAll(() => {
  env.emailApiKeyIsPlaceholder = realEnv.placeholder;
  env.marketingEmailFrom = realEnv.marketingFrom;
  env.marketingEmailReplyTo = realEnv.replyTo;
  env.emailFrom = realEnv.from;
});
beforeEach(async () => {
  env.emailFrom = NO_REPLY;
  env.marketingEmailFrom = MARKETING_FROM;
  env.marketingEmailReplyTo = "";
  mockedAxios.post.mockReset();
  mockedAxios.post.mockResolvedValue({ data: { id: "resend_mock_id" } });
  await seedDefaultNotificationCategoriesIfEmpty(); // marketing -> marketing sender; product/score/... -> system
});

let mobileCounter = 9870000000;
async function makeUser() {
  return User.create({ name: "Recipient", mobile: String(mobileCounter++), email: `recipient-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}
async function makeStaff() {
  return User.create({ name: "Staff", mobile: String(mobileCounter++), email: `staff-${mobileCounter}@example.com`, age: 30, passwordHash: "x", staffRole: "admin" });
}
// A campaign to one specific registered user (never "all").
async function makeCampaign(categoryKey: string, channels: ("email" | "in_app" | "popup")[] = ["email"]) {
  const staff = await makeStaff();
  const user = await makeUser();
  const campaign = await campaignService.createCampaign({
    name: "C",
    inlineContent: { subject: "Hello {{name}}", bodyMarkdown: "Body" },
    categoryKey,
    channels,
    audience: "user_ids",
    userIds: [String(user._id)],
    createdBy: String(staff._id),
  });
  return { campaign, user };
}

describe("seeding the category's sender", () => {
  it("a fresh database seeds marketing as the marketing sender and every other category as no-reply", async () => {
    const cats = await NotificationCategory.find({}).lean();
    const byKey = Object.fromEntries(cats.map((c) => [c.key, c.emailSender]));
    expect(byKey.marketing).toBe("marketing");
    expect(byKey.account).toBe("system");
    expect(byKey.subscription).toBe("system");
    expect(byKey.product).toBe("system");
    expect(byKey.score).toBe("system");
  });

  it("an older database's marketing category (saved before the field existed) is backfilled on startup — but a value an admin chose is never overwritten", async () => {
    await NotificationCategory.deleteMany({});
    // Raw inserts — bypass the schema default, like a row from before the field existed.
    await NotificationCategory.collection.insertMany([
      { key: "marketing", label: "Marketing", defaultChannels: ["email"], userOptOutAllowed: true, isSystem: false },
      { key: "product", label: "Product", defaultChannels: ["in_app"], userOptOutAllowed: true, isSystem: false },
    ]);
    await seedDefaultNotificationCategoriesIfEmpty();
    expect((await NotificationCategory.findOne({ key: "marketing" }).lean())?.emailSender).toBe("marketing");
    expect((await NotificationCategory.findOne({ key: "product" }).lean())?.emailSender).toBeUndefined(); // untouched (reads as "system")

    // An admin deliberately switches marketing back to no-reply; a restart must respect that.
    await NotificationCategory.updateOne({ key: "marketing" }, { emailSender: "system" });
    await seedDefaultNotificationCategoriesIfEmpty();
    expect((await NotificationCategory.findOne({ key: "marketing" }).lean())?.emailSender).toBe("system");
  });
});

describe("a campaign to registered users sends from the sender its category names", () => {
  it("marketing category → the marketing address (with its reply-to), and the recipient's notification row is marked sent", async () => {
    env.marketingEmailReplyTo = "support@example.com";
    const { campaign, user } = await makeCampaign("marketing");
    const sent = await campaignService.sendCampaignNow(String(campaign._id));

    expect(sent.status).toBe("sent");
    expect(sent.stats).toMatchObject({ targeted: 1, sent: 1, failed: 0 });
    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0]).toMatchObject({ from: MARKETING_FROM, reply_to: "support@example.com", to: [user.email] });
    expect((await UserNotification.findOne({ userId: user._id, channel: "email" }).lean())?.emailStatus).toBe("sent");
  });

  it("any other category → the no-reply address, with no reply-to, even when a marketing reply-to is configured", async () => {
    env.marketingEmailReplyTo = "support@example.com";
    const { campaign } = await makeCampaign("product");
    await campaignService.sendCampaignNow(String(campaign._id));

    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0].from).toBe(NO_REPLY);
    expect(sentEmails()[0].reply_to).toBeUndefined();
  });

  it("the choice is read at send time — switching the category takes effect on the next send, both ways", async () => {
    await NotificationCategory.updateOne({ key: "marketing" }, { emailSender: "system" });
    const first = await makeCampaign("marketing");
    await campaignService.sendCampaignNow(String(first.campaign._id));
    expect(sentEmails().at(-1)?.from).toBe(NO_REPLY);

    await NotificationCategory.updateOne({ key: "product" }, { emailSender: "marketing" });
    const second = await makeCampaign("product");
    await campaignService.sendCampaignNow(String(second.campaign._id));
    expect(sentEmails().at(-1)?.from).toBe(MARKETING_FROM);
  });

  it("a category that no longer exists is treated as no-reply (never blocked)", async () => {
    const { campaign } = await makeCampaign("deleted_category");
    await campaignService.sendCampaignNow(String(campaign._id));
    expect(sentEmails()[0].from).toBe(NO_REPLY);
  });

  it("a test email goes from the same address the real send will use", async () => {
    const marketing = await makeCampaign("marketing");
    await campaignService.testSendCampaign(String(marketing.campaign._id), "me@example.com");
    expect(sentEmails().at(-1)).toMatchObject({ from: MARKETING_FROM, to: ["me@example.com"] });

    const product = await makeCampaign("product");
    await campaignService.testSendCampaign(String(product.campaign._id), "me@example.com");
    expect(sentEmails().at(-1)).toMatchObject({ from: NO_REPLY, to: ["me@example.com"] });
  });

  it("sign-in codes stay on the no-reply address, in the same run as a marketing campaign", async () => {
    env.marketingEmailReplyTo = "support@example.com";
    const { campaign } = await makeCampaign("marketing");
    await campaignService.sendCampaignNow(String(campaign._id));
    await requestOtp("9999999998", "signup", "otp-recipient@example.com");

    const froms = sentEmails().map((e) => e.from);
    expect(froms).toEqual([MARKETING_FROM, NO_REPLY]);
    expect(sentEmails()[1].reply_to).toBeUndefined();
    expect(env.emailFrom).toBe(NO_REPLY); // the no-reply setting itself is never touched
  });
});

describe("a marketing-sender campaign with no usable marketing address refuses — it never falls back to no-reply", () => {
  it("send: refused with a clear message BEFORE anything goes out — the campaign stays a draft and nobody is emailed or notified", async () => {
    env.marketingEmailFrom = "";
    const { campaign, user } = await makeCampaign("marketing", ["email", "in_app"]);

    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY", message: expect.stringContaining("MARKETING_EMAIL_FROM") });
    expect((await NotificationCampaign.findById(campaign._id).lean())?.status).toBe("draft");
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(await UserNotification.countDocuments({ userId: user._id })).toBe(0);

    // …and once a marketing address is configured, the same campaign sends.
    env.marketingEmailFrom = MARKETING_FROM;
    await expect(campaignService.sendCampaignNow(String(campaign._id))).resolves.toMatchObject({ status: "sent" });
    expect(sentEmails()[0].from).toBe(MARKETING_FROM);
  });

  it("schedule and test-send are refused too", async () => {
    env.marketingEmailFrom = "";
    const { campaign } = await makeCampaign("marketing");
    await expect(campaignService.scheduleCampaign(String(campaign._id), new Date(Date.now() + 3600_000))).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY" });
    await expect(campaignService.testSendCampaign(String(campaign._id), "me@example.com")).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY" });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("the marketing address being the same as the no-reply address is refused (display name and case ignored)", async () => {
    env.marketingEmailFrom = "Offers <NO-REPLY@example.com>";
    const { campaign } = await makeCampaign("marketing");
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY", message: expect.stringContaining("same address") });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("a campaign with no email channel is never blocked by a missing marketing address", async () => {
    env.marketingEmailFrom = "";
    const { campaign, user } = await makeCampaign("marketing", ["in_app"]);
    await expect(campaignService.sendCampaignNow(String(campaign._id))).resolves.toMatchObject({ status: "sent" });
    expect(await UserNotification.countDocuments({ userId: user._id, channel: "in_app" })).toBe(1);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("a campaign in a no-reply category is unaffected by a missing marketing address", async () => {
    env.marketingEmailFrom = "";
    const { campaign } = await makeCampaign("product");
    await expect(campaignService.sendCampaignNow(String(campaign._id))).resolves.toMatchObject({ status: "sent" });
    expect(sentEmails()[0].from).toBe(NO_REPLY);
  });

  it("a scheduled campaign whose marketing address disappears before it's due is marked failed (not retried every minute)", async () => {
    const { campaign } = await makeCampaign("marketing");
    await campaignService.scheduleCampaign(String(campaign._id), new Date(Date.now() + 3600_000));
    await NotificationCampaign.updateOne({ _id: campaign._id }, { scheduleAt: new Date(Date.now() - 1000) });
    env.marketingEmailFrom = "";

    expect(await campaignService.dispatchDueCampaigns()).toEqual({ sent: 0, failed: 1 });
    const after = await NotificationCampaign.findById(campaign._id).lean();
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("MARKETING_EMAIL_FROM");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("dev mode (no real email key) needs no marketing address — nothing is actually sent", async () => {
    env.emailApiKeyIsPlaceholder = true;
    env.marketingEmailFrom = "";
    try {
      const { campaign } = await makeCampaign("marketing");
      await expect(campaignService.sendCampaignNow(String(campaign._id))).resolves.toMatchObject({ status: "sent" });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    } finally {
      env.emailApiKeyIsPlaceholder = false;
    }
  });
});

describe("describeCampaignSender (what the admin screen shows)", () => {
  it("reports the marketing address, the no-reply address, or 'no email' — and whether it can send", async () => {
    env.marketingEmailReplyTo = "support@example.com";
    expect(await describeCampaignSender({ audience: "all", categoryKey: "marketing", channels: ["email"] })).toMatchObject({ sendsEmail: true, kind: "marketing", from: MARKETING_FROM, replyTo: "support@example.com", ready: true, problem: null });
    expect(await describeCampaignSender({ audience: "all", categoryKey: "product", channels: ["email", "in_app"] })).toMatchObject({ sendsEmail: true, kind: "system", from: NO_REPLY, ready: true });
    expect(await describeCampaignSender({ audience: "all", categoryKey: "marketing", channels: ["in_app"] })).toMatchObject({ sendsEmail: false, kind: null, ready: true });
    // An email-list campaign is always marketing, whatever its category says.
    expect(await describeCampaignSender({ audience: "external", categoryKey: "product", channels: ["email"] })).toMatchObject({ kind: "marketing", from: MARKETING_FROM });

    env.marketingEmailFrom = "";
    expect(await describeCampaignSender({ audience: "all", categoryKey: "marketing", channels: ["email"] })).toMatchObject({ kind: "marketing", ready: false, problem: expect.stringContaining("MARKETING_EMAIL_FROM") });
    expect(await describeCampaignSender({ audience: "all", categoryKey: "product", channels: ["email"] })).toMatchObject({ kind: "system", ready: true });
  });
});
