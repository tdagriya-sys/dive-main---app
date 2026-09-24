import { User } from "../src/models/User";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { UserNotification } from "../src/models/UserNotification";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import * as dunningService from "../src/services/dunningService";
import { env } from "../src/config/env";

// Phase 6b of docs/ADMIN_PANEL_PLAN.md §9's "6b" row — dunning/past-due flow.
// `env.razorpay.isPlaceholder` is forced true for the whole test run (tests
// /setupEnv.ts), so `runDunningSweep`'s Razorpay-cancel branch is never
// reached here — same "only mock mode is unit-tested" convention every other
// Razorpay-touching service in this codebase already follows.

let mobileCounter = 9960000000;
async function makeUser() {
  return User.create({ name: "Dunning User", mobile: String(mobileCounter++), email: `dun-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
}

async function makePastDueSubscription(userId: string, updatedAtOverride?: Date) {
  const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
  const now = new Date();
  const subscription = await Subscription.create({
    userId,
    planId: plan!._id,
    status: "past_due",
    currentPeriodStart: now,
    currentPeriodEnd: now,
    startedAt: now,
  });
  if (updatedAtOverride) {
    // Bypasses Mongoose's own timestamps middleware (which would otherwise
    // stamp updateOne's `updatedAt` back to "now", same as `save()` does) by
    // writing through the raw collection driver instead of the model.
    await Subscription.collection.updateOne({ _id: subscription._id }, { $set: { updatedAt: updatedAtOverride } });
  }
  return subscription;
}

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("sendPastDueNotice", () => {
  it("creates both an in-app and an email UserNotification for the subscriber", async () => {
    const user = await makeUser();
    const subscription = await makePastDueSubscription(String(user._id));
    await dunningService.sendPastDueNotice(subscription);

    const notifications = await UserNotification.find({ userId: user._id }).lean();
    expect(notifications.map((n) => n.channel).sort()).toEqual(["email", "in_app"]);
    expect(notifications[0].categoryKey).toBe("subscription");
    expect(notifications[0].title).toMatch(/payment/i);
  });

  it("never requests the popup channel — a past-due notice is deliberately bell+email only", async () => {
    const user = await makeUser();
    const subscription = await makePastDueSubscription(String(user._id));
    await dunningService.sendPastDueNotice(subscription);

    const popup = await UserNotification.findOne({ userId: user._id, channel: "popup" }).lean();
    expect(popup).toBeNull();
  });
});

describe("notifyUser", () => {
  it("only creates in_app + email rows when popup isn't requested", async () => {
    const user = await makeUser();
    await dunningService.notifyUser(user._id, "Title", "Body text");
    const notifications = await UserNotification.find({ userId: user._id }).lean();
    expect(notifications.map((n) => n.channel).sort()).toEqual(["email", "in_app"]);
  });

  it("also creates a popup row, with bodyHtml, when popup: true is requested — and every channel (including in_app) gets bodyHtml", async () => {
    const user = await makeUser();
    await dunningService.notifyUser(user._id, "Title", "Body **bold** text", { popup: true });

    const notifications = await UserNotification.find({ userId: user._id }).lean();
    expect(notifications.map((n) => n.channel).sort()).toEqual(["email", "in_app", "popup"]);

    const popup = notifications.find((n) => n.channel === "popup");
    expect(popup?.bodyHtml).toBe("Body <b>bold</b> text");

    const emailRow = notifications.find((n) => n.channel === "email");
    expect(emailRow?.bodyHtml).toBe("Body <b>bold</b> text");

    // Fixed this phase — the bell dropdown used to show raw **/== markers
    // for in_app rows since none of them ever got a rendered bodyHtml.
    const inAppRow = notifications.find((n) => n.channel === "in_app");
    expect(inAppRow?.bodyHtml).toBe("Body <b>bold</b> text");
  });

  it("bakes the given highlightStyle into bodyHtml for both email and popup rows", async () => {
    const user = await makeUser();
    await dunningService.notifyUser(user._id, "Title", "Only ==3 days left==!", { popup: true, highlightStyle: { color: "#FF0000" } });

    const popup = await UserNotification.findOne({ userId: user._id, channel: "popup" }).lean();
    expect(popup?.bodyHtml).toContain('<span style="color:#FF0000">3 days left</span>');
  });
});

describe("runDunningSweep", () => {
  it("leaves a freshly past_due subscription alone (still within the grace period)", async () => {
    const user = await makeUser();
    await makePastDueSubscription(String(user._id)); // updatedAt defaults to "now"
    const summary = await dunningService.runDunningSweep();
    expect(summary.cancelled).toBe(0);
    expect((await Subscription.findOne({ userId: user._id }))!.status).toBe("past_due");
  });

  it("auto-cancels a past_due subscription once the grace period has elapsed, and notifies the user", async () => {
    const user = await makeUser();
    const overdue = new Date(Date.now() - (env.dunningGraceDays + 1) * 24 * 60 * 60 * 1000);
    await makePastDueSubscription(String(user._id), overdue);

    const summary = await dunningService.runDunningSweep();
    expect(summary.cancelled).toBe(1);

    const subscription = await Subscription.findOne({ userId: user._id }).lean();
    expect(subscription!.status).toBe("cancelled");
    expect(subscription!.endedAt).toBeTruthy();

    const cancelNotice = await UserNotification.findOne({ userId: user._id, title: /cancelled/i }).lean();
    expect(cancelNotice).toBeTruthy();
  });

  it("never touches an active or trialing subscription", async () => {
    const user = await makeUser();
    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    const now = new Date();
    await Subscription.create({ userId: user._id, planId: plan!._id, status: "active", currentPeriodStart: now, currentPeriodEnd: now, startedAt: now });

    const summary = await dunningService.runDunningSweep();
    expect(summary.checked).toBe(0);
    expect((await Subscription.findOne({ userId: user._id }))!.status).toBe("active");
  });
});
