import axios from "axios";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { ExternalContact } from "../src/models/ExternalContact";
import { NotificationCampaign } from "../src/models/NotificationCampaign";
import { _generateCurrentCodeForTests } from "../src/services/totpService";
import { signUnsubscribeToken } from "../src/services/unsubscribeService";

// The admin API for imported (non-user) email lists, campaigns that go to
// them, and the PUBLIC unsubscribe page.

// Resend is mocked: the batch endpoint succeeds; the single-send endpoint
// (only the signup OTP email uses it here) fails, which makes signup fall back
// to returning `devOtp` — same as in every other API test file.
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const app = createApp();
const realEnv = { placeholder: env.emailApiKeyIsPlaceholder, marketingFrom: env.marketingEmailFrom, from: env.emailFrom, replyTo: env.marketingEmailReplyTo };
beforeAll(() => {
  env.emailApiKeyIsPlaceholder = false;
});
afterAll(() => {
  env.emailApiKeyIsPlaceholder = realEnv.placeholder;
  env.marketingEmailFrom = realEnv.marketingFrom;
  env.emailFrom = realEnv.from;
  env.marketingEmailReplyTo = realEnv.replyTo;
});
beforeEach(() => {
  env.emailFrom = "Divve <no-reply@example.com>";
  env.marketingEmailFrom = "Divve Offers <offers@marketing.example.com>";
  env.marketingEmailReplyTo = ""; // a known value — never whatever the developer has in their real .env
  mockedAxios.isAxiosError.mockImplementation(((e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError)) as unknown as typeof axios.isAxiosError);
  mockedAxios.post.mockReset();
  mockedAxios.post.mockImplementation((async (url: string, body: unknown) => {
    if (url.endsWith("/emails/batch")) return { data: { data: (body as unknown[]).map((_, i) => ({ id: `b${i}` })) } };
    throw Object.assign(new Error("single sends aren't mocked to succeed"), { isAxiosError: true, response: { status: 422 } });
  }) as unknown as typeof axios.post);
});

let mobileCounter = 9820000000;
const nextMobile = () => String(mobileCounter++);

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "External List Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

async function loginAsStaff(mobile: string, email: string, staffRole: "superadmin" | "admin" | "employee", roleId?: string) {
  const { userId } = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  if (roleId) user.roleId = roleId as unknown as typeof user.roleId;
  await user.save();

  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  const accessToken = confirm.body.accessToken as string;
  const stepUp = await request(app).post("/api/auth/staff/step-up").set("Authorization", `Bearer ${accessToken}`).send({ password: "Passw0rd!" });
  return { userId, accessToken, stepUpToken: stepUp.body.stepUpToken as string };
}

const CSV = "email,name\nada@example.com,Ada Lovelace\nalan@example.com,Alan Turing\nnot-an-email,Bob\n";
const importBody = (over: Record<string, unknown> = {}) => ({ listName: "Launch", source: "Webinar signups, Aug 2026", consentConfirmed: true, text: CSV, ...over });

