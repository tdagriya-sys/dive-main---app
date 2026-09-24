import axios from "axios";
import { Types } from "mongoose";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { ExternalContact } from "../src/models/ExternalContact";
import { ExternalDelivery } from "../src/models/ExternalDelivery";
import { NotificationCampaign } from "../src/models/NotificationCampaign";
import { UserNotification } from "../src/models/UserNotification";
import * as campaignService from "../src/services/notificationCampaignService";
import * as externalContactService from "../src/services/externalContactService";
import { resolveAudienceUserIds } from "../src/services/notificationAudienceService";
import { verifyUnsubscribeToken } from "../src/services/unsubscribeService";
import { requestOtp } from "../src/services/otpService";

// Sending a campaign to an imported (non-user) email list: personalized per
// person, batched, with an unsubscribe link in every email, skipping anyone
// who already has an account or has opted out — and never, ever resolving to
// "all users".

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

type ResendMode = { batch?: "ok" | "reject" | "network"; failSingles?: string[] };
function mockResend({ batch = "ok", failSingles = [] }: ResendMode = {}) {
  mockedAxios.isAxiosError.mockImplementation(((e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError)) as unknown as typeof axios.isAxiosError);
  mockedAxios.post.mockImplementation((async (url: string, body: unknown) => {
    if (url.endsWith("/emails/batch")) {
      if (batch === "reject") throw Object.assign(new Error("Request failed with status code 422"), { isAxiosError: true, response: { status: 422 } });
      if (batch === "network") throw Object.assign(new Error("timeout of 20000ms exceeded"), { isAxiosError: true });
      return { data: { data: (body as unknown[]).map((_, i) => ({ id: `b${i}` })) } };
    }
    const to = (body as { to: string[] }).to[0];
    if (failSingles.includes(to)) throw Object.assign(new Error("Request failed with status code 422"), { isAxiosError: true, response: { status: 422 } });
    return { data: { id: "single" } };
  }) as unknown as typeof axios.post);
}

const batchCalls = () => mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails/batch"));
const singleCalls = () => mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails"));
type SentEmail = { from: string; reply_to?: string; to: string[]; subject: string; html: string; headers?: Record<string, string> };
const allBatchedEmails = () => batchCalls().flatMap((c) => c[1] as SentEmail[]);

let mobileCounter = 9800000000;
async function makeStaff() {
  return User.create({ name: "Staff", mobile: String(mobileCounter++), email: `staff-${mobileCounter}@example.com`, age: 30, passwordHash: "x", staffRole: "admin" });
}
async function makeUser(email: string) {
  return User.create({ name: "Existing User", mobile: String(mobileCounter++), email, age: 30, passwordHash: "x" });
}
async function importList(listName: string, contacts: { email: string; name?: string }[]) {
  return externalContactService.importContacts({ listName, source: "test import", attestedBy: String(new Types.ObjectId()), contacts });
}
async function makeCampaign(listKey: string, content: Partial<{ subject: string; bodyMarkdown: string; callout: { text?: string }; button: { label: string; url: string } }> = {}) {
  const staff = await makeStaff();
  return campaignService.createCampaign({
    name: "Onboarding",
    inlineContent: { subject: "Hello", bodyMarkdown: "Body", ...content },
    categoryKey: "marketing",
    channels: ["email"],
    audience: "external",
    externalListKey: listKey,
    createdBy: String(staff._id),
  });
}

const MARKETING_FROM = "Divve Offers <offers@marketing.example.com>";
const realEnv = { placeholder: env.emailApiKeyIsPlaceholder, marketingFrom: env.marketingEmailFrom, replyTo: env.marketingEmailReplyTo, from: env.emailFrom };
beforeAll(() => {
  // Force the real-send branch so what's asserted here is exactly what would go to Resend.
  env.emailApiKeyIsPlaceholder = false;
});
afterAll(() => {
  env.emailApiKeyIsPlaceholder = realEnv.placeholder;
  env.marketingEmailFrom = realEnv.marketingFrom;
  env.marketingEmailReplyTo = realEnv.replyTo;
  env.emailFrom = realEnv.from;
});
beforeEach(() => {
  // A known no-reply sender, and a distinct, configured marketing sender.
  env.emailFrom = "Divve <no-reply@example.com>";
  env.marketingEmailFrom = MARKETING_FROM;
  env.marketingEmailReplyTo = "";
  mockedAxios.post.mockReset();
  mockResend();
});

