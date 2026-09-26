import { Types } from "mongoose";
import { User } from "../src/models/User";
import { ActivityEvent } from "../src/models/ActivityEvent";
import { maskIdentifier } from "../src/lib/maskIdentifier";
import { ACTIVITY_TYPES, activityGroup, activityLabel } from "../src/services/activityCatalog";
import { csvCell, exportUserActivityCsv, listActivityTypes, parseFilterDate, queryUserActivity, summarizeProps } from "../src/services/userActivityService";

// The data behind the admin "User Activity" page: filtering, paging, the CSV
// export, and the masking used for attempts against accounts that may not exist.

let mobileCounter = 9210000000;
async function makeUser(email: string, name = "Some User") {
  return User.create({ name, mobile: String(mobileCounter++), email, age: 30, passwordHash: "x" });
}
const ev = (type: string, extra: Partial<{ userId: Types.ObjectId; ts: Date; props: Record<string, unknown>; ip: string; userAgent: string }> = {}) =>
  ActivityEvent.create({ type, ts: new Date(), ...extra });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

describe("maskIdentifier", () => {
  it("keeps just enough to recognise a repeat offender", () => {
    expect(maskIdentifier("tushar@divve.in")).toBe("t***@divve.in");
    expect(maskIdentifier("9509866887")).toBe("95******87");
    expect(maskIdentifier("+919509866887")).toBe("+9*********87");
  });
  it("copes with short, empty and missing values", () => {
    expect(maskIdentifier("1234")).toBe("****");
    expect(maskIdentifier("")).toBe("");
    expect(maskIdentifier(undefined)).toBe("");
    expect(maskIdentifier("a@b.co")).toBe("a***@b.co");
  });
  it("never returns the original identifier", () => {
    for (const raw of ["someone@example.com", "9876543210", "x@y.z"]) expect(maskIdentifier(raw)).not.toBe(raw);
  });
});

describe("activity catalog", () => {
  it("labels and groups known types, and passes unknown ones through", () => {
    expect(activityLabel("login_failed")).toBe("Failed login");
    expect(activityGroup("login_failed")).toBe("security");
    expect(activityLabel("brand_new_type")).toBe("brand_new_type");
    expect(activityGroup("brand_new_type")).toBe("other");
  });
  it("every extra event this feature records is in the catalog", () => {
    for (const t of ["login_failed", "otp_failed", "password_reset_requested", "password_reset_completed", "password_changed", "password_change_failed", "session_reuse_detected", "profile_updated", "preferences_updated", "data_export_requested", "account_deleted", "payment_failed", "coupon_redeemed", "ticket_created"]) {
      expect(ACTIVITY_TYPES[t]).toBeDefined();
    }
  });
});

