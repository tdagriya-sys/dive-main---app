import { Types } from "mongoose";
import { User } from "../src/models/User";
import { ExternalContact } from "../src/models/ExternalContact";
import { NotificationCampaign } from "../src/models/NotificationCampaign";
import * as svc from "../src/services/externalContactService";

// Imported (non-user) marketing contacts: parsing pasted/uploaded text, the
// import (which must never resubscribe anyone), named lists, and — the part
// that matters most — who a campaign to a list actually reaches.

let mobileCounter = 9810000000;
async function makeUser(email: string) {
  return User.create({ name: "Existing User", mobile: String(mobileCounter++), email, age: 30, passwordHash: "x" });
}
const attestedBy = () => String(new Types.ObjectId());

describe("isValidEmail / cleanName", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    for (const ok of ["a@b.co", "first.last+tag@sub.example.com", "x_y-z@example.org"]) expect(svc.isValidEmail(ok)).toBe(true);
    for (const bad of ["", "plain", "a@b", "a@b.c", "a b@example.com", "a@@example.com", "<a@example.com>", "a@exa mple.com", `${"x".repeat(65)}@example.com`]) expect(svc.isValidEmail(bad)).toBe(false);
  });

  it("keeps a name to plain printable text and drops anything that isn't a name", () => {
    expect(svc.cleanName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(svc.cleanName("<b>Ada</b>")).toBe("b Ada /b");
    expect(svc.cleanName("Ada\r\nLovelace")).toBe("Ada Lovelace");
    expect(svc.cleanName("ada@example.com")).toBeUndefined();
    expect(svc.cleanName("   ")).toBeUndefined();
    expect(svc.cleanName(undefined)).toBeUndefined();
    expect(svc.cleanName("x".repeat(300))).toHaveLength(100);
  });
});

describe("parseContacts", () => {
  it("reads a CSV with an email/name header, in either column order", () => {
    const a = svc.parseContacts("email,name\nada@example.com,Ada Lovelace\nalan@example.com,Alan Turing");
    expect(a.contacts).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Alan Turing" },
    ]);
    const b = svc.parseContacts("Name,E-mail Address\nAda Lovelace,ADA@Example.com");
    expect(b.contacts).toEqual([{ email: "ada@example.com", name: "Ada Lovelace" }]);
  });

  it("combines first_name and last_name columns into one name", () => {
    const r = svc.parseContacts("email,First Name,Last Name\nada@example.com,Ada,Lovelace\nalan@example.com,Alan,");
    expect(r.contacts).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Alan" },
    ]);
  });

  it("handles quoted fields with commas and escaped quotes, CRLF line endings, and a BOM", () => {
    const r = svc.parseContacts('﻿email,name\r\nada@example.com,"Lovelace, Ada ""Countess"""\r\n');
    expect(r.contacts).toEqual([{ email: "ada@example.com", name: 'Lovelace, Ada "Countess"' }]);
  });

  it("works without a header: the cell with an @ is the email, another cell is the name", () => {
    const r = svc.parseContacts("ada@example.com,Ada Lovelace\nAlan Turing,alan@example.com\nsolo@example.com");
    expect(r.contacts).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Alan Turing" },
      { email: "solo@example.com" },
    ]);
  });

  it("understands `Name <email>` lines pasted straight from a mail client", () => {
    const r = svc.parseContacts('Ada Lovelace <ada@example.com>\n"Turing, Alan" <alan@example.com>');
    expect(r.contacts).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Turing, Alan" },
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(svc.parseContacts("email;name\nada@example.com;Ada").contacts).toEqual([{ email: "ada@example.com", name: "Ada" }]);
    expect(svc.parseContacts("email\tname\nada@example.com\tAda").contacts).toEqual([{ email: "ada@example.com", name: "Ada" }]);
  });

  it("reports invalid rows with their line numbers, and skips blank lines", () => {
    const r = svc.parseContacts("email,name\nada@example.com,Ada\n\nnot-an-email,Bob\n,Nobody\nalan@example.com,Alan");
    expect(r.contacts.map((c) => c.email)).toEqual(["ada@example.com", "alan@example.com"]);
    expect(r.invalid).toHaveLength(2);
    expect(r.invalid[0]).toMatchObject({ line: 3, reason: "Not a valid email address" });
    expect(r.invalid[1]).toMatchObject({ line: 4, reason: "No email address found" });
  });

  it("de-duplicates addresses in the file (case-insensitively), keeping a name if a later duplicate has one", () => {
    const r = svc.parseContacts("email,name\nada@example.com,\nADA@example.com,Ada Lovelace\nada@example.com,Someone Else");
    expect(r.contacts).toEqual([{ email: "ada@example.com", name: "Ada Lovelace" }]);
    expect(r.duplicatesInFile).toBe(2);
  });

  it("drops a 'name' that is really an email address, and never returns markup-y control characters", () => {
    const r = svc.parseContacts("email,name\nada@example.com,ada@example.com");
    expect(r.contacts).toEqual([{ email: "ada@example.com" }]);
  });

  it("returns nothing for empty input", () => {
    expect(svc.parseContacts("").contacts).toEqual([]);
    expect(svc.parseContacts("\n\n  \n").contacts).toEqual([]);
  });
});

