import { User } from "../src/models/User";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { ActivityFirstTouch } from "../src/models/ActivityFirstTouch";
import { backfillActivityFirstTouch } from "../src/scripts/backfillActivityFirstTouch";

// Post-Phase-7 gap sweep — the one-off backfill that prevents a real
// deploy-time regression: ActivityFirstTouch is a brand-new collection, so
// without this, the admin Analytics funnel would read near-zero for every
// pre-existing user right after this fix ships.

let mobileCounter = 9980000000;
async function makeUser(email: string) {
  return User.create({ name: "Backfill Tester", mobile: String(mobileCounter++), email, age: 30, passwordHash: "x" });
}

beforeAll(async () => {
  await ActivityFirstTouch.init();
});

describe("backfillActivityFirstTouch", () => {
  it("derives the earliest ActivityEvent per (user, type) and inserts one row each", async () => {
    const user = await makeUser("backfill1@example.com");
    await ActivityEvent.create([
      { userId: user._id, type: "score_viewed", ts: new Date("2024-03-01T00:00:00.000Z") },
      { userId: user._id, type: "score_viewed", ts: new Date("2024-03-05T00:00:00.000Z") }, // later — must not win
      { userId: user._id, type: "signup", ts: new Date("2024-02-01T00:00:00.000Z") },
    ]);

    const result = await backfillActivityFirstTouch();
    expect(result.inserted).toBeGreaterThanOrEqual(2);

    const scoreViewed = await ActivityFirstTouch.findOne({ userId: user._id, type: "score_viewed" }).lean();
    expect(scoreViewed?.firstAt.toISOString()).toBe("2024-03-01T00:00:00.000Z"); // the EARLIEST one

    const signup = await ActivityFirstTouch.findOne({ userId: user._id, type: "signup" }).lean();
    expect(signup?.firstAt.toISOString()).toBe("2024-02-01T00:00:00.000Z");
  });

  it("is idempotent — re-running never overwrites an existing row or duplicates it", async () => {
    const user = await makeUser("backfill2@example.com");
    await ActivityEvent.create({ userId: user._id, type: "login", ts: new Date("2024-01-01T00:00:00.000Z") });

    const first = await backfillActivityFirstTouch();
    expect(first.inserted).toBeGreaterThanOrEqual(1);

    // A later ActivityEvent must never overwrite the already-recorded first touch.
    await ActivityEvent.create({ userId: user._id, type: "login", ts: new Date("2020-01-01T00:00:00.000Z") });
    const second = await backfillActivityFirstTouch();
    expect(second.inserted).toBe(0); // nothing new to insert — the pair already exists

    const rows = await ActivityFirstTouch.find({ userId: user._id, type: "login" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].firstAt.toISOString()).toBe("2024-01-01T00:00:00.000Z"); // unchanged
  });

  it("skips events with no userId (anonymous/system events)", async () => {
    await ActivityEvent.create({ type: "signup", ts: new Date() });
    await expect(backfillActivityFirstTouch()).resolves.toBeDefined(); // just proving it doesn't throw on a null-userId row
  });
});
