import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

async function signupAndLogin(mobile: string, email: string) {
  const signup = { name: "Account Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

describe("holding deletion", () => {
  it("deletes a specific holding by id", async () => {
    const token = await signupAndLogin("9200000001", "delholding@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    const create = await request(app).post("/api/holdings/manual").set(auth).send({
      assetClass: "EQUITY", name: "Infosys", investedValue: 10000, currentValue: 11000,
    });
    const holdingId = create.body.holding._id;

    const del = await request(app).delete(`/api/holdings/${holdingId}`).set(auth);
    expect(del.status).toBe(200);

    const list = await request(app).get("/api/holdings").set(auth);
    expect(list.body.holdings).toHaveLength(0);
  });

  it("won't delete another user's holding", async () => {
    const tokenA = await signupAndLogin("9200000002", "ownerA@example.com");
    const tokenB = await signupAndLogin("9200000003", "ownerB@example.com");
    const create = await request(app).post("/api/holdings/manual").set({ Authorization: `Bearer ${tokenA}` }).send({
      assetClass: "EQUITY", name: "TCS", investedValue: 5000, currentValue: 5200,
    });
    const holdingId = create.body.holding._id;

    const del = await request(app).delete(`/api/holdings/${holdingId}`).set({ Authorization: `Bearer ${tokenB}` });
    expect(del.status).toBe(404);
  });
});

// Bug report: Divve Planner's inputs (lumpsum amount, SIP fields) were only
// ever kept in frontend memory, never saved — so a returning user always saw
// the defaults again instead of their last-entered values.
describe("planner state persistence", () => {
  it("defaults to the same values DiveContext.js's DEFAULT_PLANNER_STATE uses, for a brand-new account", async () => {
    const token = await signupAndLogin("9200000005", "plannerdefaults@example.com");
    const me = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${token}` });

    expect(me.body.user.plannerState).toEqual({
      mode: null, lumpsumAmount: 50000, sipMonthly: 5000, sipStepUp: 10, sipYears: 10, sipExpandedMonthly: false,
    });
  });

  it("saves a partial patch and returns it on the next login", async () => {
    const token = await signupAndLogin("9200000006", "plannersave@example.com");
    const auth = { Authorization: `Bearer ${token}` };

    const save = await request(app).patch("/api/users/me/planner").set(auth).send({ mode: "lumpsum", lumpsumAmount: 250000 });
    expect(save.status).toBe(200);
    expect(save.body.plannerState.lumpsumAmount).toBe(250000);
    expect(save.body.plannerState.mode).toBe("lumpsum");
    // A partial patch must not clobber untouched fields back to defaults.
    expect(save.body.plannerState.sipMonthly).toBe(5000);

    const login = await request(app).post("/api/auth/login").send({ identifier: "plannersave@example.com", password: "Passw0rd!" });
    expect(login.body.user.plannerState.lumpsumAmount).toBe(250000);
    expect(login.body.user.plannerState.mode).toBe("lumpsum");
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/api/users/me/planner").send({ lumpsumAmount: 100000 });
    expect(res.status).toBe(401);
  });

  it("rejects an out-of-range value", async () => {
    const token = await signupAndLogin("9200000007", "plannerinvalid@example.com");
    const res = await request(app).patch("/api/users/me/planner").set({ Authorization: `Bearer ${token}` }).send({ sipStepUp: 500 });
    expect(res.status).toBe(400);
  });
});

// Guided tour (frontend/src/components/Walkthrough.jsx) — must auto-start
// exactly once ever, not once per session/login, so it's backed by a real
// account field rather than sessionStorage/localStorage.
describe("walkthrough seen flag", () => {
  it("defaults to false for a brand-new account", async () => {
    const token = await signupAndLogin("9200000008", "walkthroughdefault@example.com");
    const me = await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${token}` });
    expect(me.body.user.hasSeenWalkthrough).toBe(false);
  });

  it("PATCH sets it true and it stays true on the next login", async () => {
    const token = await signupAndLogin("9200000009", "walkthroughseen@example.com");
    const mark = await request(app).patch("/api/users/me/walkthrough").set({ Authorization: `Bearer ${token}` });
    expect(mark.status).toBe(200);
    expect(mark.body.user.hasSeenWalkthrough).toBe(true);

    const login = await request(app).post("/api/auth/login").send({ identifier: "walkthroughseen@example.com", password: "Passw0rd!" });
    expect(login.body.user.hasSeenWalkthrough).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/api/users/me/walkthrough");
    expect(res.status).toBe(401);
  });
});

describe("account deletion", () => {
  it("deletes the account and cascades its holdings", async () => {
    const token = await signupAndLogin("9200000004", "deleteme@example.com");
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post("/api/holdings/manual").set(auth).send({
      assetClass: "EQUITY", name: "Wipro", investedValue: 3000, currentValue: 3100,
    });

    const del = await request(app).delete("/api/users/me").set(auth);
    expect(del.status).toBe(200);

    // access token still technically valid (short-lived JWT), but the user record is gone
    const me = await request(app).get("/api/auth/me").set(auth);
    expect(me.status).toBe(404);

    const login = await request(app).post("/api/auth/login").send({ identifier: "deleteme@example.com", password: "Passw0rd!" });
    expect(login.status).toBe(404);
    expect(login.body.error).toBe("USER_NOT_FOUND");
  });

  it("requires authentication", async () => {
    const res = await request(app).delete("/api/users/me");
    expect(res.status).toBe(401);
  });
});
