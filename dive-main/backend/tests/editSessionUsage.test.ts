import RedisMock from "ioredis-mock";
import { User } from "../src/models/User";
import { UsageEvent } from "../src/models/UsageEvent";
import { AuthedRequest } from "../src/middleware/auth";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.4 — edit-session coalescing, WITH
// a real (mocked) Redis this time — usageService.test.ts's own suite covers
// the "no Redis configured -> fails open" side without this. Mocking
// lib/redisClient.ts directly (rather than tests/distributedLock.test.ts's
// jest.isolateModules approach) — usageService.ts transitively pulls in
// Mongoose models (via entitlementService.ts), and isolateModules would
// re-require a second, disconnected `mongoose` instance alongside the one
// tests/setup.ts already connected, hanging every DB call in this file.
const mockRedis = new RedisMock();
jest.mock("../src/lib/redisClient", () => ({
  getRedisClient: () => mockRedis,
}));

// Imported AFTER the mock above so it picks up the mocked getRedisClient.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const usageService: typeof import("../src/services/usageService") = require("../src/services/usageService");

let mobileCounter = 9910000000;
// hasCompletedFirstPortfolioEdit: true by default — this file tests SESSION
// COALESCING itself, not the first-edit exemption (see its own dedicated
// describe block below), so every user here starts past that exemption,
// same as any real user on their second-or-later portfolio-building trip.
async function makeUser(overrides: Partial<{ hasCompletedFirstPortfolioEdit: boolean }> = {}) {
  return User.create({
    name: "Session User",
    mobile: String(mobileCounter++),
    email: `session-${mobileCounter}@example.com`,
    age: 30,
    passwordHash: "x",
    hasCompletedFirstPortfolioEdit: overrides.hasCompletedFirstPortfolioEdit ?? true,
  });
}

function mockRes() {
  let finishCallback: (() => void) | undefined;
  const res: { statusCode: number; body?: unknown; status: jest.Mock; json: jest.Mock; on: jest.Mock; triggerFinish: () => void } = {
    statusCode: 200,
    status: jest.fn(function (this: unknown, code: number) {
      res.statusCode = code;
      return res as never;
    }),
    json: jest.fn(function (this: unknown, body: unknown) {
      res.body = body;
      return res as never;
    }),
    on: jest.fn((event: string, cb: () => void) => {
      if (event === "finish") finishCallback = cb;
    }),
    triggerFinish: () => finishCallback?.(),
  };
  return res;
}

afterEach(async () => {
  await mockRedis.flushall();
});

