import request from "supertest";
import { createApp } from "../src/app";
import { ActivityEvent } from "../src/models/ActivityEvent";

// Phase 1.1 of docs/ADMIN_PANEL_PLAN.md — wires services/activityLog.ts's
// emitActivity() (built but never called from a real controller in Phase 0.1)
// into the actual user-facing flows the admin analytics dashboards will read.
// emitActivity is deliberately fire-and-forget (never awaited by the
// controller — see its own comment), so these tests poll briefly for the row
// to land instead of assuming it's already there the instant the response
// comes back.

jest.mock("../src/services/priceHistoryService", () => ({
  ...jest.requireActual("../src/services/priceHistoryService"),
  resolveHoldingLatestPrice: jest.fn().mockResolvedValue(null),
}));

const app = createApp();

async function waitForActivity(type: string, userId: string, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ev = await ActivityEvent.findOne({ type, userId }).lean();
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

async function signupAndLogin(suffix: string) {
  const signup = {
    name: "Activity Tester",
    mobile: `91234500${suffix}`,
    email: `activity-${suffix}@example.com`,
    age: 30,
    password: "Passw0rd!",
    confirmPassword: "Passw0rd!",
  };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile: signup.mobile, otp: start.body.devOtp });
  return { accessToken: verify.body.accessToken as string, userId: verify.body.user.id as string, ...signup };
}

describe("activity instrumentation — real controllers actually emit", () => {
  it("signup emits a 'signup' event for the new user", async () => {
    const { userId } = await signupAndLogin("01");
    const ev = await waitForActivity("signup", userId);
    expect(ev).toBeTruthy();
  });

  it("login emits a 'login' event", async () => {
    const { email, userId } = await signupAndLogin("02");
    await request(app).post("/api/auth/login").send({ identifier: email, password: "Passw0rd!" });
    const ev = await waitForActivity("login", userId);
    expect(ev).toBeTruthy();
  });

  it("logout emits a 'logout' event", async () => {
    // logout() reads the refresh token from the httpOnly COOKIE, not the
    // Authorization header — a bare request(app) call per assertion (like
    // every other test in this file) never carries the Set-Cookie from an
    // earlier, separate call. A persistent agent is what actually keeps that
    // cookie across requests, same as a real browser tab would.
    const agent = request.agent(app);
    const signup = {
      name: "Activity Tester",
      mobile: "9123450099",
      email: "activity-logout@example.com",
      age: 30,
      password: "Passw0rd!",
      confirmPassword: "Passw0rd!",
    };
    const start = await agent.post("/api/auth/signup/start").send(signup);
    const verify = await agent.post("/api/auth/signup/verify").send({ mobile: signup.mobile, otp: start.body.devOtp });
    const userId = verify.body.user.id as string;

    await agent.post("/api/auth/logout");
    const ev = await waitForActivity("logout", userId);
    expect(ev).toBeTruthy();
  });

  it("creating a holding emits a 'holding_added' event with its asset class", async () => {
    const { accessToken, userId } = await signupAndLogin("04");
    await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ assetClass: "GOLD", name: "Digital Gold", investedValue: 10000, currentValue: 10000 });
    const ev = await waitForActivity("holding_added", userId);
    expect(ev).toBeTruthy();
    expect((ev as { props?: { assetClass?: string } }).props?.assetClass).toBe("GOLD");
  });

  it("deleting a holding emits a 'holding_deleted' event", async () => {
    const { accessToken, userId } = await signupAndLogin("05");
    const created = await request(app)
      .post("/api/holdings/manual")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ assetClass: "GOLD", name: "Digital Gold", investedValue: 10000, currentValue: 10000 });
    await request(app).delete(`/api/holdings/${created.body.holding._id}`).set("Authorization", `Bearer ${accessToken}`);
    const ev = await waitForActivity("holding_deleted", userId);
    expect(ev).toBeTruthy();
  });

  it("viewing the score breakdown emits a 'score_viewed' event", async () => {
    const { accessToken, userId } = await signupAndLogin("06");
    await request(app).get("/api/score/breakdown").set("Authorization", `Bearer ${accessToken}`);
    const ev = await waitForActivity("score_viewed", userId);
    expect(ev).toBeTruthy();
  });
});
