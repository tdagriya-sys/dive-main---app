import request from "supertest";
import { createApp } from "../src/app";
import { UserNotification } from "../src/models/UserNotification";
import { seedDefaultNotificationCategoriesIfEmpty } from "../src/services/notificationService";

// Phase 5 of docs/ADMIN_PANEL_PLAN.md — the logged-in user's own
// notification surface (/api/notifications), scoped to req.userId.

const app = createApp();

let mobileCounter = 9870000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Notifications API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

beforeEach(async () => {
  await seedDefaultNotificationCategoriesIfEmpty();
});

describe("GET /api/notifications", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("lists only the caller's own in_app notifications, most recent first, with an unread count", async () => {
    const owner = await signupNormalUser(nextMobile(), "notif-owner@example.com");
    const other = await signupNormalUser(nextMobile(), "notif-other@example.com");
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "First", body: "B1", channel: "in_app" });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Second", body: "B2", channel: "in_app" });
    await UserNotification.create({ userId: other.userId, categoryKey: "product", title: "NotMine", body: "B3", channel: "in_app" });
    // An email-channel row for the owner must never show up in the bell list.
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "EmailOnly", body: "B4", channel: "email", emailStatus: "sent" });

    const res = await request(app).get("/api/notifications").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual(["Second", "First"]);
    expect(res.body.unreadCount).toBe(2);
  });

  it("returns the rendered bodyHtml for a row that has one, and falls back to the plain body for a row that doesn't", async () => {
    const owner = await signupNormalUser(nextMobile(), "notif-bodyhtml@example.com");
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Rich", body: "==3 days left==", bodyHtml: '<span style="color:#D4AF37;font-weight:bold">3 days left</span>', channel: "in_app" });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Legacy", body: "plain body, no markers", channel: "in_app" });

    const res = await request(app).get("/api/notifications").set("Authorization", `Bearer ${owner.accessToken}`);
    const rich = res.body.notifications.find((n: { title: string }) => n.title === "Rich");
    const legacy = res.body.notifications.find((n: { title: string }) => n.title === "Legacy");
    expect(rich.bodyHtml).toBe('<span style="color:#D4AF37;font-weight:bold">3 days left</span>');
    expect(legacy.bodyHtml).toBe("plain body, no markers");
  });
});

describe("GET /api/notifications — button link", () => {
  it("returns link and linkLabel for a row that has a campaign button, and leaves them off otherwise", async () => {
    const owner = await signupNormalUser(nextMobile(), "notif-link@example.com");
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "WithLink", body: "B", bodyHtml: "B", link: "https://app.example.com/?go=signup", linkLabel: "Get started", channel: "in_app" });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "NoLink", body: "B", channel: "in_app" });

    const res = await request(app).get("/api/notifications").set("Authorization", `Bearer ${owner.accessToken}`);
    const withLink = res.body.notifications.find((n: { title: string }) => n.title === "WithLink");
    const noLink = res.body.notifications.find((n: { title: string }) => n.title === "NoLink");
    expect(withLink.link).toBe("https://app.example.com/?go=signup");
    expect(withLink.linkLabel).toBe("Get started");
    expect(noLink.link).toBeUndefined();
    expect(noLink.linkLabel).toBeUndefined();
  });
});

describe("GET /api/notifications/popups", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/notifications/popups");
    expect(res.status).toBe(401);
  });

  it("lists only the caller's own unread popup rows, oldest first, and never a read/in_app/email row", async () => {
    const owner = await signupNormalUser(nextMobile(), "popup-owner@example.com");
    const other = await signupNormalUser(nextMobile(), "popup-other@example.com");
    const first = await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "First", body: "B1", bodyHtml: "<b>B1</b>", channel: "popup", link: "/subscription" });
    await new Promise((r) => setTimeout(r, 2));
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Second", body: "B2", channel: "popup" });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "AlreadyRead", body: "B3", channel: "popup", readAt: new Date() });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "InApp", body: "B4", channel: "in_app" });
    await UserNotification.create({ userId: other.userId, categoryKey: "product", title: "NotMine", body: "B5", channel: "popup" });

    const res = await request(app).get("/api/notifications/popups").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.popups.map((p: { title: string }) => p.title)).toEqual(["First", "Second"]);
    expect(res.body.popups[0].id).toBe(String(first._id));
    expect(res.body.popups[0].bodyHtml).toBe("<b>B1</b>");
    expect(res.body.popups[0].link).toBe("/subscription");
  });

  it("falls back to the plain body when bodyHtml wasn't set", async () => {
    const owner = await signupNormalUser(nextMobile(), "popup-nohtml@example.com");
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Plain", body: "just text", channel: "popup" });

    const res = await request(app).get("/api/notifications/popups").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.body.popups[0].bodyHtml).toBe("just text");
  });

  it("a popup dismissed via the same /:id/read endpoint the bell uses never appears again", async () => {
    const owner = await signupNormalUser(nextMobile(), "popup-dismiss@example.com");
    const popup = await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "Dismiss me", body: "B", channel: "popup" });

    await request(app).post(`/api/notifications/${popup._id}/read`).set("Authorization", `Bearer ${owner.accessToken}`);
    const res = await request(app).get("/api/notifications/popups").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.body.popups).toEqual([]);
  });
});