describe("enforceEditSessionUsage — with Redis", () => {
  it("opens a session on the first mutation (recording one UsageEvent), then coalesces further mutations for free", async () => {
    const user = await makeUser();
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const middleware = usageService.enforceEditSessionUsage("portfolio_edit");

    const res1 = mockRes();
    const next1 = jest.fn();
    await middleware(req, res1 as never, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    res1.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(1);

    // Second mutation, same "session" — no new UsageEvent, still allowed.
    const res2 = mockRes();
    const next2 = jest.fn();
    await middleware(req, res2 as never, next2);
    expect(next2).toHaveBeenCalledTimes(1);
    res2.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(1); // still 1, not 2
  });

  it("blocks a brand-new session once the Freemium weekly limit (2) is reached", async () => {
    const user = await makeUser();
    await UsageEvent.create({ userId: user._id, key: "portfolio_edit" });
    await UsageEvent.create({ userId: user._id, key: "portfolio_edit" });

    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const res = mockRes();
    const next = jest.fn();
    await usageService.enforceEditSessionUsage("portfolio_edit")(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ error: "PLAN_LIMIT_REACHED", key: "portfolio_edit" });
  });

  it("closeAllEditSessions ends the session early, so the next mutation opens a fresh one", async () => {
    const user = await makeUser();
    const userId = String(user._id);
    const req = { userId } as unknown as AuthedRequest;
    const middleware = usageService.enforceEditSessionUsage("portfolio_edit");

    const res1 = mockRes();
    await middleware(req, res1 as never, jest.fn());
    res1.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));

    await usageService.closeAllEditSessions(userId);

    const res2 = mockRes();
    await middleware(req, res2 as never, jest.fn());
    res2.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    // Two separate sessions opened -> two counted edits.
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(2);
  });

  it("a failed mutation doesn't leave a session open (deletes the key so the limit isn't silently bypassed)", async () => {
    const user = await makeUser();
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const res = mockRes();
    await usageService.enforceEditSessionUsage("portfolio_edit")(req, res as never, jest.fn());
    res.statusCode = 500;
    res.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await mockRedis.exists(`edit-session:portfolio_edit:${user._id}`)).toBe(0);
  });

  // Regression: bot_scan's frontend polls POST /botscan/analyze roughly
  // every 1.8s for the duration of one scan — without this same coalescing,
  // a Freemium user's weekly bot_scan limit (as low as 1) could exhaust
  // itself on the second captured frame of their first-ever scan.
  it("coalesces a burst of bot_scan calls into one UsageEvent, independently of portfolio_edit", async () => {
    const user = await makeUser();
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const botScanMiddleware = usageService.enforceEditSessionUsage("bot_scan");
    const editMiddleware = usageService.enforceEditSessionUsage("portfolio_edit");

    // Three "frames" of the same scan.
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      await botScanMiddleware(req, res as never, jest.fn());
      res.triggerFinish();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "bot_scan" })).toBe(1);

    // A portfolio_edit call in between doesn't touch the bot_scan session
    // (or vice versa) — each key's session is tracked independently.
    const editRes = mockRes();
    await editMiddleware(req, editRes as never, jest.fn());
    editRes.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(1);
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "bot_scan" })).toBe(1);
  });

  it("closeAllEditSessions closes portfolio_edit AND bot_scan sessions together", async () => {
    const user = await makeUser();
    const userId = String(user._id);
    const req = { userId } as unknown as AuthedRequest;

    const editRes = mockRes();
    await usageService.enforceEditSessionUsage("portfolio_edit")(req, editRes as never, jest.fn());
    editRes.triggerFinish();
    const scanRes = mockRes();
    await usageService.enforceEditSessionUsage("bot_scan")(req, scanRes as never, jest.fn());
    scanRes.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await mockRedis.exists(`edit-session:portfolio_edit:${userId}`)).toBe(1);
    expect(await mockRedis.exists(`edit-session:bot_scan:${userId}`)).toBe(1);

    await usageService.closeAllEditSessions(userId);

    expect(await mockRedis.exists(`edit-session:portfolio_edit:${userId}`)).toBe(0);
    expect(await mockRedis.exists(`edit-session:bot_scan:${userId}`)).toBe(0);
  });
});

// Requirement: a fresh user's first-ever portfolio-building session (adding
// their initial holdings, before ever reaching Home to see a real score) is
// free — only sessions from the SECOND one onward are metered.
describe("enforceEditSessionUsage — first-ever portfolio_edit session is exempt", () => {
  it("does not record a UsageEvent for a burst of mutations in a brand-new user's first session", async () => {
    const user = await makeUser({ hasCompletedFirstPortfolioEdit: false });
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const middleware = usageService.enforceEditSessionUsage("portfolio_edit");

    // Three "holdings" added while building the initial portfolio.
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      const next = jest.fn();
      await middleware(req, res as never, next);
      expect(next).toHaveBeenCalledTimes(1); // never blocked, even past Freemium's weekly limit of 2
      res.triggerFinish();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(0);
    expect((await User.findById(user._id).lean())?.hasCompletedFirstPortfolioEdit).toBe(true);
  });

  it("meters normally from the second session onward", async () => {
    const user = await makeUser({ hasCompletedFirstPortfolioEdit: false });
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const middleware = usageService.enforceEditSessionUsage("portfolio_edit");

    // First (exempt) session.
    const res1 = mockRes();
    await middleware(req, res1 as never, jest.fn());
    res1.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(0);

    // Reaching Home closes the first session; a later, separate edit opens
    // a genuinely new one and IS metered.
    await usageService.closeAllEditSessions(String(user._id));
    const res2 = mockRes();
    await middleware(req, res2 as never, jest.fn());
    res2.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "portfolio_edit" })).toBe(1);
  });

  it("does not exempt bot_scan — only portfolio_edit", async () => {
    const user = await makeUser({ hasCompletedFirstPortfolioEdit: false });
    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const res = mockRes();
    await usageService.enforceEditSessionUsage("bot_scan")(req, res as never, jest.fn());
    res.triggerFinish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await UsageEvent.countDocuments({ userId: user._id, key: "bot_scan" })).toBe(1);
  });
});
