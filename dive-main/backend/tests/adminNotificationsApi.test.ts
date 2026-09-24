import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { NotificationCategory } from "../src/models/NotificationCategory";
import { UserNotification } from "../src/models/UserNotification";
import { seedDefaultNotificationCategoriesIfEmpty } from "../src/services/notificationService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 5 of docs/ADMIN_PANEL_PLAN.md — the admin notifications API:
// permission gating (notifications.manage_templates vs notifications.send),
// category/template CRUD, and the full campaign lifecycle incl. step-up on
// schedule/send.

const app = createApp();

let mobileCounter = 9880000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Admin Notifications Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
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

beforeEach(async () => {
  await seedDefaultNotificationCategoriesIfEmpty();
});

describe("permission gating", () => {
  it("an employee with only notifications.manage_templates can manage categories/templates but not campaigns", async () => {
    const role = await Role.create({ key: "template_manager", label: "Template Manager", permissions: ["notifications.manage_templates"] });
    const staff = await loginAsStaff(nextMobile(), "template-manager@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/notification-categories").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/notification-templates").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/notification-campaigns").set(auth)).status).toBe(403);
  });

  it("an employee with only notifications.send can manage campaigns but not categories/templates", async () => {
    const role = await Role.create({ key: "sender", label: "Sender", permissions: ["notifications.send"] });
    const staff = await loginAsStaff(nextMobile(), "sender@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/notification-campaigns").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/notification-categories").set(auth)).status).toBe(403);
    expect((await request(app).post("/api/admin/notification-templates").set(auth).send({})).status).toBe(403);
  });
});

describe("notification categories CRUD", () => {
  it("creates, updates, and refuses to delete a system category", async () => {
    const staff = await loginAsStaff(nextMobile(), "categories-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/notification-categories").set(auth).send({ key: "custom", label: "Custom" });
    expect(create.status).toBe(201);

    const update = await request(app).patch(`/api/admin/notification-categories/${create.body.category.id}`).set(auth).send({ label: "Custom Updated" });
    expect(update.body.category.label).toBe("Custom Updated");

    const systemCategory = await NotificationCategory.findOne({ key: "account" }).lean();
    const del = await request(app).delete(`/api/admin/notification-categories/${systemCategory?._id}`).set(auth);
    expect(del.status).toBe(400);
  });

  it("rejects a duplicate category key", async () => {
    const staff = await loginAsStaff(nextMobile(), "dup-notif-category@example.com", "superadmin");
    const res = await request(app).post("/api/admin/notification-categories").set({ Authorization: `Bearer ${staff.accessToken}` }).send({ key: "account", label: "Account 2" });
    expect(res.status).toBe(409);
  });
});