describe("parseFilterDate", () => {
  it("a date-only value covers the whole IST day", () => {
    expect(parseFilterDate("2026-09-26", false)?.toISOString()).toBe("2026-09-25T18:30:00.000Z"); // 00:00 IST
    expect(parseFilterDate("2026-09-26", true)?.toISOString()).toBe("2026-09-26T18:29:59.999Z"); // 23:59:59.999 IST
  });
  it("accepts a full ISO timestamp as is, and rejects junk", () => {
    expect(parseFilterDate("2026-09-26T10:00:00.000Z", false)?.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(parseFilterDate("not a date", false)).toBeUndefined();
    expect(parseFilterDate(undefined, false)).toBeUndefined();
  });
});

describe("summarizeProps", () => {
  it("reads props as one short line and skips empties", () => {
    expect(summarizeProps({ reason: "wrong_password", identifier: "t***@x.in", empty: "", nothing: null })).toBe("reason: wrong_password · identifier: t***@x.in");
    expect(summarizeProps({ fields: ["name", "age"] })).toBe("fields: name, age");
    expect(summarizeProps(undefined)).toBe("");
  });
  it("truncates a very long summary", () => {
    expect(summarizeProps({ note: "x".repeat(500) }).length).toBeLessThanOrEqual(200);
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });
  it("defuses spreadsheet formulas (a user-controlled user-agent could otherwise run one)", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("queryUserActivity", () => {
  it("lists newest first, with the user's email and name and a plain-English label", async () => {
    const u = await makeUser("ada@example.com", "Ada Lovelace");
    await ev("login", { userId: u._id, ts: daysAgo(2), ip: "1.2.3.4" });
    await ev("holding_added", { userId: u._id, ts: daysAgo(1), props: { assetClass: "EQUITY" } });

    const r = await queryUserActivity({}, 1, 50);
    expect(r.total).toBe(2);
    expect(r.events.map((e) => e.type)).toEqual(["holding_added", "login"]);
    expect(r.events[0]).toMatchObject({ userEmail: "ada@example.com", userName: "Ada Lovelace", label: "Added a holding", group: "portfolio", summary: "assetClass: EQUITY" });
    expect(r.events[1].ip).toBe("1.2.3.4");
  });

  it("filters by user id, and by part of an email address", async () => {
    const ada = await makeUser("ada@example.com");
    const bob = await makeUser("bob@example.com");
    await ev("login", { userId: ada._id });
    await ev("login", { userId: bob._id });

    expect((await queryUserActivity({ user: String(ada._id) }, 1, 50)).events).toHaveLength(1);
    const byEmail = await queryUserActivity({ user: "BOB@exam" }, 1, 50); // case-insensitive, partial
    expect(byEmail.events.map((e) => e.userEmail)).toEqual(["bob@example.com"]);
  });

  it("a user filter that matches nobody returns nothing — never everyone", async () => {
    const ada = await makeUser("ada@example.com");
    await ev("login", { userId: ada._id });
    expect((await queryUserActivity({ user: "nobody-like-this" }, 1, 50)).events).toEqual([]);
    expect((await queryUserActivity({ user: "000000000000000000000000" }, 1, 50)).events).toEqual([]);
  });

  it("treats regex characters in the user filter literally", async () => {
    await makeUser("a.b@example.com");
    await makeUser("axb@example.com");
    const u1 = await User.findOne({ email: "a.b@example.com" });
    const u2 = await User.findOne({ email: "axb@example.com" });
    await ev("login", { userId: u1!._id });
    await ev("login", { userId: u2!._id });
    expect((await queryUserActivity({ user: "a.b@" }, 1, 50)).events.map((e) => e.userEmail)).toEqual(["a.b@example.com"]);
  });

  it("filters by event type(s) and by group", async () => {
    const u = await makeUser("ada@example.com");
    await ev("login", { userId: u._id });
    await ev("login_failed", { userId: u._id });
    await ev("password_changed", { userId: u._id });
    await ev("holding_added", { userId: u._id });

    expect((await queryUserActivity({ types: ["login"] }, 1, 50)).events.map((e) => e.type)).toEqual(["login"]);
    expect((await queryUserActivity({ types: ["login", "holding_added"] }, 1, 50)).total).toBe(2);
    const security = await queryUserActivity({ group: "security" }, 1, 50);
    expect(security.events.map((e) => e.type).sort()).toEqual(["login_failed", "password_changed"]);
    // A type filter and a group filter together narrow to the overlap.
    expect((await queryUserActivity({ group: "security", types: ["login", "password_changed"] }, 1, 50)).events.map((e) => e.type)).toEqual(["password_changed"]);
  });

  it("filters by date — an IST day includes its whole day and excludes the next", async () => {
    const u = await makeUser("ada@example.com");
    await ev("login", { userId: u._id, ts: new Date("2026-09-25T18:31:00Z") }); // 00:01 IST on the 26th
    await ev("logout", { userId: u._id, ts: new Date("2026-09-26T18:29:00Z") }); // 23:59 IST on the 26th
    await ev("signup", { userId: u._id, ts: new Date("2026-09-26T18:31:00Z") }); // 00:01 IST on the 27th
    const day = await queryUserActivity({ from: parseFilterDate("2026-09-26", false), to: parseFilterDate("2026-09-26", true) }, 1, 50);
    expect(day.events.map((e) => e.type).sort()).toEqual(["login", "logout"]);
    expect((await queryUserActivity({ from: parseFilterDate("2026-09-27", false) }, 1, 50)).events.map((e) => e.type)).toEqual(["signup"]);
  });

  it("includes events with no user (e.g. a failed login for an account that doesn't exist), and shows them with no email", async () => {
    await ev("login_failed", { props: { reason: "unknown_account", identifier: "x***@gmail.com" } });
    const r = await queryUserActivity({}, 1, 50);
    expect(r.events[0]).toMatchObject({ userId: null, userEmail: null, summary: "reason: unknown_account · identifier: x***@gmail.com" });
  });

  it("an event whose user was deleted since keeps its row (no email)", async () => {
    await ev("login", { userId: new Types.ObjectId() });
    const r = await queryUserActivity({}, 1, 50);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].userEmail).toBeNull();
  });

  it("pages through results with a total", async () => {
    const u = await makeUser("ada@example.com");
    for (let i = 0; i < 5; i++) await ev("login", { userId: u._id, ts: daysAgo(i) });
    const p1 = await queryUserActivity({}, 1, 2);
    const p3 = await queryUserActivity({}, 3, 2);
    expect(p1).toMatchObject({ total: 5, totalPages: 3, page: 1 });
    expect(p1.events).toHaveLength(2);
    expect(p3.events).toHaveLength(1);
  });
});

describe("listActivityTypes", () => {
  it("offers every catalog type plus any other type present in the data, labelled", async () => {
    await ev("some_future_event");
    const types = await listActivityTypes();
    expect(types.find((t) => t.type === "login_failed")).toMatchObject({ label: "Failed login", group: "security" });
    expect(types.find((t) => t.type === "some_future_event")).toMatchObject({ label: "some_future_event", group: "other" });
  });
});

describe("exportUserActivityCsv", () => {
  it("writes a header and one row per event, with the user and details", async () => {
    const u = await makeUser("ada@example.com", "Ada, Countess");
    await ev("login_failed", { userId: u._id, ip: "9.9.9.9", userAgent: "Mozilla/5.0", props: { reason: "wrong_password" }, ts: new Date("2026-09-26T10:00:00Z") });

    const { csv, rowCount, truncated } = await exportUserActivityCsv({});
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("time_ist,time_utc,type,event,group,user_id,user_email,user_name,ip,user_agent,details");
    expect(rowCount).toBe(1);
    expect(truncated).toBe(false);
    expect(lines[1]).toContain("2026-09-26 15:30:00,2026-09-26T10:00:00.000Z,login_failed,Failed login,security,");
    expect(lines[1]).toContain("ada@example.com,\"Ada, Countess\",9.9.9.9,Mozilla/5.0,");
    expect(lines[1]).toContain('"{""reason"":""wrong_password""}"');
  });

  it("respects the same filters as the page", async () => {
    const u = await makeUser("ada@example.com");
    await ev("login", { userId: u._id });
    await ev("login_failed", { userId: u._id });
    const { csv, rowCount } = await exportUserActivityCsv({ group: "security" });
    expect(rowCount).toBe(1);
    expect(csv).toContain("login_failed");
    expect(csv).not.toContain(",login,");
  });

  it("says when the cap cut the export short, and keeps the NEWEST rows", async () => {
    const u = await makeUser("ada@example.com");
    for (let i = 0; i < 5; i++) await ev("login", { userId: u._id, ts: daysAgo(10 - i) });
    const { csv, rowCount, truncated } = await exportUserActivityCsv({}, 3);
    expect(rowCount).toBe(3);
    expect(truncated).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(4); // header + 3
  });

  it("a filter matching nobody exports just the header", async () => {
    const { csv, rowCount } = await exportUserActivityCsv({ user: "nobody-like-this" });
    expect(rowCount).toBe(0);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("defuses a hostile user-agent", async () => {
    const u = await makeUser("ada@example.com");
    await ev("login", { userId: u._id, userAgent: "=cmd|' /C calc'!A0" });
    const { csv } = await exportUserActivityCsv({});
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/,=cmd/);
  });
});