describe("importContacts", () => {
  const base = { listName: "Launch", source: "Webinar signups", attestedBy: attestedBy() };

  it("creates contacts on the list with their name, source, and a consent trail", async () => {
    const who = attestedBy();
    const result = await svc.importContacts({ ...base, attestedBy: who, contacts: [{ email: "ada@example.com", name: "Ada" }, { email: "alan@example.com" }] });
    expect(result).toEqual({ total: 2, added: 2, updated: 0, unsubscribedKept: 0, alreadyRegistered: 0 });

    const ada = await ExternalContact.findOne({ email: "ada@example.com" }).lean();
    expect(ada).toMatchObject({ name: "Ada", lists: ["Launch"], source: "Webinar signups", unsubscribed: false });
    expect(String(ada!.consentAttestedBy)).toBe(who);
    expect(ada!.consentAttestedAt).toBeInstanceOf(Date);
    expect((await ExternalContact.findOne({ email: "alan@example.com" }).lean())!.name).toBeUndefined();
  });

  it("re-importing adds the contact to another list without duplicating it, and only overwrites the name when a new one is given", async () => {
    await svc.importContacts({ ...base, contacts: [{ email: "ada@example.com", name: "Ada" }] });
    const second = await svc.importContacts({ ...base, listName: "Beta", contacts: [{ email: "ada@example.com" }] });
    expect(second).toMatchObject({ added: 0, updated: 1 });
    let ada = await ExternalContact.findOne({ email: "ada@example.com" }).lean();
    expect([...ada!.lists].sort()).toEqual(["Beta", "Launch"]);
    expect(ada!.name).toBe("Ada");
    expect(await ExternalContact.countDocuments({ email: "ada@example.com" })).toBe(1);

    await svc.importContacts({ ...base, listName: "Beta", contacts: [{ email: "ada@example.com", name: "Ada Lovelace" }] });
    ada = await ExternalContact.findOne({ email: "ada@example.com" }).lean();
    expect(ada!.name).toBe("Ada Lovelace");
    expect(ada!.lists.filter((l) => l === "Beta")).toHaveLength(1);
  });

  it("NEVER resubscribes an unsubscribed contact — re-importing keeps them suppressed", async () => {
    await svc.importContacts({ ...base, contacts: [{ email: "gone@example.com" }] });
    await ExternalContact.updateOne({ email: "gone@example.com" }, { unsubscribed: true, unsubscribedAt: new Date() });

    const result = await svc.importContacts({ ...base, listName: "Fresh list", contacts: [{ email: "gone@example.com" }, { email: "new@example.com" }] });
    expect(result).toMatchObject({ total: 2, added: 1, updated: 1, unsubscribedKept: 1 });
    const gone = await ExternalContact.findOne({ email: "gone@example.com" }).lean();
    expect(gone!.unsubscribed).toBe(true);
    expect(gone!.lists).toContain("Fresh list");
  });

  it("counts addresses that already have a Divve account", async () => {
    await makeUser("member@example.com");
    const result = await svc.importContacts({ ...base, contacts: [{ email: "member@example.com" }, { email: "stranger@example.com" }] });
    expect(result.alreadyRegistered).toBe(1);
  });

  it("refuses an empty import, and one over the size limit", async () => {
    await expect(svc.importContacts({ ...base, contacts: [] })).rejects.toMatchObject({ status: 400, code: "NO_CONTACTS" });
    const tooMany = Array.from({ length: svc.MAX_IMPORT_ROWS + 1 }, (_, i) => ({ email: `u${i}@example.com` }));
    await expect(svc.importContacts({ ...base, contacts: tooMany })).rejects.toMatchObject({ status: 400, code: "TOO_MANY_CONTACTS" });
  });
});

