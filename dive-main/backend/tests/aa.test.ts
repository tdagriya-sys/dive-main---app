import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

async function signupAndLogin(mobile: string, email: string) {
  const signup = { name: "AA Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return verify.body.accessToken as string;
}

describe("Finvu AA mock-mode flow", () => {
  it("walks the full consent -> approve -> fetch -> holdings pipeline", async () => {
    const token = await signupAndLogin("9555555555", "aa1@example.com");
    const auth = { Authorization: `Bearer ${token}` };

    const requestRes = await request(app).post("/api/aa/consent/request").set(auth);
    expect(requestRes.status).toBe(201);
    expect(requestRes.body.isMock).toBe(true);
    const { consentHandle } = requestRes.body;

    const statusBefore = await request(app).get(`/api/aa/consent/${consentHandle}/status`).set(auth);
    expect(statusBefore.body.status).toBe("PENDING");

    const fetchTooEarly = await request(app).post(`/api/aa/consent/${consentHandle}/fetch`).set(auth);
    expect(fetchTooEarly.status).toBe(400);

    const approveRes = await request(app).post(`/api/aa/consent/${consentHandle}/approve`).set(auth);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("ACTIVE");

    const fetchRes = await request(app).post(`/api/aa/consent/${consentHandle}/fetch`).set(auth);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.isMock).toBe(true);
    expect(fetchRes.body.holdings.length).toBeGreaterThan(0);
    expect(fetchRes.body.holdings.every((h: { source: string }) => h.source === "AA")).toBe(true);

    const holdingsList = await request(app).get("/api/holdings").set(auth);
    expect(holdingsList.body.holdings.length).toBe(fetchRes.body.holdings.length);
  });

  it("re-fetching the same (or a new) consent updates existing AA holdings instead of duplicating them", async () => {
    const token = await signupAndLogin("9555555556", "aa-refetch@example.com");
    const auth = { Authorization: `Bearer ${token}` };

    const first = await request(app).post("/api/aa/consent/request").set(auth);
    await request(app).post(`/api/aa/consent/${first.body.consentHandle}/approve`).set(auth);
    const firstFetch = await request(app).post(`/api/aa/consent/${first.body.consentHandle}/fetch`).set(auth);
    const countAfterFirst = firstFetch.body.holdings.length;

    // Simulate the user reconnecting AA later (a brand new consent handle,
    // same synthetic data) — this must update the existing holdings, not add more.
    const second = await request(app).post("/api/aa/consent/request").set(auth);
    await request(app).post(`/api/aa/consent/${second.body.consentHandle}/approve`).set(auth);
    const secondFetch = await request(app).post(`/api/aa/consent/${second.body.consentHandle}/fetch`).set(auth);
    expect(secondFetch.body.holdings.length).toBe(countAfterFirst);

    const holdingsList = await request(app).get("/api/holdings").set(auth);
    expect(holdingsList.body.holdings.length).toBe(countAfterFirst);

    // Quantities/values should be updated in place, not summed.
    const infosys = holdingsList.body.holdings.find((h: { name: string }) => h.name === "Infosys");
    expect(infosys.quantity).toBe(20);
  });

  it("scopes consents to the requesting user", async () => {
    const tokenA = await signupAndLogin("9666666666", "aa2@example.com");
    const tokenB = await signupAndLogin("9777777777", "aa3@example.com");
    const requestRes = await request(app).post("/api/aa/consent/request").set({ Authorization: `Bearer ${tokenA}` });
    const { consentHandle } = requestRes.body;

    const res = await request(app).get(`/api/aa/consent/${consentHandle}/status`).set({ Authorization: `Bearer ${tokenB}` });
    expect(res.status).toBe(404);
  });
});