describe("POST /api/notifications/:id/read and /read-all", () => {
  it("marks one notification read, scoped to the caller", async () => {
    const owner = await signupNormalUser(nextMobile(), "read-owner@example.com");
    const other = await signupNormalUser(nextMobile(), "read-other@example.com");
    const n1 = await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "A", body: "B", channel: "in_app" });

    const forbidden = await request(app).post(`/api/notifications/${n1._id}/read`).set("Authorization", `Bearer ${other.accessToken}`);
    expect(forbidden.status).toBe(200); // no-op — the query is scoped by userId, so it just matches nothing
    const stillUnread = await UserNotification.findById(n1._id).lean();
    expect(stillUnread?.readAt).toBeFalsy();

    const ok = await request(app).post(`/api/notifications/${n1._id}/read`).set("Authorization", `Bearer ${owner.accessToken}`);
    expect(ok.status).toBe(200);
    const nowRead = await UserNotification.findById(n1._id).lean();
    expect(nowRead?.readAt).toBeTruthy();
  });

  it("marks every unread notification read at once", async () => {
    const owner = await signupNormalUser(nextMobile(), "readall-owner@example.com");
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "A", body: "B", channel: "in_app" });
    await UserNotification.create({ userId: owner.userId, categoryKey: "product", title: "B", body: "B", channel: "in_app" });

    const res = await request(app).post("/api/notifications/read-all").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/notifications").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(list.body.unreadCount).toBe(0);
  });
});

describe("GET/PATCH /api/notifications/preferences", () => {
  it("returns every category with defaults applied when no override exists", async () => {
    const owner = await signupNormalUser(nextMobile(), "prefs-owner@example.com");
    const res = await request(app).get("/api/notifications/preferences").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const account = res.body.preferences.find((p: { categoryKey: string }) => p.categoryKey === "account");
    expect(account.userOptOutAllowed).toBe(false);
    expect(account.channels).toEqual(
      expect.arrayContaining([{ channel: "in_app", enabled: true }, { channel: "email", enabled: true }, { channel: "popup", enabled: false }])
    );
  });

  it("persists an opt-in for the popup channel on a category that allows it", async () => {
    const owner = await signupNormalUser(nextMobile(), "prefs-popup-optin@example.com");
    const patch = await request(app)
      .patch("/api/notifications/preferences")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ categoryKey: "marketing", channel: "popup", enabled: true });
    expect(patch.status).toBe(200);

    const res = await request(app).get("/api/notifications/preferences").set("Authorization", `Bearer ${owner.accessToken}`);
    const marketing = res.body.preferences.find((p: { categoryKey: string }) => p.categoryKey === "marketing");
    expect(marketing.channels).toEqual(expect.arrayContaining([{ channel: "popup", enabled: true }]));
  });

  it("rejects turning off a category that doesn't allow opt-out", async () => {
    const owner = await signupNormalUser(nextMobile(), "prefs-noopt@example.com");
    const res = await request(app)
      .patch("/api/notifications/preferences")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ categoryKey: "account", channel: "email", enabled: false });
    expect(res.status).toBe(400);
  });

  it("persists an opt-out for a category that allows it", async () => {
    const owner = await signupNormalUser(nextMobile(), "prefs-opt@example.com");
    const patch = await request(app)
      .patch("/api/notifications/preferences")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ categoryKey: "marketing", channel: "email", enabled: false });
    expect(patch.status).toBe(200);

    const res = await request(app).get("/api/notifications/preferences").set("Authorization", `Bearer ${owner.accessToken}`);
    const marketing = res.body.preferences.find((p: { categoryKey: string }) => p.categoryKey === "marketing");
    expect(marketing.channels).toEqual(expect.arrayContaining([{ channel: "email", enabled: false }]));
  });
});