describe("creating / editing an email-list campaign", () => {
  it("requires a list and email as the only channel", async () => {
    const staff = await makeStaff();
    const base = { name: "C", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", audience: "external" as const, createdBy: String(staff._id) };
    await expect(campaignService.createCampaign({ ...base, channels: ["email"] })).rejects.toMatchObject({ code: "EXTERNAL_LIST_REQUIRED" });
    await expect(campaignService.createCampaign({ ...base, channels: ["email", "in_app"], externalListKey: "L" })).rejects.toMatchObject({ code: "EXTERNAL_EMAIL_ONLY" });
    await expect(campaignService.createCampaign({ ...base, channels: ["popup"], externalListKey: "L" })).rejects.toMatchObject({ code: "EXTERNAL_EMAIL_ONLY" });
    await expect(campaignService.createCampaign({ ...base, channels: ["email"], externalListKey: "L" })).resolves.toMatchObject({ audience: "external", externalListKey: "L" });
  });

  it("switching a draft to an email list needs email-only channels in the same edit; switching away clears the list", async () => {
    const staff = await makeStaff();
    const draft = await campaignService.createCampaign({ name: "C", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["in_app"], audience: "all", createdBy: String(staff._id) });

    await expect(campaignService.updateCampaign(String(draft._id), { audience: "external", externalListKey: "L" })).rejects.toMatchObject({ code: "EXTERNAL_EMAIL_ONLY" });
    const switched = await campaignService.updateCampaign(String(draft._id), { audience: "external", externalListKey: "L", channels: ["email"] });
    expect(switched.audience).toBe("external");

    const back = await campaignService.updateCampaign(String(draft._id), { audience: "all", channels: ["in_app"] });
    expect(back.externalListKey).toBeUndefined();
  });

  it("refuses to schedule an email-list campaign that has no list", async () => {
    const campaign = await makeCampaign("L");
    await NotificationCampaign.updateOne({ _id: campaign._id }, { $unset: { externalListKey: 1 } });
    await expect(campaignService.scheduleCampaign(String(campaign._id), new Date(Date.now() + 3600_000))).rejects.toMatchObject({ code: "EXTERNAL_LIST_REQUIRED" });
  });

  it("an external audience can never resolve to user ids — it must not fall through to 'all users'", async () => {
    await makeUser("someone@example.com");
    await expect(resolveAudienceUserIds({ audience: "external" })).rejects.toThrow(/no user ids/);
  });
});

describe("sendCampaignNow — to an email list", () => {
  it("emails every deliverable contact in ONE batch call, personalized with their own name (or 'there')", async () => {
    await importList("Launch", [{ email: "ada@example.com", name: "Ada Lovelace" }, { email: "alan@example.com", name: "Alan" }, { email: "nameless@example.com" }]);
    const campaign = await makeCampaign("Launch", {
      subject: "Welcome, {{first_name}}!",
      bodyMarkdown: "Dear {{name}}, your email is {{email}}. Hi {{first_name}}.",
      callout: { text: "Hello {{first_name}}" },
    });
    await campaignService.sendCampaignNow(String(campaign._id));

    expect(batchCalls()).toHaveLength(1);
    expect(singleCalls()).toHaveLength(0);
    const emails = allBatchedEmails();
    expect(emails).toHaveLength(3);

    const ada = emails.find((e) => e.to[0] === "ada@example.com")!;
    expect(ada.from).toBe(MARKETING_FROM);
    expect(ada.subject).toBe("Welcome, Ada!");
    expect(ada.html).toContain("Dear Ada Lovelace, your email is ada@example.com. Hi Ada.");
    expect(ada.html).toContain("Hello Ada");

    const alan = emails.find((e) => e.to[0] === "alan@example.com")!;
    expect(alan.subject).toBe("Welcome, Alan!");
    expect(alan.html).toContain("Dear Alan,");

    // No name on file -> "there", never an empty "Hi ,".
    const nameless = emails.find((e) => e.to[0] === "nameless@example.com")!;
    expect(nameless.subject).toBe("Welcome, there!");
    expect(nameless.html).toContain("Dear there, your email is nameless@example.com. Hi there.");
  });

  it("puts a working, per-person unsubscribe link in the footer AND in the List-Unsubscribe headers", async () => {
    await importList("Launch", [{ email: "ada@example.com" }, { email: "alan@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await campaignService.sendCampaignNow(String(campaign._id));

    for (const email of allBatchedEmails()) {
      const contact = await ExternalContact.findOne({ email: email.to[0] }).lean();
      const url = email.headers!["List-Unsubscribe"].replace(/^<|>$/g, "");
      expect(url).toMatch(/\/unsubscribe\/[a-f0-9]{24}\.[A-Za-z0-9_-]+$/);
      expect(verifyUnsubscribeToken(url.split("/unsubscribe/")[1])).toBe(String(contact!._id));
      expect(email.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(email.html).toContain(`href="${url}"`);
      expect(email.html).toContain("unsubscribe");
    }
    // each person's link is different
    const urls = allBatchedEmails().map((e) => e.headers!["List-Unsubscribe"]);
    expect(new Set(urls).size).toBe(2);
  });

  it("includes the callout, links and button in the email just like a normal campaign", async () => {
    await importList("Launch", [{ email: "ada@example.com" }]);
    const campaign = await makeCampaign("Launch", { bodyMarkdown: "Read [our guide](https://example.com/guide)", button: { label: "Get started", url: "https://example.com/signup" } });
    await campaignService.sendCampaignNow(String(campaign._id));
    const html = allBatchedEmails()[0].html;
    expect(html).toContain('>our guide</a>');
    expect(html).toContain(">Get started</a>");
  });

  it("skips people who already have a Divve account and people who unsubscribed, and records exactly who was mailed", async () => {
    await makeUser("member@example.com");
    await importList("Launch", [{ email: "yes@example.com" }, { email: "member@example.com" }, { email: "optout@example.com" }]);
    await ExternalContact.updateOne({ email: "optout@example.com" }, { unsubscribed: true });

    const campaign = await makeCampaign("Launch");
    const sent = await campaignService.sendCampaignNow(String(campaign._id));

    expect(allBatchedEmails().map((e) => e.to[0])).toEqual(["yes@example.com"]);
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeTruthy();
    expect(sent.stats).toMatchObject({ targeted: 1, sent: 1, failed: 0, skippedRegistered: 1, skippedUnsubscribed: 1 });

    const deliveries = await ExternalDelivery.find({ campaignId: campaign._id }).lean();
    expect(deliveries.map((d) => [d.email, d.status])).toEqual([["yes@example.com", "sent"]]);
  });

  it("creates NO in-app/popup/email UserNotification rows — not even for a registered user on the list", async () => {
    const member = await makeUser("member@example.com");
    await importList("Launch", [{ email: "yes@example.com" }, { email: "member@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await campaignService.sendCampaignNow(String(campaign._id));
    expect(await UserNotification.countDocuments({})).toBe(0);
    expect(await UserNotification.countDocuments({ userId: member._id })).toBe(0);
  });

  it("snapshots the content that went out, and can't be sent twice", async () => {
    await importList("Launch", [{ email: "a@example.com" }]);
    const campaign = await makeCampaign("Launch", { subject: "Original", bodyMarkdown: "Original body" });
    await campaignService.sendCampaignNow(String(campaign._id));
    const doc = await NotificationCampaign.findById(campaign._id).lean();
    expect(doc!.sentContent).toMatchObject({ subject: "Original", bodyMarkdown: "Original body" });
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "CANNOT_SEND" });
    expect(batchCalls()).toHaveLength(1);
  });

  it("splits a big list into batches of 100", async () => {
    await importList("Big", Array.from({ length: 250 }, (_, i) => ({ email: `p${i}@example.com`, name: `Person ${i}` })));
    const campaign = await makeCampaign("Big");
    const sent = await campaignService.sendCampaignNow(String(campaign._id));
    expect(batchCalls().map((c) => (c[1] as unknown[]).length)).toEqual([100, 100, 50]);
    expect(sent.stats).toMatchObject({ targeted: 250, sent: 250, failed: 0 });
    expect(await ExternalDelivery.countDocuments({ campaignId: campaign._id, status: "sent" })).toBe(250);
  });

  it("reports delivery stats from ExternalDelivery (and opened is always 0 — no tracking)", async () => {
    await importList("Launch", [{ email: "a@example.com" }, { email: "b@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await campaignService.sendCampaignNow(String(campaign._id));
    expect(await campaignService.getCampaignStats(String(campaign._id))).toEqual({ targeted: 2, sent: 2, failed: 0, delivered: 2, opened: 0 });
  });
});

describe("sendCampaignNow — when the email provider rejects things", () => {
  it("if the batch is REJECTED, falls back to one-by-one so one bad address doesn't sink the rest", async () => {
    mockResend({ batch: "reject", failSingles: ["bad@example.com"] });
    await importList("Launch", [{ email: "good1@example.com" }, { email: "bad@example.com" }, { email: "good2@example.com" }]);
    const campaign = await makeCampaign("Launch");
    const sent = await campaignService.sendCampaignNow(String(campaign._id));

    expect(batchCalls()).toHaveLength(1);
    expect(singleCalls()).toHaveLength(3);
    // the per-email unsubscribe headers survive the fallback
    expect((singleCalls()[0][1] as SentEmail).headers!["List-Unsubscribe"]).toMatch(/\/unsubscribe\//);

    expect(sent.status).toBe("sent");
    expect(sent.stats).toMatchObject({ targeted: 3, sent: 2, failed: 1 });
    const deliveries = await ExternalDelivery.find({ campaignId: campaign._id }).lean();
    expect(Object.fromEntries(deliveries.map((d) => [d.email, d.status]))).toEqual({ "good1@example.com": "sent", "bad@example.com": "failed", "good2@example.com": "sent" });
  });

  it("on a network error/timeout, marks the batch failed and does NOT retry one-by-one (it may already have gone out — retrying could send duplicates)", async () => {
    mockResend({ batch: "network" });
    await importList("Launch", [{ email: "a@example.com" }, { email: "b@example.com" }]);
    const campaign = await makeCampaign("Launch");
    const sent = await campaignService.sendCampaignNow(String(campaign._id));
    expect(singleCalls()).toHaveLength(0);
    expect(sent.stats).toMatchObject({ targeted: 2, sent: 0, failed: 2 });
    expect(await ExternalDelivery.countDocuments({ campaignId: campaign._id, status: "failed" })).toBe(2);
  });
});

describe("pre-flight checks leave the campaign a fixable draft", () => {
  async function insertHugeList(name: string) {
    const now = new Date();
    await ExternalContact.insertMany(
      Array.from({ length: externalContactService.MAX_EXTERNAL_RECIPIENTS + 1 }, (_, i) => ({
        email: `huge${i}@example.com`, lists: [name], source: "s", unsubscribed: false, consentAttestedBy: new Types.ObjectId(), consentAttestedAt: now, lastImportedAt: now,
      }))
    );
  }

  it("a list that's too big is a clear error, the campaign stays a draft, and nothing is sent", async () => {
    await insertHugeList("Huge");
    const campaign = await makeCampaign("Huge");
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "EXTERNAL_LIST_TOO_LARGE" });
    expect((await NotificationCampaign.findById(campaign._id).lean())!.status).toBe("draft");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("re-checks the channel rule at send time (e.g. if the record was changed behind the API's back)", async () => {
    await importList("Launch", [{ email: "a@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await NotificationCampaign.updateOne({ _id: campaign._id }, { channels: ["in_app", "email"] });
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "EXTERNAL_EMAIL_ONLY" });
    expect((await NotificationCampaign.findById(campaign._id).lean())!.status).toBe("draft");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("a SCHEDULED email-list campaign that can't be sent is marked failed with the reason, not retried every minute forever", async () => {
    await insertHugeList("Huge");
    const campaign = await makeCampaign("Huge");
    await NotificationCampaign.updateOne({ _id: campaign._id }, { status: "scheduled", scheduleAt: new Date(Date.now() - 1000) });

    const first = await campaignService.dispatchDueCampaigns();
    expect(first).toEqual({ sent: 0, failed: 1 });
    const doc = await NotificationCampaign.findById(campaign._id).lean();
    expect(doc!.status).toBe("failed");
    expect(doc!.error).toMatch(/split it into smaller lists/);

    expect(await campaignService.dispatchDueCampaigns()).toEqual({ sent: 0, failed: 0 });
  });
});

describe("testSendCampaign for an email-list campaign", () => {
  it("includes the unsubscribe footer so the sender sees the real thing", async () => {
    await importList("Launch", [{ email: "a@example.com" }]);
    const campaign = await makeCampaign("Launch", { subject: "Hi {{first_name}}" });
    await campaignService.testSendCampaign(String(campaign._id), "qa@example.com");
    const sent = singleCalls().at(-1)![1] as SentEmail;
    expect(sent.to).toEqual(["qa@example.com"]);
    expect(sent.subject).toBe("[TEST] Hi Test");
    expect(sent.html).toContain("unsubscribe");
  });

  it("does not add the footer to an ordinary (registered-user) campaign", async () => {
    const staff = await makeStaff();
    const campaign = await campaignService.createCampaign({ name: "Normal", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["email"], audience: "all", createdBy: String(staff._id) });
    await campaignService.testSendCampaign(String(campaign._id), "qa@example.com");
    expect((singleCalls().at(-1)![1] as SentEmail).html).not.toContain("unsubscribe");
  });
});

// Marketing mail goes out from its OWN address (MARKETING_EMAIL_FROM) and must
// never touch the no-reply address that sends sign-in codes.
describe("the marketing sender is separate from the no-reply sender", () => {
  const NO_REPLY = "Divve <no-reply@example.com>";

  it("sends an email-list campaign AS the marketing address, with the optional reply-to", async () => {
    env.marketingEmailReplyTo = "hello@marketing.example.com";
    await importList("Launch", [{ email: "a@example.com" }, { email: "b@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await campaignService.sendCampaignNow(String(campaign._id));
    for (const email of allBatchedEmails()) {
      expect(email.from).toBe(MARKETING_FROM);
      expect(email.from).not.toBe(NO_REPLY);
      expect(email.reply_to).toBe("hello@marketing.example.com");
    }
  });

  it("leaves reply_to off entirely when no reply-to is configured", async () => {
    await importList("Launch", [{ email: "a@example.com" }]);
    await campaignService.sendCampaignNow(String((await makeCampaign("Launch"))._id));
    expect(allBatchedEmails()[0]).not.toHaveProperty("reply_to");
  });

  it("the one-by-one fallback (after a rejected batch) is ALSO sent as the marketing address", async () => {
    mockResend({ batch: "reject" });
    await importList("Launch", [{ email: "a@example.com" }, { email: "b@example.com" }]);
    await campaignService.sendCampaignNow(String((await makeCampaign("Launch"))._id));
    expect(singleCalls()).toHaveLength(2);
    for (const call of singleCalls()) expect((call[1] as SentEmail).from).toBe(MARKETING_FROM);
  });

  it("a test send of an email-list campaign goes from the marketing address", async () => {
    await importList("Launch", [{ email: "a@example.com" }]);
    await campaignService.testSendCampaign(String((await makeCampaign("Launch"))._id), "qa@example.com");
    expect((singleCalls().at(-1)![1] as SentEmail).from).toBe(MARKETING_FROM);
  });

  it("sign-in codes and ordinary campaigns STILL go from the no-reply address while a marketing sender is configured", async () => {
    // a sign-in code
    await requestOtp("9999999999", "signup", "otp-recipient@example.com");
    const otp = singleCalls().at(-1)![1] as SentEmail;
    expect(otp.to).toEqual(["otp-recipient@example.com"]);
    expect(otp.from).toBe(NO_REPLY);
    expect(otp).not.toHaveProperty("reply_to");

    // a campaign to registered users (test send)
    const staff = await makeStaff();
    const normal = await campaignService.createCampaign({ name: "Normal", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["email"], audience: "all", createdBy: String(staff._id) });
    env.marketingEmailReplyTo = "hello@marketing.example.com"; // even with a marketing reply-to set
    await campaignService.testSendCampaign(String(normal._id), "qa@example.com");
    const normalMail = singleCalls().at(-1)![1] as SentEmail;
    expect(normalMail.from).toBe(NO_REPLY);
    expect(normalMail).not.toHaveProperty("reply_to");

    // ...and an email-list campaign, in the same run, still goes from marketing
    await importList("Launch", [{ email: "a@example.com" }]);
    await campaignService.sendCampaignNow(String((await makeCampaign("Launch"))._id));
    expect(allBatchedEmails()[0].from).toBe(MARKETING_FROM);
    // the no-reply setting was never modified by any of this
    expect(env.emailFrom).toBe(NO_REPLY);
  });

  it("with NO marketing sender configured, an email-list campaign refuses to send — it never falls back to the no-reply address", async () => {
    env.marketingEmailFrom = "";
    await importList("Launch", [{ email: "a@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ status: 400, code: "MARKETING_SENDER_NOT_READY" });
    // still a fixable draft, and not one email went out
    expect((await NotificationCampaign.findById(campaign._id).lean())!.status).toBe("draft");
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(await ExternalDelivery.countDocuments({})).toBe(0);
  });

  it("scheduling and test-sending are refused too when there's no marketing sender", async () => {
    env.marketingEmailFrom = "";
    await importList("Launch", [{ email: "a@example.com" }]);
    const campaign = await makeCampaign("Launch");
    await expect(campaignService.scheduleCampaign(String(campaign._id), new Date(Date.now() + 3600_000))).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY" });
    await expect(campaignService.testSendCampaign(String(campaign._id), "qa@example.com")).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY" });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("refuses a marketing sender that's the SAME address as the no-reply one (display name and case ignored)", async () => {
    for (const same of ["no-reply@example.com", "Divve Marketing <NO-REPLY@Example.com>"]) {
      env.marketingEmailFrom = same;
      await importList("Launch", [{ email: "a@example.com" }]);
      const campaign = await makeCampaign("Launch");
      await expect(campaignService.sendCampaignNow(String(campaign._id))).rejects.toMatchObject({ code: "MARKETING_SENDER_NOT_READY" });
      await NotificationCampaign.deleteMany({});
    }
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("in dev mode (no real email key) no marketing sender is needed — nothing is actually sent", async () => {
    env.emailApiKeyIsPlaceholder = true;
    env.marketingEmailFrom = "";
    try {
      await importList("Launch", [{ email: "a@example.com" }, { email: "b@example.com" }]);
      const campaign = await makeCampaign("Launch");
      const sent = await campaignService.sendCampaignNow(String(campaign._id));
      expect(sent.stats).toMatchObject({ targeted: 2, sent: 2, failed: 0 });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    } finally {
      env.emailApiKeyIsPlaceholder = false;
    }
  });

  it("reports the sender status: ready / no sender / same as no-reply", () => {
    expect(externalContactService.marketingSenderStatus()).toMatchObject({ from: MARKETING_FROM, ready: true, problem: null });
    env.marketingEmailFrom = "";
    expect(externalContactService.marketingSenderStatus()).toMatchObject({ from: null, ready: false, problem: expect.stringContaining("MARKETING_EMAIL_FROM") });
    env.marketingEmailFrom = "no-reply@example.com";
    expect(externalContactService.marketingSenderStatus()).toMatchObject({ ready: false, problem: expect.stringContaining("same address") });
    expect(externalContactService.emailAddressOf("Divve Offers <Offers@X.com>")).toBe("offers@x.com");
    expect(externalContactService.emailAddressOf("plain@x.com")).toBe("plain@x.com");
  });
});
