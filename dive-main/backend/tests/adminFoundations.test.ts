import { AuditLog } from "../src/models/AuditLog";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { recordAudit, shallowDiff } from "../src/services/auditLog";
import { emitActivity } from "../src/services/activityLog";
import { reqInfo } from "../src/lib/reqInfo";

// Phase 0 of docs/ADMIN_PANEL_PLAN.md — the audit-log + activity-event data
// layer that every later admin phase writes through.

describe("shallowDiff", () => {
  it("returns only the keys that actually changed, on both sides", () => {
    const d = shallowDiff({ a: 1, b: 2, c: 3 }, { a: 1, b: 20, c: 3 });
    expect(d).toEqual({ before: { b: 2 }, after: { b: 20 } });
  });

  it("returns undefined when nothing changed", () => {
    expect(shallowDiff({ a: 1 }, { a: 1 })).toBeUndefined();
  });

  it("handles added / removed keys", () => {
    const d = shallowDiff({ a: 1 }, { a: 1, b: 2 });
    expect(d).toEqual({ before: { b: undefined }, after: { b: 2 } });
  });

  it("falls back to whole-value diff for non-objects", () => {
    expect(shallowDiff("old", "new")).toEqual({ before: "old", after: "new" });
  });
});

describe("recordAudit", () => {
  it("writes an entry with actor, resource, request context and a computed diff", async () => {
    await recordAudit(
      {
        action: "scoring_config.publish",
        resourceType: "ScoringConfig",
        resourceId: "v2",
        before: { weight: 0.1 },
        after: { weight: 0.2 },
        meta: { changeNote: "bump" },
      },
      { actorId: undefined, actorRole: "superadmin", actorLabel: "boss@divve.in" },
      { ip: "10.0.0.1", headers: { "user-agent": "jest" }, id: "req-123" }
    );

    const entry = await AuditLog.findOne({ action: "scoring_config.publish" }).lean();
    expect(entry).toBeTruthy();
    expect(entry!.resourceType).toBe("ScoringConfig");
    expect(entry!.resourceId).toBe("v2");
    expect(entry!.actorRole).toBe("superadmin");
    expect(entry!.actorLabel).toBe("boss@divve.in");
    expect(entry!.ip).toBe("10.0.0.1");
    expect(entry!.userAgent).toBe("jest");
    expect(entry!.requestId).toBe("req-123");
    expect(entry!.diff).toEqual({ before: { weight: 0.1 }, after: { weight: 0.2 } });
    expect(entry!.meta).toEqual({ changeNote: "bump" });
  });

  it("omits diff when no before/after supplied", async () => {
    await recordAudit({ action: "user.force_logout", resourceType: "User", resourceId: "u1" });
    const entry = await AuditLog.findOne({ action: "user.force_logout" }).lean();
    expect(entry!.diff).toBeUndefined();
  });

  it("never throws on a malformed entry (best-effort)", async () => {
    // action is required by the schema — a missing one must be swallowed, not thrown.
    await expect(
      recordAudit({ action: undefined as unknown as string, resourceType: "X" })
    ).resolves.toBeUndefined();
  });
});

describe("emitActivity", () => {
  it("inserts an activity event with type, user and props", async () => {
    await emitActivity("bot_scan", {
      userId: undefined,
      props: { frames: 12 },
      req: { ip: "1.2.3.4", headers: { "user-agent": "ua" }, id: 7 },
    });
    const ev = await ActivityEvent.findOne({ type: "bot_scan" }).lean();
    expect(ev).toBeTruthy();
    expect(ev!.props).toEqual({ frames: 12 });
    expect(ev!.ip).toBe("1.2.3.4");
    expect(ev!.userAgent).toBe("ua");
  });

  it("resolves without throwing even with no options", async () => {
    await expect(emitActivity("login")).resolves.toBeUndefined();
  });
});

describe("reqInfo", () => {
  it("tolerates a missing request", () => {
    expect(reqInfo()).toEqual({});
  });

  it("stringifies a numeric request id and reads the UA header", () => {
    expect(reqInfo({ ip: "9.9.9.9", headers: { "user-agent": "x" }, id: 42 })).toEqual({
      ip: "9.9.9.9",
      userAgent: "x",
      requestId: "42",
    });
  });
});