describe("/api/admin/external-lists", () => {
  it("requires notifications.send — an unauthenticated caller and a templates-only employee are refused", async () => {
    expect((await request(app).get("/api/admin/external-lists")).status).toBe(401);
    const role = await Role.create({ key: "el_templates_only", label: "Templates only", permissions: ["notifications.manage_templates"] });
    const staff = await loginAsStaff(nextMobile(), "el-perm@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/external-lists").set(auth)).status).toBe(403);
    expect((await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody())).status).toBe(403);
  });

  it("reports whether a marketing sender is set up (and which), so staff can see before sending", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-sender@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const ready = await request(app).get("/api/admin/external-lists").set(auth);
    expect(ready.body.marketingSender).toEqual({ from: "Divve Offers <offers@marketing.example.com>", replyTo: null, ready: true, problem: null });

    env.marketingEmailFrom = "";
    const missing = await request(app).get("/api/admin/external-lists").set(auth);
    expect(missing.body.marketingSender).toMatchObject({ from: null, ready: false });
    expect(missing.body.marketingSender.problem).toContain("MARKETING_EMAIL_FROM");
  });

  it("imports a CSV, reporting what was added and which rows were invalid", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-import@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody());
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ total: 2, added: 2, updated: 0, unsubscribedKept: 0, alreadyRegistered: 0 });
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.invalid[0]).toMatchObject({ line: 4, value: "not-an-email" });

    const contact = await ExternalContact.findOne({ email: "ada@example.com" }).lean();
    expect(contact).toMatchObject({ name: "Ada Lovelace", lists: ["Launch"], source: "Webinar signups, Aug 2026" });
    expect(String(contact!.consentAttestedBy)).toBe(staff.userId);
  });

  it("insists on the consent confirmation, a source, a list name, and some addresses", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-validate@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const post = (over: Record<string, unknown>) => request(app).post("/api/admin/external-lists/import").set(auth).send(importBody(over));

    const noConsent = await post({ consentConfirmed: false });
    expect(noConsent.status).toBe(400);
    expect((await post({ consentConfirmed: undefined })).status).toBe(400);
    expect((await post({ source: "  " })).status).toBe(400);
    expect((await post({ listName: "" })).status).toBe(400);
    expect((await post({ text: "" })).status).toBe(400);
    expect(await ExternalContact.countDocuments({})).toBe(0);
  });

  it("rejects an import where nothing valid was found, saying how many rows were bad", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-allbad@example.com", "superadmin");
    const res = await request(app).post("/api/admin/external-lists/import").set({ Authorization: `Bearer ${staff.accessToken}` }).send(importBody({ text: "email\nnope\nalso-nope" }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 row\(s\) were invalid/);
  });

  it("re-importing an unsubscribed address keeps it unsubscribed", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-resub@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody());
    await ExternalContact.updateOne({ email: "ada@example.com" }, { unsubscribed: true });
    const again = await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody({ listName: "Second" }));
    expect(again.body.result.unsubscribedKept).toBe(1);
    expect((await ExternalContact.findOne({ email: "ada@example.com" }).lean())!.unsubscribed).toBe(true);
  });

  it("lists the lists, pages a list's contacts (masked), and deletes a list", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-lists@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody());

    const lists = await request(app).get("/api/admin/external-lists").set(auth);
    expect(lists.body.lists).toEqual([{ name: "Launch", total: 2, subscribed: 2, unsubscribed: 0 }]);
    expect(lists.body.suppressedTotal).toBe(0);

    const contacts = await request(app).get("/api/admin/external-lists/contacts").query({ list: "Launch" }).set(auth);
    expect(contacts.body.total).toBe(2);
    expect(contacts.body.contacts.map((c: { email: string }) => c.email)).toEqual(["a**@example.com", "a***@example.com"]);
    expect((await request(app).get("/api/admin/external-lists/contacts").set(auth)).status).toBe(400);

    const del = await request(app).delete("/api/admin/external-lists").query({ name: "Launch" }).set(auth);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: 2, detached: 0 });
    expect((await request(app).delete("/api/admin/external-lists").set(auth)).status).toBe(400);
  });

  it("refuses to delete a list that an unsent campaign still uses", async () => {
    const staff = await loginAsStaff(nextMobile(), "el-inuse@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody());
    await request(app).post("/api/admin/notification-campaigns").set(auth).send({ name: "Uses list", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["email"], audience: "external", externalListKey: "Launch" });
    const del = await request(app).delete("/api/admin/external-lists").query({ name: "Launch" }).set(auth);
    expect(del.status).toBe(400);
    expect(del.body.message).toMatch(/still use this list/);
  });
});