describe("notification templates CRUD", () => {
  it("creates, updates, and refuses to delete a template still in use by a campaign", async () => {
    const staff = await loginAsStaff(nextMobile(), "templates-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({ key: "welcome", name: "Welcome", categoryKey: "product", subject: "Hi {{name}}", bodyMarkdown: "Welcome, **{{name}}**!" });
    expect(create.status).toBe(201);

    const update = await request(app).patch(`/api/admin/notification-templates/${create.body.template.id}`).set(auth).send({ name: "Welcome v2" });
    expect(update.body.template.name).toBe("Welcome v2");

    await request(app).post("/api/admin/notification-campaigns").set(auth).send({ name: "Uses template", templateKey: "welcome", categoryKey: "product", channels: ["in_app"], audience: "all" });

    const del = await request(app).delete(`/api/admin/notification-templates/${create.body.template.id}`).set(auth);
    expect(del.status).toBe(400);
  });

  it("rejects a duplicate template key", async () => {
    const staff = await loginAsStaff(nextMobile(), "dup-template@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await request(app).post("/api/admin/notification-templates").set(auth).send({ key: "dup", name: "Dup", categoryKey: "product", subject: "S", bodyMarkdown: "B" });
    const res = await request(app).post("/api/admin/notification-templates").set(auth).send({ key: "dup", name: "Dup2", categoryKey: "product", subject: "S", bodyMarkdown: "B" });
    expect(res.status).toBe(409);
  });

  it("accepts the popup channel and a highlightStyle, and round-trips both through an update", async () => {
    const staff = await loginAsStaff(nextMobile(), "template-popup@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({
        key: "popup_tpl",
        name: "Popup Template",
        categoryKey: "product",
        subject: "S",
        bodyMarkdown: "==Big news==!",
        channels: ["in_app", "popup"],
        highlightStyle: { color: "#D4AF37", fontWeight: "bold" },
      });
    expect(create.status).toBe(201);
    expect(create.body.template.channels).toEqual(["in_app", "popup"]);
    expect(create.body.template.highlightStyle).toEqual({ color: "#D4AF37", fontWeight: "bold" });

    const update = await request(app)
      .patch(`/api/admin/notification-templates/${create.body.template.id}`)
      .set(auth)
      .send({ highlightStyle: { gradientFrom: "#D4AF37", gradientTo: "#FF6B6B" } });
    expect(update.status).toBe(200);
    expect(update.body.template.highlightStyle).toEqual({ gradientFrom: "#D4AF37", gradientTo: "#FF6B6B" });
  });

  it("rejects a highlightStyle value that could break out of the generated style attribute", async () => {
    const staff = await loginAsStaff(nextMobile(), "template-badstyle@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({ key: "bad_style", name: "Bad", categoryKey: "product", subject: "S", bodyMarkdown: "B", highlightStyle: { color: '"><script>' } });
    expect(res.status).toBe(400);
  });

  it("accepts an optional callout (image + always-highlighted text with its own style) and round-trips it through an update", async () => {
    const staff = await loginAsStaff(nextMobile(), "template-callout@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({
        key: "callout_tpl",
        name: "Callout Template",
        categoryKey: "product",
        subject: "S",
        bodyMarkdown: "Regular body.",
        callout: { text: "50% off today!", imageUrl: "https://example.com/banner.gif", highlightStyle: { color: "#FF00FF" } },
      });
    expect(create.status).toBe(201);
    expect(create.body.template.callout).toEqual({ text: "50% off today!", imageUrl: "https://example.com/banner.gif", highlightStyle: { color: "#FF00FF" } });

    const update = await request(app)
      .patch(`/api/admin/notification-templates/${create.body.template.id}`)
      .set(auth)
      .send({ callout: { text: "Updated callout" } });
    expect(update.status).toBe(200);
    expect(update.body.template.callout).toEqual({ text: "Updated callout" });
  });

  it("creates a template with no callout at all — the field stays optional", async () => {
    const staff = await loginAsStaff(nextMobile(), "template-nocallout@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({ key: "no_callout_tpl", name: "No Callout", categoryKey: "product", subject: "S", bodyMarkdown: "B" });
    expect(create.status).toBe(201);
    expect(create.body.template.callout).toBeNull();
  });

  it("rejects a callout imageUrl that isn't a valid http(s) URL", async () => {
    const staff = await loginAsStaff(nextMobile(), "template-badcalloutimg@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({ key: "bad_callout_img", name: "Bad", categoryKey: "product", subject: "S", bodyMarkdown: "B", callout: { imageUrl: "javascript:alert(1)" } });
    expect(res.status).toBe(400);
  });
});

describe("notification campaigns — lifecycle", () => {
  it("requires either a templateKey or inlineContent", async () => {
    const staff = await loginAsStaff(nextMobile(), "no-content@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/notification-campaigns")
      .set({ Authorization: `Bearer ${staff.accessToken}` })
      .send({ name: "Bad", categoryKey: "product", channels: ["in_app"], audience: "all" });
    expect(res.status).toBe(400);
  });

  it("creates a campaign, previews its audience, test-sends, then schedules and sends (both step-up gated)", async () => {
    const staff = await loginAsStaff(nextMobile(), "full-lifecycle@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await signupNormalUser(nextMobile(), "campaign-target@example.com");

    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "Lifecycle", inlineContent: { subject: "Hi {{name}}", bodyMarkdown: "Hello!" }, categoryKey: "product", channels: ["in_app"], audience: "all" });
    expect(create.status).toBe(201);
    const campaignId = create.body.campaign.id;

    const preview = await request(app).get(`/api/admin/notification-campaigns/${campaignId}/preview`).set(auth);
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBeGreaterThanOrEqual(1);

    const testSend = await request(app).post(`/api/admin/notification-campaigns/${campaignId}/test-send`).set(auth).send({ email: "staff-test@example.com" });
    expect(testSend.status).toBe(200);

    const scheduleNoStepUp = await request(app)
      .post(`/api/admin/notification-campaigns/${campaignId}/schedule`)
      .set(auth)
      .send({ scheduleAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(scheduleNoStepUp.status).toBe(401);

    const sendNoStepUp = await request(app).post(`/api/admin/notification-campaigns/${campaignId}/send`).set(auth).send({});
    expect(sendNoStepUp.status).toBe(401);

    const send = await request(app).post(`/api/admin/notification-campaigns/${campaignId}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.status).toBe(200);
    expect(send.body.campaign.status).toBe("sent");

    const stats = await request(app).get(`/api/admin/notification-campaigns/${campaignId}/stats`).set(auth);
    expect(stats.status).toBe(200);
    expect(stats.body.stats.targeted).toBeGreaterThanOrEqual(1);
  });

  it("cancels a draft campaign without step-up", async () => {
    const staff = await loginAsStaff(nextMobile(), "cancel-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "Cancel me", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "product", channels: ["in_app"], audience: "all" });
    const cancel = await request(app).post(`/api/admin/notification-campaigns/${create.body.campaign.id}/cancel`).set(auth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.campaign.status).toBe("cancelled");
  });

  it("sends a popup-channel campaign, creating a popup UserNotification with highlighted bodyHtml baked in", async () => {
    const staff = await loginAsStaff(nextMobile(), "popup-campaign@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "popup-campaign-target@example.com");

    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({
        name: "Popup blast",
        inlineContent: { subject: "S", bodyMarkdown: "Only ==3 days left==!", highlightStyle: { color: "#D4AF37", fontWeight: "bold" } },
        categoryKey: "product",
        channels: ["popup"],
        audience: "all",
      });
    expect(create.status).toBe(201);

    const send = await request(app).post(`/api/admin/notification-campaigns/${create.body.campaign.id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.status).toBe(200);

    const popup = await UserNotification.findOne({ userId: target.userId, channel: "popup" }).lean();
    expect(popup).toBeTruthy();
    expect(popup?.bodyHtml).toBe('Only <span style="color:#D4AF37;font-weight:bold">3 days left</span>!');
    expect(popup?.readAt).toBeFalsy();
  });

  it("previews an ad-hoc audience without creating a campaign", async () => {
    const staff = await loginAsStaff(nextMobile(), "adhoc-preview@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/notification-audience/preview")
      .set({ Authorization: `Bearer ${staff.accessToken}` })
      .send({ audience: "all" });
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
  });

  it("persists an inline callout on a campaign and returns it in every response shape", async () => {
    const staff = await loginAsStaff(nextMobile(), "campaign-callout@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({
        name: "With callout",
        inlineContent: { subject: "S", bodyMarkdown: "Body.", callout: { text: "Hi {{name}}!", imageUrl: "https://example.com/banner.gif" } },
        categoryKey: "product",
        channels: ["in_app"],
        audience: "all",
      });
    expect(create.status).toBe(201);
    expect(create.body.campaign.inlineContent.callout).toEqual({ text: "Hi {{name}}!", imageUrl: "https://example.com/banner.gif" });

    const fetched = await request(app).get(`/api/admin/notification-campaigns/${create.body.campaign.id}`).set(auth);
    expect(fetched.body.campaign.inlineContent.callout).toEqual({ text: "Hi {{name}}!", imageUrl: "https://example.com/banner.gif" });
  });

  it("accepts the new subscription/report segment filters in a segment audience query", async () => {
    const staff = await loginAsStaff(nextMobile(), "segment-filters@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/notification-audience/preview")
      .set({ Authorization: `Bearer ${staff.accessToken}` })
      .send({ audience: "segment", segmentQuery: { subscriptionFilter: "active_subscription", reportFilter: "never_purchased_report" } });
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
  });

  it("rejects an invalid subscriptionFilter value", async () => {
    const staff = await loginAsStaff(nextMobile(), "segment-filters-bad@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/notification-audience/preview")
      .set({ Authorization: `Bearer ${staff.accessToken}` })
      .send({ audience: "segment", segmentQuery: { subscriptionFilter: "not_a_real_value" } });
    expect(res.status).toBe(400);
  });
});

describe("redirect links, the button, and editing a draft's content (admin API)", () => {
  it("persists a template's button and callout link, and can clear them again with null", async () => {
    const staff = await loginAsStaff(nextMobile(), "tpl-button@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({
        key: "btn_tpl",
        name: "Button Template",
        categoryKey: "product",
        subject: "S",
        bodyMarkdown: "B",
        callout: { text: "Big", linkUrl: "/?go=signup" },
        button: { label: "Get started", url: "/?go=signup" },
      });
    expect(create.status).toBe(201);
    expect(create.body.template.button).toEqual({ label: "Get started", url: "/?go=signup" });
    expect(create.body.template.callout.linkUrl).toBe("/?go=signup");

    const cleared = await request(app)
      .patch(`/api/admin/notification-templates/${create.body.template.id}`)
      .set(auth)
      .send({ button: null, callout: null, highlightStyle: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.template.button).toBeNull();
    expect(cleared.body.template.callout).toBeNull();
  });

  it("rejects an unsafe or malformed link URL / button on templates and campaigns", async () => {
    const staff = await loginAsStaff(nextMobile(), "bad-link@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const base = { key: "bad_link", name: "Bad", categoryKey: "product", subject: "S", bodyMarkdown: "B" };

    for (const button of [{ label: "Go", url: "javascript:alert(1)" }, { label: "Go", url: "//evil.com" }, { label: "", url: "/?go=login" }, { label: "Go", url: "/a b" }, { label: "Go" }]) {
      const res = await request(app).post("/api/admin/notification-templates").set(auth).send({ ...base, button });
      expect(res.status).toBe(400);
    }
    const badCallout = await request(app).post("/api/admin/notification-templates").set(auth).send({ ...base, callout: { text: "x", linkUrl: "javascript:alert(1)" } });
    expect(badCallout.status).toBe(400);

    const badCampaign = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "C", inlineContent: { subject: "S", bodyMarkdown: "B", button: { label: "Go", url: "javascript:alert(1)" } }, categoryKey: "product", channels: ["in_app"], audience: "all" });
    expect(badCampaign.status).toBe(400);
  });

  it("lets a draft's content, channels and name be edited via PATCH, and returns the new content in the detail response", async () => {
    const staff = await loginAsStaff(nextMobile(), "edit-draft@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "Typo campaign", inlineContent: { subject: "Sale tomrrow", bodyMarkdown: "Old body" }, categoryKey: "product", channels: ["in_app"], audience: "all" });
    const id = create.body.campaign.id;

    const patch = await request(app)
      .patch(`/api/admin/notification-campaigns/${id}`)
      .set(auth)
      .send({
        name: "Fixed campaign",
        channels: ["in_app", "popup"],
        inlineContent: { subject: "Sale tomorrow", bodyMarkdown: "New **body** [link](https://example.com)", button: { label: "Shop", url: "/?go=home" } },
      });
    expect(patch.status).toBe(200);

    const detail = await request(app).get(`/api/admin/notification-campaigns/${id}`).set(auth);
    expect(detail.body.campaign.name).toBe("Fixed campaign");
    expect(detail.body.campaign.channels).toEqual(["in_app", "popup"]);
    expect(detail.body.campaign.inlineContent.subject).toBe("Sale tomorrow");
    expect(detail.body.campaign.inlineContent.button).toEqual({ label: "Shop", url: "/?go=home" });
    expect(detail.body.campaign.preview.richHtml).toContain(">Shop</a>");
    expect(detail.body.campaign.preview.inAppHtml).toBe("New <b>body</b> link");
  });

  it("refuses to edit a campaign once it is no longer a draft", async () => {
    const staff = await loginAsStaff(nextMobile(), "edit-sent@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "To cancel", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "product", channels: ["in_app"], audience: "all" });
    await request(app).post(`/api/admin/notification-campaigns/${create.body.campaign.id}/cancel`).set(auth);
    const patch = await request(app).patch(`/api/admin/notification-campaigns/${create.body.campaign.id}`).set(auth).send({ inlineContent: { subject: "New", bodyMarkdown: "New" } });
    expect(patch.status).toBe(400);
  });

  it("returns full details for a sent campaign: send-time content snapshot, creator, template name, specific recipients (masked), and stats-ready fields", async () => {
    const staff = await loginAsStaff(nextMobile(), "detail-sent@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "detail-target@example.com");

    await request(app)
      .post("/api/admin/notification-templates")
      .set(auth)
      .send({ key: "detail_tpl", name: "Detail Template", categoryKey: "product", subject: "Tpl subject", bodyMarkdown: "Tpl body", button: { label: "Open", url: "/?go=login" } });
    const create = await request(app)
      .post("/api/admin/notification-campaigns")
      .set(auth)
      .send({ name: "Detail", templateKey: "detail_tpl", categoryKey: "product", channels: ["in_app", "popup"], audience: "user_ids", userIds: [target.userId] });
    const id = create.body.campaign.id;

    const send = await request(app).post(`/api/admin/notification-campaigns/${id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
    expect(send.status).toBe(200);

    // Editing the template afterwards must not change what the sent campaign shows.
    const tpl = await request(app).get("/api/admin/notification-templates").set(auth);
    const tplId = tpl.body.templates.find((t: { key: string }) => t.key === "detail_tpl").id;
    await request(app).patch(`/api/admin/notification-templates/${tplId}`).set(auth).send({ subject: "Changed later", bodyMarkdown: "Changed body", button: null });

    const detail = await request(app).get(`/api/admin/notification-campaigns/${id}`).set(auth);
    const c = detail.body.campaign;
    expect(c.status).toBe("sent");
    expect(c.sentAt).toBeTruthy();
    expect(c.sentContent.subject).toBe("Tpl subject");
    expect(c.sentContent.button).toEqual({ label: "Open", url: "/?go=login" });
    expect(c.templateName).toBe("Detail Template");
    expect(c.createdBy.email).toBe("detail-sent@example.com");
    expect(c.audienceUsers).toHaveLength(1);
    expect(c.audienceUsers[0].name).toBe("Admin Notifications Tester");
    expect(c.audienceUsers[0].email).toMatch(/^d\*+@example\.com$/);
    expect(c.preview.content.subject).toBe("Tpl subject");
    expect(c.preview.richHtml).toContain(">Open</a>");
    expect(c.stats.targeted).toBe(1);
  });
});

// A category names which address its campaign emails go out from
// ("system" = the no-reply address, "marketing" = the separate marketing one).
describe("category email sender (API)", () => {
  it("categories report their sender, default to no-reply, and can be switched — invalid values are refused", async () => {
    const staff = await loginAsStaff(nextMobile(), "cat-sender@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const list = await request(app).get("/api/admin/notification-categories").set(auth);
    const byKey = Object.fromEntries(list.body.categories.map((c: { key: string; emailSender: string }) => [c.key, c.emailSender]));
    expect(byKey.marketing).toBe("marketing");
    expect(byKey.product).toBe("system");

    const created = await request(app).post("/api/admin/notification-categories").set(auth).send({ key: "promo_x", label: "Promo X" });
    expect(created.body.category.emailSender).toBe("system");
    const createdMarketing = await request(app).post("/api/admin/notification-categories").set(auth).send({ key: "promo_y", label: "Promo Y", emailSender: "marketing" });
    expect(createdMarketing.body.category.emailSender).toBe("marketing");

    const patched = await request(app).patch(`/api/admin/notification-categories/${created.body.category.id}`).set(auth).send({ emailSender: "marketing" });
    expect(patched.status).toBe(200);
    expect(patched.body.category.emailSender).toBe("marketing");
    expect((await NotificationCategory.findById(created.body.category.id).lean())?.emailSender).toBe("marketing");

    const bad = await request(app).patch(`/api/admin/notification-categories/${created.body.category.id}`).set(auth).send({ emailSender: "no-reply" });
    expect(bad.status).toBe(400);
  });

  it("the campaign's sender endpoint says which address it will use — and is gated by notifications.send", async () => {
    const staff = await loginAsStaff(nextMobile(), "camp-sender@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const body = (categoryKey: string) => ({ name: "S", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey, channels: ["email"], audience: "user_ids", userIds: [staff.userId] });
    const product = await request(app).post("/api/admin/notification-campaigns").set(auth).send(body("product"));
    const marketing = await request(app).post("/api/admin/notification-campaigns").set(auth).send(body("marketing"));

    const saved = { from: env.emailFrom, marketing: env.marketingEmailFrom, placeholder: env.emailApiKeyIsPlaceholder };
    try {
      env.emailApiKeyIsPlaceholder = false;
      env.emailFrom = "Divve <no-reply@example.com>";
      env.marketingEmailFrom = "Divve Offers <offers@marketing.example.com>";
      const sys = await request(app).get(`/api/admin/notification-campaigns/${product.body.campaign.id}/sender`).set(auth);
      expect(sys.body.sender).toMatchObject({ sendsEmail: true, kind: "system", from: "Divve <no-reply@example.com>", ready: true });
      const mkt = await request(app).get(`/api/admin/notification-campaigns/${marketing.body.campaign.id}/sender`).set(auth);
      expect(mkt.body.sender).toMatchObject({ sendsEmail: true, kind: "marketing", from: "Divve Offers <offers@marketing.example.com>", ready: true });

      env.marketingEmailFrom = "";
      const missing = await request(app).get(`/api/admin/notification-campaigns/${marketing.body.campaign.id}/sender`).set(auth);
      expect(missing.body.sender).toMatchObject({ kind: "marketing", ready: false, problem: expect.stringContaining("MARKETING_EMAIL_FROM") });

      // Sending is refused the same way (nothing goes out, the campaign stays a draft)…
      const send = await request(app).post(`/api/admin/notification-campaigns/${marketing.body.campaign.id}/send`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({});
      expect(send.status).toBe(400);
      expect(send.body.error).toBe("MARKETING_SENDER_NOT_READY");
      const after = await request(app).get(`/api/admin/notification-campaigns/${marketing.body.campaign.id}`).set(auth);
      expect(after.body.campaign.status).toBe("draft");
      // …while a no-reply-category campaign is not affected by the missing marketing address.
      const sysStill = await request(app).get(`/api/admin/notification-campaigns/${product.body.campaign.id}/sender`).set(auth);
      expect(sysStill.body.sender).toMatchObject({ kind: "system", ready: true });
    } finally {
      env.emailFrom = saved.from;
      env.marketingEmailFrom = saved.marketing;
      env.emailApiKeyIsPlaceholder = saved.placeholder;
    }

    expect((await request(app).get("/api/admin/notification-campaigns/000000000000000000000000/sender").set(auth)).status).toBe(404);
    const role = await Role.create({ key: "tpl_only_sender", label: "Templates only", permissions: ["notifications.manage_templates"] });
    const tplOnly = await loginAsStaff(nextMobile(), "tpl-only-sender@example.com", "employee", String(role._id));
    const res = await request(app).get(`/api/admin/notification-campaigns/${marketing.body.campaign.id}/sender`).set({ Authorization: `Bearer ${tplOnly.accessToken}` });
    expect(res.status).toBe(403);
  });
});
