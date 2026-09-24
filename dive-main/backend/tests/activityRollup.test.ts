import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { ActivityFirstTouch } from "../src/models/ActivityFirstTouch";
import { ActivityDailyRollup } from "../src/models/ActivityDailyRollup";
import { emitActivity } from "../src/services/activityLog";
import { rollUpActivityForDay } from "../src/services/activityRollupService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

/**
 * Post-Phase-7 gap sweep — fixes a real gap: raw ActivityEvent rows
 * TTL-expire after ACTIVITY_EVENT_RETENTION_DAYS (default 180), so
 * `ActivityEvent.distinct("userId", { type })` (the admin funnel's old
 * implementation) would silently shrink an "all-time" figure once events
 * age past that window. ActivityFirstTouch (permanent, one row per
 * (user, type) ever) and ActivityDailyRollup (permanent daily counts) fix
 * this — see each model's own comment for the full reasoning.
 */

const app = createApp();
let mobileCounter = 9990000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

// Mongoose builds a schema's indexes in the background after first use —
// resolving a .create() call does NOT guarantee a unique index is live yet,
// which would make the very first duplicate-insert check below flaky
// against a fresh in-memory MongoDB. Model.init() resolves once indexes are
// actually built.
beforeAll(async () => {
  await ActivityFirstTouch.init();
});

async function makeUser(email: string) {
  return User.create({ name: "Rollup Tester", mobile: nextMobile(), email, age: 30, passwordHash: "x" });
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Rollup Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.user.id as string;
}

async function loginAsSuperadmin(email: string) {
  const mobile = nextMobile();
  const userId = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = "superadmin";
  await user.save();
  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const confirm = await request(app)
    .post("/api/auth/staff/totp/confirm")
    .set(pending)
    .send({ code: _generateCurrentCodeForTests(setup.body.secret) });
  return confirm.body.accessToken as string;
}

describe("emitActivity — ActivityFirstTouch", () => {
  it("creates a first-touch row on the first occurrence of a type, and never duplicates it on later ones", async () => {
    const user = await makeUser("firsttouch1@example.com");
    await emitActivity("score_viewed", { userId: String(user._id) });
    await emitActivity("score_viewed", { userId: String(user._id) });
    await emitActivity("score_viewed", { userId: String(user._id) });

    const rows = await ActivityFirstTouch.find({ userId: user._id, type: "score_viewed" }).lean();
    expect(rows).toHaveLength(1);

    const events = await ActivityEvent.countDocuments({ userId: user._id, type: "score_viewed" });
    expect(events).toBe(3); // the raw events themselves are unaffected — one row per call, as always
  });

  it("tracks each event type independently for the same user", async () => {
    const user = await makeUser("firsttouch2@example.com");
    await emitActivity("signup", { userId: String(user._id) });
    await emitActivity("holding_added", { userId: String(user._id) });

    const types = (await ActivityFirstTouch.find({ userId: user._id }).lean()).map((r) => r.type).sort();
    expect(types).toEqual(["holding_added", "signup"]);
  });

  it("never writes a first-touch row when no userId is given (an anonymous/system event)", async () => {
    const before = await ActivityFirstTouch.countDocuments();
    await emitActivity("signup", {});
    const after = await ActivityFirstTouch.countDocuments();
    expect(after).toBe(before);
  });
});