describe("listSummaries / listContacts", () => {
  it("summarises each list with subscribed vs unsubscribed counts, plus the overall suppression list size", async () => {
    const base = { source: "s", attestedBy: attestedBy() };
    await svc.importContacts({ ...base, listName: "A", contacts: [{ email: "a1@example.com" }, { email: "a2@example.com" }, { email: "a3@example.com" }] });
    await svc.importContacts({ ...base, listName: "B", contacts: [{ email: "a1@example.com" }, { email: "b1@example.com" }] });
    await ExternalContact.updateOne({ email: "a2@example.com" }, { unsubscribed: true });

    const { lists, suppressedTotal } = await svc.listSummaries();
    expect(lists).toEqual([
      { name: "A", total: 3, subscribed: 2, unsubscribed: 1 },
      { name: "B", total: 2, subscribed: 2, unsubscribed: 0 },
    ]);
    expect(suppressedTotal).toBe(1);
  });

  it("pages through a list's contacts with masked emails", async () => {
    const contacts = Array.from({ length: 60 }, (_, i) => ({ email: `person${String(i).padStart(2, "0")}@example.com`, name: `Person ${i}` }));
    await svc.importContacts({ listName: "Big", source: "s", attestedBy: attestedBy(), contacts });
    const first = await svc.listContacts("Big", 1);
    expect(first.total).toBe(60);
    expect(first.contacts).toHaveLength(50);
    expect(first.contacts[0].email).toBe("p*******@example.com");
    expect(first.contacts[0].email).not.toContain("person00");
    const second = await svc.listContacts("Big", 2);
    expect(second.contacts).toHaveLength(10);
  });
});

describe("removeList", () => {
  const base = { source: "s", attestedBy: attestedBy() };

  it("deletes contacts only on this list, detaches those on other lists, and KEEPS unsubscribed ones as suppression records", async () => {
    await svc.importContacts({ ...base, listName: "Old", contacts: [{ email: "only@example.com" }, { email: "shared@example.com" }, { email: "optout@example.com" }] });
    await svc.importContacts({ ...base, listName: "Keep", contacts: [{ email: "shared@example.com" }] });
    await ExternalContact.updateOne({ email: "optout@example.com" }, { unsubscribed: true });

    const result = await svc.removeList("Old");
    expect(result).toEqual({ deleted: 1, detached: 2 });

    expect(await ExternalContact.findOne({ email: "only@example.com" })).toBeNull();
    expect((await ExternalContact.findOne({ email: "shared@example.com" }).lean())!.lists).toEqual(["Keep"]);
    const optout = await ExternalContact.findOne({ email: "optout@example.com" }).lean();
    expect(optout).toBeTruthy();
    expect(optout!.unsubscribed).toBe(true);
    expect(optout!.lists).toEqual([]);
  });

  it("refuses to remove a list a not-yet-sent campaign still uses", async () => {
    await svc.importContacts({ ...base, listName: "Busy", contacts: [{ email: "x@example.com" }] });
    await NotificationCampaign.create({ name: "Uses Busy", inlineContent: { subject: "S", bodyMarkdown: "B" }, categoryKey: "marketing", channels: ["email"], audience: "external", externalListKey: "Busy", status: "draft", createdBy: new Types.ObjectId() });
    await expect(svc.removeList("Busy")).rejects.toMatchObject({ status: 400, code: "LIST_IN_USE" });
    expect(await ExternalContact.countDocuments({ email: "x@example.com" })).toBe(1);

    await NotificationCampaign.updateMany({ externalListKey: "Busy" }, { status: "sent" });
    await expect(svc.removeList("Busy")).resolves.toMatchObject({ deleted: 1 });
  });
});

