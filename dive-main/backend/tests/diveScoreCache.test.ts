import request from "supertest";
import { createApp } from "../src/app";
import { Holding } from "../src/models/Holding";

const app = createApp();

async function signupAndLogin(email: string, mobile: string, age = 30) {
  const signup = {
    name: "Cache Tester",
    mobile,
    email,
    age,
    password: "Passw0rd!",
    confirmPassword: "Passw0rd!",
  };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

// P2 #21 — computeDiveScoreBreakdown's pure-CPU work (correlation matrix,
// drawdown/VaR, O(n²) look-through) used to redo itself from scratch on
// every single /score/breakdown call. These tests prove actual caching is
// happening — not just that the computation is deterministic (already
// covered by diveScore.test.ts) — by spying on Holding.find, the first real
// DB read inside the computation, and asserting it's skipped entirely on a
// cache hit, then confirming every mutation path that should invalidate the
// cache actually does.
describe("Dive Score breakdown — caching", () => {
  it("does not recompute (skips the underlying Holding.find) on a second call with nothing changed", async () => {
    const token = await signupAndLogin("cache1@example.com", "9300000001");
    await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${token}`)
      .send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 11000 });

    const findSpy = jest.spyOn(Holding, "find");

    const first = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(findSpy).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(200);
    // Still 1 — the second call was served from cache, not a fresh Holding.find.
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(second.body.compositeScore).toBe(first.body.compositeScore);

    findSpy.mockRestore();
  });

  it("invalidates the cache when a holding is created, updated, or deleted", async () => {
    const token = await signupAndLogin("cache2@example.com", "9300000002");
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(app)
      .post("/api/holdings/manual")
      .set(auth)
      .send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 11000 });
    const holdingId = created.body.holding._id;

    const afterFirst = await request(app).get("/api/score/breakdown").set(auth);
    const singleClassApparent = afterFirst.body.apparentDiversificationPct;

    // Create: a second, different-class holding must change apparent
    // diversification — if the cache weren't invalidated, this would still
    // show the single-class figure from before.
    await request(app)
      .post("/api/holdings/manual")
      .set(auth)
      .send({ assetClass: "GOLD", name: "Digital Gold", investedValue: 10000, currentValue: 10000 });
    const afterCreate = await request(app).get("/api/score/breakdown").set(auth);
    expect(afterCreate.body.apparentDiversificationPct).toBeGreaterThan(singleClassApparent);

    // Update: changing a holding's value must be reflected immediately too.
    const findSpy = jest.spyOn(Holding, "find");
    await request(app).patch(`/api/holdings/${holdingId}`).set(auth).send({ currentValue: 999999 });
    const afterUpdate = await request(app).get("/api/score/breakdown").set(auth);
    expect(findSpy).toHaveBeenCalledTimes(1); // proves this call actually recomputed, not served stale
    expect(afterUpdate.body.compositeScore).not.toBe(afterCreate.body.compositeScore);
    findSpy.mockRestore();

    // Delete: back to a single class, apparent diversification must drop again.
    await request(app).delete(`/api/holdings/${holdingId}`).set(auth);
    const afterDelete = await request(app).get("/api/score/breakdown").set(auth);
    expect(afterDelete.body.apparentDiversificationPct).toBeLessThan(afterUpdate.body.apparentDiversificationPct);
  });

  it("invalidates the cache when the user's age changes (persona/context depends on it)", async () => {
    const token = await signupAndLogin("cache3@example.com", "9300000003", 25);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app)
      .post("/api/holdings/manual")
      .set(auth)
      .send({ assetClass: "EQUITY", name: "Reliance Industries", investedValue: 10000, currentValue: 11000 });

    const before = await request(app).get("/api/score/breakdown").set(auth);
    const beforePersonaId = before.body.context.persona.id;

    await request(app).patch("/api/users/me/profile").set(auth).send({ age: 60 });

    const after = await request(app).get("/api/score/breakdown").set(auth);
    expect(after.body.context.persona.id).not.toBe(beforePersonaId);
  });
});