describe("rollUpActivityForDay", () => {
  it("counts a day's raw events and its new-distinct-users, and is idempotent on re-run", async () => {
    const user1 = await makeUser("rollupday1@example.com");
    const user2 = await makeUser("rollupday2@example.com");
    const targetDay = new Date("2020-06-15T12:00:00.000Z"); // deliberately far in the past — nowhere near any real TTL boundary in this test run

    await ActivityEvent.create([
      { userId: user1._id, type: "score_viewed", ts: new Date("2020-06-15T01:00:00.000Z") },
      { userId: user1._id, type: "score_viewed", ts: new Date("2020-06-15T02:00:00.000Z") }, // same user, same day, second view
      { userId: user2._id, type: "score_viewed", ts: new Date("2020-06-15T03:00:00.000Z") },
      { userId: user1._id, type: "score_viewed", ts: new Date("2020-06-16T01:00:00.000Z") }, // the NEXT day — must not be counted
    ]);
    // The real code path (emitActivity) would have written these itself —
    // inserted directly here since the events above are backdated.
    await ActivityFirstTouch.create([
      { userId: user1._id, type: "score_viewed", firstAt: new Date("2020-06-15T01:00:00.000Z") },
      { userId: user2._id, type: "score_viewed", firstAt: new Date("2020-06-15T03:00:00.000Z") },
    ]);

    const summary = await rollUpActivityForDay(targetDay);
    expect(summary.date.toISOString()).toBe("2020-06-15T00:00:00.000Z");

    const row = await ActivityDailyRollup.findOne({ date: summary.date, type: "score_viewed" }).lean();
    expect(row?.count).toBe(3); // 3 events that day (2 from user1, 1 from user2)
    expect(row?.newDistinctUserCount).toBe(2); // 2 users had their first-ever score_viewed that day

    // Re-running for the same day replaces, not duplicates, the row.
    await rollUpActivityForDay(targetDay);
    const rowsAfterRerun = await ActivityDailyRollup.find({ date: summary.date, type: "score_viewed" }).lean();
    expect(rowsAfterRerun).toHaveLength(1);
  });

  it("writes no row for a type with zero activity that day", async () => {
    const emptyDay = new Date("2019-01-01T00:00:00.000Z");
    await rollUpActivityForDay(emptyDay);
    const rows = await ActivityDailyRollup.find({ date: new Date("2019-01-01T00:00:00.000Z") }).lean();
    expect(rows).toHaveLength(0);
  });
});

// The actual regression this whole mechanism exists for: the funnel must
// stay correct even after a user's original ActivityEvent row is long gone
// (simulating the 180-day TTL having already expired it) — confirming
// analyticsController.ts::getFunnel really does read ActivityFirstTouch
// instead of running `ActivityEvent.distinct`, which would have silently
// lost this user.
describe("GET /api/admin/analytics/funnel — survives raw ActivityEvent expiry", () => {
  it("still counts a user whose original signup ActivityEvent has been deleted", async () => {
    const auth = { Authorization: `Bearer ${await loginAsSuperadmin("funnel-survives-admin@example.com")}` };
    const user = await makeUser("funnel-survives-target@example.com");
    await emitActivity("signup", { userId: String(user._id) });

    // Simulate the raw event aging past its TTL and being reaped by Mongo —
    // ActivityFirstTouch is untouched, since it's a separate, permanent row.
    await ActivityEvent.deleteMany({ userId: user._id, type: "signup" });
    expect(await ActivityEvent.countDocuments({ userId: user._id, type: "signup" })).toBe(0);

    const res = await request(app).get("/api/admin/analytics/funnel").set(auth);
    expect(res.status).toBe(200);
    const signupStage = res.body.stages.find((s: { type: string }) => s.type === "signup");
    expect(signupStage.distinctUsers).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/admin/analytics/feature-usage — merges in ActivityDailyRollup for older windows", () => {
  it("includes rollup-only history (older than the raw retention window) when a longer days range is requested", async () => {
    const auth = { Authorization: `Bearer ${await loginAsSuperadmin("usage-rollup-admin@example.com")}` };

    // A rollup row far older than any raw ActivityEvent this test creates —
    // this is exactly the "raw data already expired, only the rollup
    // remains" scenario.
    const oldDay = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await ActivityDailyRollup.create({ date: new Date(Date.UTC(oldDay.getUTCFullYear(), oldDay.getUTCMonth(), oldDay.getUTCDate())), type: "bot_scan", count: 7, newDistinctUserCount: 4 });

    const shortWindow = await request(app).get("/api/admin/analytics/feature-usage?days=30").set(auth);
    const shortBotScan = shortWindow.body.usage.find((u: { type: string }) => u.type === "bot_scan");
    expect(shortBotScan).toBeUndefined(); // the 200-day-old rollup is outside a 30-day window

    const longWindow = await request(app).get("/api/admin/analytics/feature-usage?days=365").set(auth);
    const longBotScan = longWindow.body.usage.find((u: { type: string }) => u.type === "bot_scan");
    expect(longBotScan?.count).toBeGreaterThanOrEqual(7);
  });
});
