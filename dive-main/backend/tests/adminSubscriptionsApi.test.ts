import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { SubscriptionPlan } from "../src/models/SubscriptionPlan";
import { Subscription } from "../src/models/Subscription";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md — the admin Plans + Subscriptions
// API: permission gating (plans.manage vs subscriptions.manage), plan
// CRUD + publish-to-razorpay + archive, and subscription
// cancel/change-plan/grant, all step-up gated.

const app = createApp();

let mobileCounter = 9940000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Admin Subs Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
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
  await seedDefaultSubscriptionPlansIfEmpty();
});

describe("permission gating", () => {
  it("an employee with only plans.manage can manage plans but not subscriptions", async () => {
    const role = await Role.create({ key: "plan_manager", label: "Plan Manager", permissions: ["plans.manage"] });
    const staff = await loginAsStaff(nextMobile(), "plan-manager@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/plans").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/subscriptions").set(auth)).status).toBe(403);
  });

  it("an employee with only subscriptions.manage can manage subscriptions but not plans", async () => {
    const role = await Role.create({ key: "sub_manager", label: "Subscription Manager", permissions: ["subscriptions.manage"] });
    const staff = await loginAsStaff(nextMobile(), "sub-manager@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/subscriptions").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/plans").set(auth)).status).toBe(403);
  });
});

