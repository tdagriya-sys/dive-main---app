import request from "supertest";
import { createApp } from "../src/app";

// Regression test for a real bug found live on a real user's account:
// Express generates a weak ETag for every res.json() response by default.
// A page reload re-sends the same GET with If-None-Match, and — since
// authenticated data like /holdings hadn't changed — the server correctly
// answered 304 Not Modified per HTTP semantics. In most cases a browser
// resolves that transparently from its own cache, but a real user on Edge
// received the 304 with a genuinely EMPTY body, which the frontend then
// rendered as "No investments yet" over a real, 12-holding portfolio — no
// error surfaced anywhere, since nothing had actually failed from its own
// point of view. app.ts now sets `Cache-Control: no-store` by default for
// every /api response and disables Express's ETag generation outright, so
// there's nothing left for a browser to revalidate against. The two
// genuinely public, non-personal endpoints that want caching set their own
// Cache-Control afterward, which must keep overriding this default.
const app = createApp();

describe("API response caching", () => {
  it("sets Cache-Control: no-store and no ETag on a private, authenticated endpoint (/api/holdings)", async () => {
    const signup = {
      name: "Cache Tester",
      mobile: "9123456781",
      email: "cache-tester@example.com",
      age: 30,
      password: "Passw0rd!",
      confirmPassword: "Passw0rd!",
    };
    const start = await request(app).post("/api/auth/signup/start").send(signup);
    const verify = await request(app).post("/api/auth/signup/verify").send({ mobile: "9123456781", otp: start.body.devOtp });
    const accessToken = verify.body.accessToken as string;

    const res = await request(app).get("/api/holdings").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["etag"]).toBeUndefined();
  });

  it("still lets a genuinely public, cacheable endpoint (/api/app-settings) set its own Cache-Control", async () => {
    const res = await request(app).get("/api/app-settings");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
    expect(res.headers["cache-control"]).not.toBe("no-store");
  });

  it("still lets /api/score/config set its own Cache-Control", async () => {
    const res = await request(app).get("/api/score/config");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).not.toBe("no-store");
  });
});
