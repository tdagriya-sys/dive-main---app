import { User } from "../src/models/User";
import { UsageEvent } from "../src/models/UsageEvent";
import { UsageGrant } from "../src/models/UsageGrant";
import { AuthedRequest } from "../src/middleware/auth";
import * as usageService from "../src/services/usageService";
import * as subscriptionService from "../src/services/subscriptionService";
import { seedDefaultSubscriptionPlansIfEmpty } from "../src/services/entitlementService";

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.4 — rolling-window usage
// metering + enforcement, exercised directly against mock req/res/next
// (same convention as tests/rbacMiddleware.test.ts).

beforeEach(async () => {
  await seedDefaultSubscriptionPlansIfEmpty();
});

let mobileCounter = 9900000000;
async function makeUser() {
  return User.create({ name: "Usage User", mobile: String(mobileCounter++), email: `usage-${mobileCounter}@example.com`, age: 30, passwordHash: "x" });
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

describe("recordUsageEvent / countUsageInWindow", () => {
  it("counts only events within the given window", async () => {
    const user = await makeUser();
    await usageService.recordUsageEvent(String(user._id), "bot_scan");
    await UsageEvent.create({ userId: user._id, key: "bot_scan", ts: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) }); // outside any real window
    const count = await usageService.countUsageInWindow(String(user._id), "bot_scan", 7 * 24 * 60 * 60 * 1000);
    expect(count).toBe(1);
  });
});

describe("assertUsageAllowed (ad-hoc, doc_upload's AI-only branch)", () => {
  it("throws PLAN_LIMIT_REACHED once the weekly limit is hit", async () => {
    const user = await makeUser();
    await UsageEvent.create({ userId: user._id, key: "doc_upload" });
    await expect(usageService.assertUsageAllowed(String(user._id), "doc_upload")).rejects.toMatchObject({ status: 403, code: "PLAN_LIMIT_REACHED" });
  });

  it("resolves when under the limit", async () => {
    const user = await makeUser();
    await expect(usageService.assertUsageAllowed(String(user._id), "doc_upload")).resolves.toBeUndefined();
  });

  it("throws once the monthly ceiling is hit even if the weekly window is clear", async () => {
    const user = await makeUser();
    // 3 events, each > a week old (so the weekly window is clear) but within 30 days.
    for (let i = 0; i < 3; i++) {
      await UsageEvent.create({ userId: user._id, key: "doc_upload", ts: new Date(Date.now() - (8 + i) * 24 * 60 * 60 * 1000) });
    }
    await expect(usageService.assertUsageAllowed(String(user._id), "doc_upload")).rejects.toMatchObject({ status: 403, code: "PLAN_LIMIT_REACHED" });
  });
});

// Requirement: an admin-grantable extra allowance on top of whatever the
// plan already grants (UsageGrant model), independent of Freemium/Premium.
describe("getLimits (via assertUsageAllowed) — UsageGrant bonus", () => {
  it("a bonus raises the effective limit, so a call blocked under the base plan limit now succeeds", async () => {
    const user = await makeUser();
    await UsageEvent.create({ userId: user._id, key: "doc_upload" }); // Freemium docUploadWeekly: 1 — already exhausted
    await expect(usageService.assertUsageAllowed(String(user._id), "doc_upload")).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });

    await UsageGrant.create({ userId: user._id, key: "doc_upload", bonusWeekly: 2, bonusMonthly: 0 });
    await expect(usageService.assertUsageAllowed(String(user._id), "doc_upload")).resolves.toBeUndefined();
  });

  it("a bonus on an already-unlimited (null) plan limit stays unlimited, not a new finite cap", async () => {
    const user = await makeUser();
    await subscriptionService.grantComplimentarySubscription(String(user._id), "premium_monthly", 30); // portfolioEditWeekly/Monthly: null
    await UsageGrant.create({ userId: user._id, key: "portfolio_edit", bonusWeekly: 5, bonusMonthly: 5 });
    for (let i = 0; i < 50; i++) await UsageEvent.create({ userId: user._id, key: "portfolio_edit" });
    // Far more than any finite bonus (5) would allow — only passes if null+bonus is still null.
    await expect(usageService.assertUsageAllowed(String(user._id), "portfolio_edit")).resolves.toBeUndefined();
  });
});

describe("enforceEditSessionUsage — fails open without Redis", () => {
  it("always calls next() and never blocks when Redis isn't configured", async () => {
    const user = await makeUser();
    // Freemium's portfolioEditWeekly is 2 — simulate it already being exhausted.
    await UsageEvent.create({ userId: user._id, key: "portfolio_edit" });
    await UsageEvent.create({ userId: user._id, key: "portfolio_edit" });

    const req = { userId: String(user._id) } as unknown as AuthedRequest;
    const res = mockRes();
    const next = jest.fn();
    await usageService.enforceEditSessionUsage("portfolio_edit")(req, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("closeAllEditSessions — no-op without Redis", () => {
  it("resolves without throwing", async () => {
    await expect(usageService.closeAllEditSessions("anyUserId")).resolves.toBeUndefined();
  });
});