describe("plans CRUD", () => {
  it("creates a plan, updates it, publishes it to Razorpay (mock), and archives it", async () => {
    const staff = await loginAsStaff(nextMobile(), "plans-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/plans")
      .set(auth)
      .send({
        key: "premium_lifetime",
        name: "Premium Lifetime",
        pricePaise: 999900,
        interval: "one_time",
        entitlements: { botScanWeekly: null, botScanMonthly: null, docUploadWeekly: null, docUploadMonthly: null, portfolioEditWeekly: null, portfolioEditMonthly: null, dailyRevaluation: true, earlyAccess: true, priorityWeight: 2 },
      });
    expect(create.status).toBe(201);
    const planId = create.body.plan.id;

    const update = await request(app).patch(`/api/admin/plans/${planId}`).set(auth).send({ name: "Premium Lifetime v2" });
    expect(update.body.plan.name).toBe("Premium Lifetime v2");

    const publish = await request(app).post(`/api/admin/plans/${planId}/publish-to-razorpay`).set(auth);
    expect(publish.status).toBe(401); // step-up required

    const publishWithStepUp = await request(app).post(`/api/admin/plans/${planId}/publish-to-razorpay`).set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(publishWithStepUp.status).toBe(200);
    expect(publishWithStepUp.body.plan.razorpayPlanId).toMatch(/^mock_plan_/);

    const archive = await request(app).post(`/api/admin/plans/${planId}/archive`).set(auth);
    expect(archive.status).toBe(200);
    expect(archive.body.plan.isActive).toBe(false);
  });

  // Requirement: an admin needs to edit an EXISTING plan's trial-day count
  // and marketing benefits copy (Subscriptions.jsx's PlanRow edit mode),
  // not just set them once at creation.
  it("round-trips benefits and trialDays through an update on an existing plan", async () => {
    const staff = await loginAsStaff(nextMobile(), "plans-benefits-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app)
      .post("/api/admin/plans")
      .set(auth)
      .send({
        key: "premium_lifetime_v2",
        name: "Premium Lifetime v2",
        pricePaise: 999900,
        interval: "one_time",
        trialDays: 0,
        benefits: ["Unlimited edits"],
        entitlements: { botScanWeekly: null, botScanMonthly: null, docUploadWeekly: null, docUploadMonthly: null, portfolioEditWeekly: null, portfolioEditMonthly: null, dailyRevaluation: true, earlyAccess: true, priorityWeight: 2 },
      });
    expect(create.status).toBe(201);
    expect(create.body.plan.benefits).toEqual(["Unlimited edits"]);
    const planId = create.body.plan.id;

    const update = await request(app)
      .patch(`/api/admin/plans/${planId}`)
      .set(auth)
      .send({ trialDays: 30, benefits: ["Unlimited edits", "Priority support", "Daily revaluation"] });
    expect(update.status).toBe(200);
    expect(update.body.plan.trialDays).toBe(30);
    expect(update.body.plan.benefits).toEqual(["Unlimited edits", "Priority support", "Daily revaluation"]);

    // Also reflected on the public-facing plans endpoint the Subscription
    // screen actually reads.
    const publicList = await request(app).get("/api/subscriptions/plans").set(auth);
    const publicPlan = publicList.body.plans.find((p: { key: string }) => p.key === "premium_lifetime_v2");
    // Not "public" visibility by default filter — this plan defaults to
    // public, so it should appear.
    expect(publicPlan?.benefits).toEqual(["Unlimited edits", "Priority support", "Daily revaluation"]);
  });

  it("rejects a duplicate plan key", async () => {
    const staff = await loginAsStaff(nextMobile(), "dup-plan@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/plans")
      .set({ Authorization: `Bearer ${staff.accessToken}` })
      .send({ key: "freemium", name: "Dup", pricePaise: 0, interval: "one_time", entitlements: { botScanWeekly: 1, botScanMonthly: 3, docUploadWeekly: 1, docUploadMonthly: 3, portfolioEditWeekly: 2, portfolioEditMonthly: 5, dailyRevaluation: false, earlyAccess: false, priorityWeight: 0 } });
    expect(res.status).toBe(409);
  });

  // Requirement: an existing subscriber on a plan the admin just archived
  // must keep every benefit until their own currentPeriodEnd (nothing about
  // archiving should touch access), but auto-renew must turn off — they
  // can never buy the plan again once it lapses, so letting it keep billing
  // at a price/plan that's no longer for sale makes no sense. The plan must
  // already be unavailable for a fresh subscribe (by this user, or anyone
  // else, on any plan) purely from isActive/visibility, independent of this.
  it("archiving a plan turns off auto-renew for its live subscribers without ending their access, and the plan stays unsellable to everyone", async () => {
    const staff = await loginAsStaff(nextMobile(), "archive-effect-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const subscriber = await signupNormalUser(nextMobile(), "archive-effect-subscriber@example.com");
    const subscriberAuth = { Authorization: `Bearer ${subscriber.accessToken}` };
    const otherUser = await signupNormalUser(nextMobile(), "archive-effect-other@example.com");

    const grant = await request(app).post("/api/admin/subscriptions/grant").set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({ userIdOrEmail: subscriber.userId, planKey: "premium_monthly", days: 30 });
    const originalPeriodEnd = grant.body.subscription.currentPeriodEnd;

    const plans = await request(app).get("/api/admin/plans").set(auth);
    const planId = plans.body.plans.find((p: { key: string }) => p.key === "premium_monthly").id;

    const archive = await request(app).post(`/api/admin/plans/${planId}/archive`).set(auth);
    expect(archive.status).toBe(200);
    expect(archive.body.subscribersAffected).toBe(1);

    // Access and validity untouched — same status, same currentPeriodEnd —
    // only cancelAtPeriodEnd flips.
    const entitlements = await request(app).get("/api/me/entitlements").set(subscriberAuth);
    expect(entitlements.body.isPremium).toBe(true);
    expect(entitlements.body.subscription.status).toBe("active");
    expect(entitlements.body.subscription.currentPeriodEnd).toBe(originalPeriodEnd);
    expect(entitlements.body.subscription.cancelAtPeriodEnd).toBe(true);
    // Real benefits still apply — unaffected by the archive.
    expect(entitlements.body.entitlements.portfolioEditWeekly).toBeNull();

    // Nobody can subscribe to it fresh — the existing subscriber, or a
    // completely different (Freemium) user.
    const resubscribe = await request(app).post("/api/subscriptions").set(subscriberAuth).send({ planKey: "premium_monthly" });
    expect(resubscribe.status).toBe(404);
    const freshSubscribe = await request(app).post("/api/subscriptions").set({ Authorization: `Bearer ${otherUser.accessToken}` }).send({ planKey: "premium_monthly" });
    expect(freshSubscribe.status).toBe(404);
    // Nor does it show up in the public plan list any more.
    const publicPlans = await request(app).get("/api/subscriptions/plans").set({ Authorization: `Bearer ${otherUser.accessToken}` });
    expect(publicPlans.body.plans.find((p: { key: string }) => p.key === "premium_monthly")).toBeUndefined();
  });

  // Archiving a plan nobody is actively subscribed to (real is scoped to
  // active/past_due) must be a harmless no-op, not an error.
  it("archiving a plan with no live subscribers reports 0 affected and still succeeds", async () => {
    const staff = await loginAsStaff(nextMobile(), "archive-noop-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const plans = await request(app).get("/api/admin/plans").set(auth);
    const planId = plans.body.plans.find((p: { key: string }) => p.key === "premium_annual").id;

    const archive = await request(app).post(`/api/admin/plans/${planId}/archive`).set(auth);
    expect(archive.status).toBe(200);
    expect(archive.body.subscribersAffected).toBe(0);
  });

  // Requirement: an admin can link a Monthly and Annual plan so
  // Subscription.jsx renders them as one toggle card instead of two — the
  // link must be symmetric (set/cleared on both sides together).
  describe("linking a Monthly and Annual plan", () => {
    async function getPlanIds(auth: { Authorization: string }) {
      const plans = await request(app).get("/api/admin/plans").set(auth);
      const byKey: Record<string, string> = {};
      for (const p of plans.body.plans) byKey[p.key] = p.id;
      return byKey;
    }

    it("links two plans symmetrically", async () => {
      const staff = await loginAsStaff(nextMobile(), "link-staff@example.com", "superadmin");
      const auth = { Authorization: `Bearer ${staff.accessToken}` };
      const ids = await getPlanIds(auth);

      const update = await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_annual" });
      expect(update.status).toBe(200);
      expect(update.body.plan.linkedPlanKey).toBe("premium_annual");

      const plans = await request(app).get("/api/admin/plans").set(auth);
      const annual = plans.body.plans.find((p: { key: string }) => p.key === "premium_annual");
      expect(annual.linkedPlanKey).toBe("premium_monthly");
    });

    it("refuses linking a plan to itself, to a one_time plan, or to a plan with the same interval", async () => {
      const staff = await loginAsStaff(nextMobile(), "link-invalid-staff@example.com", "superadmin");
      const auth = { Authorization: `Bearer ${staff.accessToken}` };
      const ids = await getPlanIds(auth);

      const self = await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_monthly" });
      expect(self.status).toBe(400);
      expect(self.body.error).toBe("CANNOT_LINK_SELF");

      const oneTime = await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "freemium" });
      expect(oneTime.status).toBe(400);
      expect(oneTime.body.error).toBe("INVALID_PLAN_LINK");

      // Create a second Monthly plan to prove same-interval linking is refused too.
      const created = await request(app)
        .post("/api/admin/plans")
        .set(auth)
        .send({ key: "premium_elite_monthly", name: "Elite Monthly", pricePaise: 19900, interval: "month", entitlements: { botScanWeekly: null, botScanMonthly: null, docUploadWeekly: null, docUploadMonthly: null, portfolioEditWeekly: null, portfolioEditMonthly: null, dailyRevaluation: true, earlyAccess: true, priorityWeight: 2 } });
      const sameInterval = await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: created.body.plan.key });
      expect(sameInterval.status).toBe(400);
      expect(sameInterval.body.error).toBe("INVALID_PLAN_LINK");
    });

    it("re-linking to a new partner frees the old one on both sides", async () => {
      const staff = await loginAsStaff(nextMobile(), "relink-staff@example.com", "superadmin");
      const auth = { Authorization: `Bearer ${staff.accessToken}` };
      const created = await request(app)
        .post("/api/admin/plans")
        .set(auth)
        .send({ key: "premium_elite_annual", name: "Elite Annual", pricePaise: 199900, interval: "year", entitlements: { botScanWeekly: null, botScanMonthly: null, docUploadWeekly: null, docUploadMonthly: null, portfolioEditWeekly: null, portfolioEditMonthly: null, dailyRevaluation: true, earlyAccess: true, priorityWeight: 2 } });
      const ids = await getPlanIds(auth);

      await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_annual" });
      // Re-link monthly to the new elite-annual plan instead.
      await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: created.body.plan.key });

      const plans = await request(app).get("/api/admin/plans").set(auth);
      const byKey: Record<string, { linkedPlanKey: string | null }> = {};
      for (const p of plans.body.plans) byKey[p.key] = p;
      expect(byKey.premium_monthly.linkedPlanKey).toBe("premium_elite_annual");
      expect(byKey.premium_elite_annual.linkedPlanKey).toBe("premium_monthly");
      expect(byKey.premium_annual.linkedPlanKey).toBeNull(); // freed
    });

    it("unlinks with linkedPlanKey: null, and archiving a linked plan frees its partner", async () => {
      const staff = await loginAsStaff(nextMobile(), "unlink-staff@example.com", "superadmin");
      const auth = { Authorization: `Bearer ${staff.accessToken}` };
      const ids = await getPlanIds(auth);
      await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_annual" });

      const unlink = await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: null });
      expect(unlink.body.plan.linkedPlanKey).toBeNull();
      let plans = await request(app).get("/api/admin/plans").set(auth);
      expect(plans.body.plans.find((p: { key: string }) => p.key === "premium_annual").linkedPlanKey).toBeNull();

      // Re-link, then archive the monthly side — the annual side must free up too.
      await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_annual" });
      await request(app).post(`/api/admin/plans/${ids.premium_monthly}/archive`).set(auth);
      plans = await request(app).get("/api/admin/plans").set(auth);
      expect(plans.body.plans.find((p: { key: string }) => p.key === "premium_annual").linkedPlanKey).toBeNull();
    });

    it("the public plans list also exposes linkedPlanKey", async () => {
      const staff = await loginAsStaff(nextMobile(), "link-public-staff@example.com", "superadmin");
      const auth = { Authorization: `Bearer ${staff.accessToken}` };
      const target = await signupNormalUser(nextMobile(), "link-public-target@example.com");
      const ids = await getPlanIds(auth);
      await request(app).patch(`/api/admin/plans/${ids.premium_monthly}`).set(auth).send({ linkedPlanKey: "premium_annual" });

      const publicPlans = await request(app).get("/api/subscriptions/plans").set({ Authorization: `Bearer ${target.accessToken}` });
      const monthly = publicPlans.body.plans.find((p: { key: string }) => p.key === "premium_monthly");
      expect(monthly.linkedPlanKey).toBe("premium_annual");
    });
  });
});