describe("resolveExternalRecipients — who a campaign to a list actually reaches", () => {
  const base = { source: "s", attestedBy: attestedBy() };

  it("includes subscribed contacts, and skips those who already have a Divve account or have unsubscribed", async () => {
    await makeUser("member@example.com");
    await svc.importContacts({ ...base, listName: "L", contacts: [{ email: "yes1@example.com", name: "Yes One" }, { email: "yes2@example.com" }, { email: "member@example.com" }, { email: "optout@example.com" }] });
    await ExternalContact.updateOne({ email: "optout@example.com" }, { unsubscribed: true });

    const r = await svc.resolveExternalRecipients("L");
    expect(r.recipients.map((c) => c.email)).toEqual(["yes1@example.com", "yes2@example.com"]);
    expect(r.skippedRegistered).toBe(1);
    expect(r.skippedUnsubscribed).toBe(1);
  });

  it("matches a registered user's email regardless of the case it was imported in", async () => {
    await makeUser("mixed@example.com");
    await svc.importContacts({ ...base, listName: "L", contacts: [{ email: "MIXED@Example.com" }] });
    const r = await svc.resolveExternalRecipients("L");
    expect(r.recipients).toHaveLength(0);
    expect(r.skippedRegistered).toBe(1);
  });

  it("only includes contacts on the requested list", async () => {
    await svc.importContacts({ ...base, listName: "One", contacts: [{ email: "a@example.com" }] });
    await svc.importContacts({ ...base, listName: "Two", contacts: [{ email: "b@example.com" }] });
    expect((await svc.resolveExternalRecipients("One")).recipients.map((c) => c.email)).toEqual(["a@example.com"]);
    expect((await svc.resolveExternalRecipients("Nope")).recipients).toEqual([]);
  });

  it("refuses a list with more deliverable contacts than one send can safely handle", async () => {
    const now = new Date();
    const docs = Array.from({ length: svc.MAX_EXTERNAL_RECIPIENTS + 1 }, (_, i) => ({
      email: `bulk${i}@example.com`, lists: ["Huge"], source: "s", unsubscribed: false, consentAttestedBy: new Types.ObjectId(), consentAttestedAt: now, lastImportedAt: now,
    }));
    await ExternalContact.insertMany(docs);
    await expect(svc.resolveExternalRecipients("Huge")).rejects.toMatchObject({ status: 400, code: "EXTERNAL_LIST_TOO_LARGE" });
  });
});

describe("assertExternalConfig", () => {
  it("passes non-external campaigns straight through", () => {
    expect(() => svc.assertExternalConfig({ audience: "all", channels: ["in_app", "popup"] })).not.toThrow();
  });

  it("requires a list, and email as the ONLY channel", () => {
    expect(() => svc.assertExternalConfig({ audience: "external", channels: ["email"] })).toThrow(/Choose which email list/);
    expect(() => svc.assertExternalConfig({ audience: "external", externalListKey: "L", channels: ["email", "in_app"] })).toThrow(/only be sent by email/);
    expect(() => svc.assertExternalConfig({ audience: "external", externalListKey: "L", channels: ["popup"] })).toThrow(/only be sent by email/);
    expect(() => svc.assertExternalConfig({ audience: "external", externalListKey: "L", channels: ["email"] })).not.toThrow();
  });
});

describe("previewExternalAudience", () => {
  it("returns the deliverable count, a masked sample, and what was skipped", async () => {
    await makeUser("member@example.com");
    await svc.importContacts({ listName: "P", source: "s", attestedBy: attestedBy(), contacts: [{ email: "ada@example.com", name: "Ada" }, { email: "nameless@example.com" }, { email: "member@example.com" }] });
    const p = await svc.previewExternalAudience("P");
    expect(p.count).toBe(2);
    expect(p.skippedRegistered).toBe(1);
    expect(p.sample).toEqual([
      { name: "Ada", email: "a**@example.com" },
      { name: "(no name)", email: "n*******@example.com" },
    ]);
  });
});