describe("campaigns that go to an email list (admin API)", () => {
  const campaignBody = (over: Record<string, unknown> = {}) => ({
    name: "Onboarding push",
    inlineContent: { subject: "Hi {{first_name}}", bodyMarkdown: "Welcome {{name}}!" },
    categoryKey: "marketing",
    channels: ["email"],
    audience: "external",
    externalListKey: "Launch",
    ...over,
  });

  it("validates: a list is required and email must be the only channel", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-validate@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const post = (over: Record<string, unknown>) => request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody(over));

    expect((await post({ externalListKey: undefined })).status).toBe(400);
    expect((await post({ channels: ["in_app"] })).status).toBe(400);
    expect((await post({ channels: ["email", "popup"] })).status).toBe(400);
    const ok = await post({});
    expect(ok.status).toBe(201);
    expect(ok.body.campaign).toMatchObject({ audience: "external", externalListKey: "Launch", channels: ["email"] });
  });

  it("lets a draft be switched to an email list (email-only) and back, via PATCH", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-patch@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody({ audience: "all", channels: ["in_app"], externalListKey: undefined }));
    const id = create.body.campaign.id;

    const bad = await request(app).patch(`/api/admin/notification-campaigns/${id}`).set(auth).send({ audience: "external", externalListKey: "Launch" });
    expect(bad.status).toBe(400);
    const to = await request(app).patch(`/api/admin/notification-campaigns/${id}`).set(auth).send({ audience: "external", externalListKey: "Launch", channels: ["email"] });
    expect(to.status).toBe(200);
    expect(to.body.campaign).toMatchObject({ audience: "external", externalListKey: "Launch", channels: ["email"] });
    const back = await request(app).patch(`/api/admin/notification-campaigns/${id}`).set(auth).send({ audience: "all", externalListKey: null });
    expect(back.status).toBe(200);
    expect(back.body.campaign.externalListKey).toBeUndefined();
  });

  it("previews the list audience (count, masked sample, what's skipped) — and NEVER as 'all users'", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-preview@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await signupNormalUser(nextMobile(), "already-a-member@example.com");
    await request(app)
      .post("/api/admin/external-lists/import")
      .set(auth)
      .send(importBody({ text: "email,name\nada@example.com,Ada\nalready-a-member@example.com,Member\noptout@example.com,Opt Out" }));
    await ExternalContact.updateOne({ email: "optout@example.com" }, { unsubscribed: true });

    const create = await request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody());
    const preview = await request(app).get(`/api/admin/notification-campaigns/${create.body.campaign.id}/preview`).set(auth);
    expect(preview.status).toBe(200);
    // Real users exist (signups above), yet the count is the list's deliverable contacts only.
    expect(preview.body).toMatchObject({ count: 1, skippedRegistered: 1, skippedUnsubscribed: 1 });
    expect(preview.body.sample).toEqual([{ name: "Ada", email: "a**@example.com" }]);
  });

  it("sends to the list (step-up required), and the detail then shows the list, delivery stats, and skipped counts", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-send@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await signupNormalUser(nextMobile(), "member-on-list@example.com");
    await request(app)
      .post("/api/admin/external-lists/import")
      .set(auth)
      .send(importBody({ text: "email,name\nada@example.com,Ada Lovelace\nalan@example.com,\nmember-on-list@example.com,Member" }));
    const create = await request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody());
    const id = create.body.campaign.id;

    expect((await request(app).post(`/api/admin/notification-campaigns/${id}/send`).set(auth).send({})).status).toBe(401);
    const send = await request(app).post(`/api/admin/notification-campaigns/${id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.status).toBe(200);
    expect(send.body.campaign.status).toBe("sent");
    expect(send.body.campaign.stats).toMatchObject({ targeted: 2, sent: 2, failed: 0, skippedRegistered: 1, skippedUnsubscribed: 0 });

    const emails = (mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails/batch")).flatMap((c) => c[1]) as { to: string[]; subject: string }[]);
    expect(emails.map((e) => [e.to[0], e.subject])).toEqual([["ada@example.com", "Hi Ada"], ["alan@example.com", "Hi there"]]);

    const detail = await request(app).get(`/api/admin/notification-campaigns/${id}`).set(auth);
    expect(detail.body.campaign.externalList).toEqual({ name: "Launch", total: 3, subscribed: 3, unsubscribed: 0 });
    const stats = await request(app).get(`/api/admin/notification-campaigns/${id}/stats`).set(auth);
    expect(stats.body.stats).toEqual({ targeted: 2, sent: 2, failed: 0, delivered: 2, opened: 0 });
  });

  it("sending to an email list is refused with a clear message when there's no marketing sender — and the campaign stays a draft", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-nosender@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody());
    const create = await request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody());
    const id = create.body.campaign.id;

    env.marketingEmailFrom = "";
    mockedAxios.post.mockClear();
    const send = await request(app).post(`/api/admin/notification-campaigns/${id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.status).toBe(400);
    expect(send.body.message).toMatch(/MARKETING_EMAIL_FROM/);
    expect(mockedAxios.post.mock.calls.filter((c) => String(c[0]).includes("resend.com"))).toHaveLength(0);
    expect((await request(app).get(`/api/admin/notification-campaigns/${id}`).set(auth)).body.campaign.status).toBe("draft");

    // once a sender is configured, the same campaign sends — as the marketing address
    env.marketingEmailFrom = "Divve Offers <offers@marketing.example.com>";
    const retry = await request(app).post(`/api/admin/notification-campaigns/${id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(retry.status).toBe(200);
    const sent = mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails/batch")).flatMap((c) => c[1] as { from: string }[]);
    expect(sent.length).toBeGreaterThan(0);
    for (const email of sent) expect(email.from).toBe("Divve Offers <offers@marketing.example.com>");
  });

  it("an existing 'all users' campaign is unaffected", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-all@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app).post("/api/admin/notification-campaigns").set(auth).send(campaignBody({ audience: "all", channels: ["in_app"], externalListKey: undefined }));
    expect(create.status).toBe(201);
    const preview = await request(app).get(`/api/admin/notification-campaigns/${create.body.campaign.id}/preview`).set(auth);
    expect(preview.status).toBe(200);
    expect(preview.body.skippedRegistered).toBeUndefined();
  });
});

describe("public unsubscribe page — /api/unsubscribe/:token", () => {
  async function contact(email = "ada@example.com") {
    const now = new Date();
    return ExternalContact.create({ email, lists: ["Launch"], source: "s", unsubscribed: false, consentAttestedBy: "64b000000000000000000000", consentAttestedAt: now, lastImportedAt: now });
  }

  it("GET only SHOWS a confirmation (masked address, a form) — a link-scanner fetching it must not unsubscribe anyone", async () => {
    const c = await contact();
    const res = await request(app).get(`/api/unsubscribe/${signUnsubscribeToken(String(c._id))}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("a**@example.com");
    expect(res.text).not.toContain("ada@example.com");
    expect(res.text).toContain('<form method="post">');
    expect(res.text).toContain("noindex");
    expect((await ExternalContact.findById(c._id).lean())!.unsubscribed).toBe(false);
  });

  it("POST unsubscribes, and is idempotent", async () => {
    const c = await contact();
    const url = `/api/unsubscribe/${signUnsubscribeToken(String(c._id))}`;
    const first = await request(app).post(url);
    expect(first.status).toBe(200);
    expect(first.text).toContain("You're unsubscribed");
    const doc = await ExternalContact.findById(c._id).lean();
    expect(doc!.unsubscribed).toBe(true);
    expect(doc!.unsubscribedAt).toBeInstanceOf(Date);
    const stamp = doc!.unsubscribedAt!.getTime();

    const second = await request(app).post(url);
    expect(second.status).toBe(200);
    expect((await ExternalContact.findById(c._id).lean())!.unsubscribedAt!.getTime()).toBe(stamp);
    // and a later visit to the link just says so
    expect((await request(app).get(url)).text).toContain("You're unsubscribed");
  });

  it("supports the mail clients' one-click POST (RFC 8058: form body List-Unsubscribe=One-Click, no cookies, no confirmation)", async () => {
    const c = await contact();
    const res = await request(app).post(`/api/unsubscribe/${signUnsubscribeToken(String(c._id))}`).type("form").send({ "List-Unsubscribe": "One-Click" });
    expect(res.status).toBe(200);
    expect((await ExternalContact.findById(c._id).lean())!.unsubscribed).toBe(true);
  });

  it("rejects a forged, tampered, or malformed token and changes nothing", async () => {
    const c = await contact();
    const id = String(c._id);
    const goodMac = signUnsubscribeToken(id).split(".")[1];
    for (const bad of ["garbage", `${id}.forged`, `${id}.${goodMac}x`, `${id}`, `${id}.${goodMac}.extra`, `not-an-id.${goodMac}`, `${"0".repeat(24)}.${goodMac}`]) {
      const get = await request(app).get(`/api/unsubscribe/${bad}`);
      const post = await request(app).post(`/api/unsubscribe/${bad}`);
      expect([get.status, post.status]).toEqual([400, 400]);
      expect(post.text).toContain("This link isn't valid");
    }
    expect((await ExternalContact.findById(c._id).lean())!.unsubscribed).toBe(false);
  });

  it("a token for a contact that no longer exists just says they're unsubscribed (nothing left to mail)", async () => {
    const c = await contact();
    const token = signUnsubscribeToken(String(c._id));
    await ExternalContact.deleteOne({ _id: c._id });
    const res = await request(app).post(`/api/unsubscribe/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("You're unsubscribed");
  });

  it("after someone unsubscribes, the next campaign to that list skips them", async () => {
    const staff = await loginAsStaff(nextMobile(), "ec-optout@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/external-lists/import").set(auth).send(importBody({ text: "email,name\nstays@example.com,Stays\nleaves@example.com,Leaves" }));
    const leaves = await ExternalContact.findOne({ email: "leaves@example.com" });
    await request(app).post(`/api/unsubscribe/${signUnsubscribeToken(String(leaves!._id))}`);

    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "After opt-out", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["email"], audience: "external", externalListKey: "Launch" });
    const send = await request(app).post(`/api/admin/notification-campaigns/${create.body.campaign.id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.body.campaign.stats).toMatchObject({ targeted: 1, sent: 1, skippedUnsubscribed: 1 });
    const sentTo = mockedAxios.post.mock.calls.filter((c) => String(c[0]).endsWith("/emails/batch")).flatMap((c) => c[1] as { to: string[] }[]).map((e) => e.to[0]);
    expect(sentTo).toEqual(["stays@example.com"]);
    expect(await NotificationCampaign.countDocuments({ status: "sent" })).toBeGreaterThanOrEqual(1);
  });
});