describe("subscriptions admin", () => {
  it("lists subscriptions, grants a comp subscription, then cancels and change-plans it (both step-up gated)", async () => {
    const staff = await loginAsStaff(nextMobile(), "subs-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const targetUser = await signupNormalUser(nextMobile(), "grant-target@example.com");

    const grantNoStepUp = await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: targetUser.userId, planKey: "premium_monthly", days: 30 });
    expect(grantNoStepUp.status).toBe(401);

    const grant = await request(app).post("/api/admin/subscriptions/grant").set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({ userIdOrEmail: targetUser.userId, planKey: "premium_monthly", days: 30 });
    expect(grant.status).toBe(201);
    const subscriptionId = grant.body.subscription.id;

    const list = await request(app).get("/api/admin/subscriptions?status=active").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.subscriptions.some((s: { id: string }) => s.id === subscriptionId)).toBe(true);

    const changePlan = await request(app).post(`/api/admin/subscriptions/${subscriptionId}/change-plan`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({ planKey: "premium_annual" });
    expect(changePlan.status).toBe(200);

    const cancel = await request(app).post(`/api/admin/subscriptions/${subscriptionId}/cancel`).set({ ...auth, "x-step-up-token": staff.stepUpToken }).send({ atPeriodEnd: false });
    expect(cancel.status).toBe(200);
    expect(cancel.body.subscription.status).toBe("cancelled");
  });

  // Requirement: an admin should be able to find a specific user's
  // subscription by name/email, and control the sort order, not just page
  // through the default newest-first list.
  it("searches subscriptions by user name/email and sorts by expiry", async () => {
    const staff = await loginAsStaff(nextMobile(), "subs-search-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const findable = await signupNormalUser(nextMobile(), "findable-searchtarget@example.com");
    await signupNormalUser(nextMobile(), "unrelated-other@example.com");

    const grant = await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: findable.userId, planKey: "premium_monthly", days: 10 });
    expect(grant.status).toBe(201);

    const byEmail = await request(app).get("/api/admin/subscriptions").query({ q: "findable-searchtarget" }).set(auth);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.subscriptions.length).toBeGreaterThan(0);
    expect(byEmail.body.subscriptions.every((s: { userEmail: string }) => s.userEmail === "findable-searchtarget@example.com")).toBe(true);

    const noMatch = await request(app).get("/api/admin/subscriptions").query({ q: "definitely-nobody-here-xyz" }).set(auth);
    expect(noMatch.body.subscriptions.length).toBe(0);

    // An exact userId filter (from the search box's autocomplete dropdown,
    // once a specific person is picked) takes priority and matches only them.
    const byExactUserId = await request(app).get("/api/admin/subscriptions").query({ userId: findable.userId }).set(auth);
    expect(byExactUserId.body.subscriptions.length).toBeGreaterThan(0);
    expect(byExactUserId.body.subscriptions.every((s: { userId: string }) => s.userId === findable.userId)).toBe(true);

    const sorted = await request(app).get("/api/admin/subscriptions").query({ sort: "expiring_soon" }).set(auth);
    expect(sorted.status).toBe(200);
    const ends = sorted.body.subscriptions.map((s: { currentPeriodEnd: string }) => new Date(s.currentPeriodEnd).getTime());
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
  });

  it("refuses to grant to a staff account", async () => {
    const staff = await loginAsStaff(nextMobile(), "grant-guard@example.com", "superadmin");
    const otherStaff = await loginAsStaff(nextMobile(), "grant-target-staff@example.com", "admin");
    const res = await request(app)
      .post("/api/admin/subscriptions/grant")
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken })
      .send({ userIdOrEmail: otherStaff.userId, planKey: "premium_monthly", days: 30 });
    expect(res.status).toBe(404);
  });

  // Requirement: the grant form should work with an email, not just the raw
  // Mongo _id — see GrantForm's new autocomplete in Subscriptions.jsx.
  it("grants by email instead of user id", async () => {
    const staff = await loginAsStaff(nextMobile(), "grant-by-email-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    await signupNormalUser(nextMobile(), "grant-by-email-target@example.com");

    const res = await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: "GRANT-BY-EMAIL-TARGET@example.com", planKey: "premium_monthly", days: 30 });
    expect(res.status).toBe(201);
  });

  it("404s on an email/id that matches no user", async () => {
    const staff = await loginAsStaff(nextMobile(), "grant-notfound-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const res = await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: "nobody-here@example.com", planKey: "premium_monthly", days: 30 });
    expect(res.status).toBe(404);
  });
});

// Requirement: a user-wise list of who has claimed a trial, with a way to
// regrant one (reset the one-time-ever guard).
describe("GET /api/admin/subscriptions/trials + POST /api/admin/users/:id/trial/reset", () => {
  it("lists a user who claimed a payment-free trial, and lets an admin regrant it", async () => {
    const staff = await loginAsStaff(nextMobile(), "trials-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const stepUpAuth = { ...auth, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "trial-claimer@example.com");
    const targetAuth = { Authorization: `Bearer ${target.accessToken}` };

    const trialStart = await request(app).post("/api/subscriptions/trial/start").set(targetAuth).send({ planKey: "premium_monthly" });
    expect(trialStart.status).toBe(201);

    const list = await request(app).get("/api/admin/subscriptions/trials").set(auth);
    expect(list.status).toBe(200);
    const row = list.body.trials.find((t: { userId: string }) => t.userId === target.userId);
    expect(row).toMatchObject({ planKey: "premium_monthly", trialDaysGranted: 15, hasUsedTrial: true });

    // Claiming a second trial is refused until an admin regrants it.
    const secondClaim = await request(app).post("/api/subscriptions/trial/start").set(targetAuth).send({ planKey: "premium_monthly" });
    expect(secondClaim.status).toBe(409);

    const resetNoStepUp = await request(app).post(`/api/admin/users/${target.userId}/trial/reset`).set(auth);
    expect(resetNoStepUp.status).toBe(401);

    const reset = await request(app).post(`/api/admin/users/${target.userId}/trial/reset`).set(stepUpAuth);
    expect(reset.status).toBe(200);
    expect(reset.body.hasUsedTrial).toBe(false);

    // Cancel the still-active trial subscription first (can't claim while
    // already subscribed), then confirm the regrant actually took effect.
    await request(app).post("/api/subscriptions/cancel").set(targetAuth).send({ atPeriodEnd: false });
    const reclaim = await request(app).post("/api/subscriptions/trial/start").set(targetAuth).send({ planKey: "premium_monthly" });
    expect(reclaim.status).toBe(201);
  });

  // Real-world gap this covers: trialDaysGranted was added after this
  // product already had trial users, and is never backfilled onto their
  // pre-existing subscriptions (see Subscription.ts's own comment) — so a
  // user whose only subscription predates the field would otherwise be
  // invisible on this list despite hasUsedTrial being true.
  it("still lists a legacy trial user whose subscription predates trialDaysGranted, and lets an admin regrant it", async () => {
    const staff = await loginAsStaff(nextMobile(), "legacy-trials-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const stepUpAuth = { ...auth, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "legacy-trial-user@example.com");

    const plan = await SubscriptionPlan.findOne({ key: "premium_monthly" }).lean();
    await Subscription.create({
      userId: target.userId,
      planId: plan!._id,
      status: "cancelled",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      startedAt: new Date(),
      endedAt: new Date(),
      // No trialDaysGranted — simulating a pre-existing row from before the field existed.
    });
    await User.findByIdAndUpdate(target.userId, { hasUsedTrial: true });

    const list = await request(app).get("/api/admin/subscriptions/trials").set(auth);
    expect(list.status).toBe(200);
    const row = list.body.trials.find((t: { userId: string }) => t.userId === target.userId);
    expect(row).toMatchObject({ planKey: "premium_monthly", trialDaysGranted: null, legacy: true, hasUsedTrial: true });

    const reset = await request(app).post(`/api/admin/users/${target.userId}/trial/reset`).set(stepUpAuth);
    expect(reset.status).toBe(200);
    expect(reset.body.hasUsedTrial).toBe(false);
  });

  it("searches trial users by name/email and filters by the legacy category", async () => {
    const staff = await loginAsStaff(nextMobile(), "trials-search-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "trials-search-findme@example.com");
    const targetAuth = { Authorization: `Bearer ${target.accessToken}` };
    await request(app).post("/api/subscriptions/trial/start").set(targetAuth).send({ planKey: "premium_monthly" });

    const found = await request(app).get("/api/admin/subscriptions/trials").query({ q: "trials-search-findme" }).set(auth);
    expect(found.status).toBe(200);
    expect(found.body.trials.length).toBe(1);
    expect(found.body.trials[0].userEmail).toBe("trials-search-findme@example.com");

    const noMatch = await request(app).get("/api/admin/subscriptions/trials").query({ q: "nobody-matches-this-xyz" }).set(auth);
    expect(noMatch.body.trials.length).toBe(0);

    // legacy=true rows shouldn't appear when filtering for a real status.
    const activeOnly = await request(app).get("/api/admin/subscriptions/trials").query({ status: "trialing" }).set(auth);
    expect(activeOnly.body.trials.every((t: { status: string }) => t.status === "trialing")).toBe(true);

    // An exact userId filter (autocomplete pick) matches only that user.
    const byExactUserId = await request(app).get("/api/admin/subscriptions/trials").query({ userId: target.userId }).set(auth);
    expect(byExactUserId.body.trials.length).toBe(1);
    expect(byExactUserId.body.trials[0].userId).toBe(target.userId);
  });

  // Requirement: subscribing directly (never claiming a trial) must still
  // show up on this tab, tagged distinctly from a real claim, so an admin
  // can tell "skipped the trial entirely" apart from "used a real one."
  it("lists a user who subscribed directly without ever claiming a trial, as 'forfeited' not 'legacy'", async () => {
    const staff = await loginAsStaff(nextMobile(), "forfeited-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "forfeited-target@example.com");
    const targetAuth = { Authorization: `Bearer ${target.accessToken}` };

    const start = await request(app).post("/api/subscriptions").set(targetAuth).send({ planKey: "premium_monthly" });
    const verify = await request(app)
      .post("/api/subscriptions/verify")
      .set(targetAuth)
      .send({ planKey: "premium_monthly", razorpay_payment_id: `mock_payment_${start.body.subscriptionId}`, razorpay_subscription_id: start.body.subscriptionId, razorpay_signature: "mock" });
    expect(verify.body.status).toBe("active"); // never a trial

    const list = await request(app).get("/api/admin/subscriptions/trials").set(auth);
    const row = list.body.trials.find((t: { userId: string }) => t.userId === target.userId);
    expect(row).toMatchObject({ trialDaysGranted: null, legacy: false, forfeited: true, hasUsedTrial: true });

    const forfeitedOnly = await request(app).get("/api/admin/subscriptions/trials").query({ status: "forfeited" }).set(auth);
    expect(forfeitedOnly.body.trials.some((t: { userId: string }) => t.userId === target.userId)).toBe(true);
    expect(forfeitedOnly.body.trials.every((t: { forfeited: boolean }) => t.forfeited)).toBe(true);

    // Regranting works the same regardless of WHY hasUsedTrial was true.
    const reset = await request(app).post(`/api/admin/users/${target.userId}/trial/reset`).set({ ...auth, "x-step-up-token": staff.stepUpToken });
    expect(reset.status).toBe(200);
    expect(reset.body.hasUsedTrial).toBe(false);

    const stillListed = await request(app).get("/api/admin/subscriptions/trials").set(auth);
    expect(stillListed.body.trials.some((t: { userId: string }) => t.userId === target.userId)).toBe(false);
  });
});

describe("GET /api/admin/subscriptions/by-user/:userId", () => {
  it("returns every past subscription for a user, most recent first", async () => {
    const staff = await loginAsStaff(nextMobile(), "history-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}`, "x-step-up-token": staff.stepUpToken };
    const target = await signupNormalUser(nextMobile(), "history-target@example.com");

    await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: target.userId, planKey: "premium_monthly", days: 10 });
    await request(app).post("/api/admin/subscriptions/grant").set(auth).send({ userIdOrEmail: target.userId, planKey: "premium_annual", days: 20 });

    const res = await request(app).get(`/api/admin/subscriptions/by-user/${target.userId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("history-target@example.com");
    expect(res.body.subscriptions.length).toBeGreaterThanOrEqual(2);
    expect(res.body.subscriptions[0].planKey).toBe("premium_annual"); // most recent first
    expect(res.body.subscriptions.map((s: { status: string }) => s.status)).toContain("cancelled"); // the superseded first grant
  });
});

// Requirement: an admin-grantable extra allowance for one metered key, on
// top of whatever the plan already grants — independent of Freemium/Premium.
describe("POST /api/admin/subscriptions/usage-grants", () => {
  it("grants a bonus by email, step-up gated, and it actually raises the effective limit", async () => {
    const staff = await loginAsStaff(nextMobile(), "usagegrant-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "usagegrant-target@example.com");
    const targetAuth = { Authorization: `Bearer ${target.accessToken}` };

    const noStepUp = await request(app).post("/api/admin/subscriptions/usage-grants").set(auth).send({ userIdOrEmail: "usagegrant-target@example.com", key: "doc_upload", bonusWeekly: 5, bonusMonthly: 10 });
    expect(noStepUp.status).toBe(401);

    const grant = await request(app)
      .post("/api/admin/subscriptions/usage-grants")
      .set({ ...auth, "x-step-up-token": staff.stepUpToken })
      .send({ userIdOrEmail: "usagegrant-target@example.com", key: "doc_upload", bonusWeekly: 5, bonusMonthly: 10 });
    expect(grant.status).toBe(200);
    expect(grant.body.grant).toEqual({ key: "doc_upload", bonusWeekly: 5, bonusMonthly: 10, bonusTotal: 0 });

    const entitlements = await request(app).get("/api/me/entitlements").set(targetAuth);
    // Freemium's docUploadWeekly is 1 -> 1 + 5 bonus = 6.
    expect(entitlements.body.entitlements.docUploadWeekly).toBe(6);
    expect(entitlements.body.entitlements.docUploadMonthly).toBe(13); // 3 + 10
  });

  // Regression: a grant to an actively-SUBSCRIBED user (not Freemium)
  // corrupted the ENTIRE entitlements object into a dump of Mongoose
  // internals ($__, $__parent, _doc, ...) instead of a clean plain object,
  // and the granted key's own value came back `null` — not even the
  // un-bonused original — which read as "Unlimited" everywhere on the
  // frontend (usageService.ts::fmtLimit treats null as unlimited). Root
  // cause: entitlementService.ts::getPlan reads a subscribed user's plan
  // off a populated, non-`.lean()` Subscription document, so
  // applyUsageGrants received a LIVE Mongoose subdocument, and
  // `{...liveSubdocument}` doesn't produce a clean plain object the way
  // `{...plainObject}` does (only the Freemium fallback path used `.lean()`,
  // which is why a Freemium grant never showed this). Every OTHER field
  // must come through completely unaffected by a grant to one specific key.
  it("grants a bonus to an actively-subscribed (Premium) user without corrupting any other field", async () => {
    const staff = await loginAsStaff(nextMobile(), "usagegrant-premium-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const target = await signupNormalUser(nextMobile(), "usagegrant-premium-target@example.com");
    const targetAuth = { Authorization: `Bearer ${target.accessToken}` };
    const subscriptionService = require("../src/services/subscriptionService");
    await subscriptionService.grantComplimentarySubscription(target.userId, "premium_monthly", 30);

    const before = await request(app).get("/api/me/entitlements").set(targetAuth);
    expect(before.body.entitlements).toEqual({
      botScanWeekly: 3, botScanMonthly: 10, docUploadWeekly: 3, docUploadMonthly: 10,
      portfolioEditWeekly: null, portfolioEditMonthly: null,
      dailyRevaluation: true, earlyAccess: true, priorityWeight: 2, complimentaryReportDownloads: 0,
    });

    await request(app)
      .post("/api/admin/subscriptions/usage-grants")
      .set({ ...auth, "x-step-up-token": staff.stepUpToken })
      .send({ userIdOrEmail: "usagegrant-premium-target@example.com", key: "bot_scan", bonusWeekly: 5, bonusMonthly: 10 });

    const after = await request(app).get("/api/me/entitlements").set(targetAuth);
    // Only bot_scan changed; every other field is byte-for-byte the plan's
    // own value — no Mongoose internals, no unrelated field wiped to null.
    expect(after.body.entitlements).toEqual({
      botScanWeekly: 8, botScanMonthly: 20, docUploadWeekly: 3, docUploadMonthly: 10,
      portfolioEditWeekly: null, portfolioEditMonthly: null,
      dailyRevaluation: true, earlyAccess: true, priorityWeight: 2, complimentaryReportDownloads: 0,
    });
  });

  // Requirement: grant a specific user extra free resilience-report
  // downloads, independent of their plan — a flat lifetime count, not a
  // weekly/monthly rolling bonus (see UsageGrant.ts's own comment on
  // bonusTotal), reusing this same admin action/endpoint.
  it("grants extra complimentary report downloads via the score_report key + bonusTotal", async () => {
    const staff = await loginAsStaff(nextMobile(), "usagegrant-report-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await signupNormalUser(nextMobile(), "usagegrant-report-target@example.com");

    const grant = await request(app)
      .post("/api/admin/subscriptions/usage-grants")
      .set({ ...auth, "x-step-up-token": staff.stepUpToken })
      .send({ userIdOrEmail: "usagegrant-report-target@example.com", key: "score_report", bonusTotal: 2 });
    expect(grant.status).toBe(200);
    expect(grant.body.grant).toEqual({ key: "score_report", bonusWeekly: 0, bonusMonthly: 0, bonusTotal: 2 });

    // Re-granting replaces rather than stacks, same as every other key.
    const regrant = await request(app)
      .post("/api/admin/subscriptions/usage-grants")
      .set({ ...auth, "x-step-up-token": staff.stepUpToken })
      .send({ userIdOrEmail: "usagegrant-report-target@example.com", key: "score_report", bonusTotal: 5 });
    expect(regrant.body.grant.bonusTotal).toBe(5);
  });
});

// Requirement: report pricing editable from admin (§13 changelog).
describe("GET/PATCH /api/admin/revenue/report-pricing", () => {
  it("defaults to the env price, and an update actually changes what a new order charges", async () => {
    const staff = await loginAsStaff(nextMobile(), "report-pricing-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const before = await request(app).get("/api/admin/revenue/report-pricing").set(auth);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ pricePaise: 9900, originalPricePaise: null });

    const update = await request(app).patch("/api/admin/revenue/report-pricing").set(auth).send({ pricePaise: 4900, originalPricePaise: 9900 });
    expect(update.status).toBe(200);
    expect(update.body).toEqual({ pricePaise: 4900, originalPricePaise: 9900 });

    const after = await request(app).get("/api/admin/revenue/report-pricing").set(auth);
    expect(after.body).toEqual({ pricePaise: 4900, originalPricePaise: 9900 });

    const target = await signupNormalUser(nextMobile(), "report-pricing-buyer@example.com");
    const order = await request(app).post("/api/payments/report/order").set("Authorization", `Bearer ${target.accessToken}`).send();
    expect(order.body.amount).toBe(4900);

    const price = await request(app).get("/api/payments/report/price").set("Authorization", `Bearer ${target.accessToken}`);
    expect(price.body).toEqual({ pricePaise: 4900, originalPricePaise: 9900 });
  });

  it("requires plans.manage to update, but only revenue.view to read", async () => {
    const role = await Role.create({ key: "revenue_viewer", label: "Revenue Viewer", permissions: ["revenue.view"] });
    const staff = await loginAsStaff(nextMobile(), "revenue-viewer@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    expect((await request(app).get("/api/admin/revenue/report-pricing").set(auth)).status).toBe(200);
    expect((await request(app).patch("/api/admin/revenue/report-pricing").set(auth).send({ pricePaise: 1000 })).status).toBe(403);
  });
});

describe("GET/PATCH /api/admin/subscriptions/renewal-reminder-settings", () => {
  const MESSAGE = { title: "Custom title", body: "Custom {{planName}} body" };
  const MESSAGES = { trialEnding: MESSAGE, renewal: MESSAGE, accessEnding: MESSAGE };

  it("defaults to [7, 3, 0] days, popup off, with a message per category, and an update actually changes what a later sweep uses", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const before = await request(app).get("/api/admin/subscriptions/renewal-reminder-settings").set(auth);
    expect(before.status).toBe(200);
    expect(before.body.daysBefore).toEqual([7, 3, 0]);
    expect(before.body.enablePopup).toBe(false);
    expect(before.body.messages.trialEnding.body).not.toMatch(/charged/i);

    const update = await request(app)
      .patch("/api/admin/subscriptions/renewal-reminder-settings")
      .set(auth)
      .send({ daysBefore: [14, 5], enablePopup: true, messages: MESSAGES });
    expect(update.status).toBe(200);
    expect(update.body).toEqual({ daysBefore: [14, 5], enablePopup: true, messages: MESSAGES });

    const after = await request(app).get("/api/admin/subscriptions/renewal-reminder-settings").set(auth);
    expect(after.body).toEqual({ daysBefore: [14, 5], enablePopup: true, messages: MESSAGES });
  });

  it("defaults enablePopup to false when omitted", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-nopopup@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const update = await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [5], messages: MESSAGES });
    expect(update.body.enablePopup).toBe(false);
  });

  it("persists a per-message highlightStyle", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-highlight@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const styledMessage = { ...MESSAGE, highlightStyle: { color: "#D4AF37", fontWeight: "bold", fontSize: "1.2em" } };
    const update = await request(app)
      .patch("/api/admin/subscriptions/renewal-reminder-settings")
      .set(auth)
      .send({ daysBefore: [5], messages: { trialEnding: styledMessage, renewal: MESSAGE, accessEnding: MESSAGE } });
    expect(update.status).toBe(200);
    expect(update.body.messages.trialEnding.highlightStyle).toEqual({ color: "#D4AF37", fontWeight: "bold", fontSize: "1.2em" });
  });

  it("rejects a highlightStyle value that could break out of the generated style attribute", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-badstyle@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const badMessage = { ...MESSAGE, highlightStyle: { color: '"onmouseover="alert(1)' } };
    const update = await request(app)
      .patch("/api/admin/subscriptions/renewal-reminder-settings")
      .set(auth)
      .send({ daysBefore: [5], messages: { trialEnding: badMessage, renewal: MESSAGE, accessEnding: MESSAGE } });
    expect(update.status).toBe(400);
  });

  it("dedupes and sorts daysBefore descending", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-dedupe@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const update = await request(app)
      .patch("/api/admin/subscriptions/renewal-reminder-settings")
      .set(auth)
      .send({ daysBefore: [3, 7, 3, 0, 7], messages: MESSAGES });
    expect(update.body.daysBefore).toEqual([7, 3, 0]);
  });

  it("rejects an out-of-range or empty daysBefore, and a missing message template", async () => {
    const staff = await loginAsStaff(nextMobile(), "renewal-reminder-invalid@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [-1], messages: MESSAGES })).status).toBe(400);
    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [31], messages: MESSAGES })).status).toBe(400);
    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [], messages: MESSAGES })).status).toBe(400);
    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [3] })).status).toBe(400);
    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: [3], messages: { trialEnding: MESSAGE, renewal: MESSAGE } })).status).toBe(400);
  });

  it("requires subscriptions.manage for both read and write", async () => {
    const role = await Role.create({ key: "no_subscriptions_access", label: "No Subscriptions Access", permissions: ["revenue.view"] });
    const staff = await loginAsStaff(nextMobile(), "no-subs-access@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    expect((await request(app).get("/api/admin/subscriptions/renewal-reminder-settings").set(auth)).status).toBe(403);
    expect((await request(app).patch("/api/admin/subscriptions/renewal-reminder-settings").set(auth).send({ daysBefore: 5 })).status).toBe(403);
  });
});
