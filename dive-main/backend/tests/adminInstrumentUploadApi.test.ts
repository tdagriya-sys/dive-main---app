import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { Instrument } from "../src/models/Instrument";
import { AuditLog } from "../src/models/AuditLog";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// The admin instrument-upload API: gated by instruments.manage, accepts a CSV
// for exactly one asset class, and records what happened in the Audit Log.

const app = createApp();
let mobileCounter = 9350000000;
const nextMobile = () => String(mobileCounter++);

async function loginAsStaff(mobile: string, email: string, staffRole: "superadmin" | "admin" | "employee", roleId?: string) {
  const signup = { name: "Upload Admin", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  const userId = verify.body.user.id as string;
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  if (roleId) user.roleId = roleId as unknown as typeof user.roleId;
  await user.save();

  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  return { userId, accessToken: confirm.body.accessToken as string };
}

const csvBuf = (rows: string[]) => Buffer.from(rows.join("\n"), "utf-8");

describe("POST /api/admin/instruments/upload", () => {
  it("requires authentication and the instruments.manage permission", async () => {
    const noAuth = await request(app).post("/api/admin/instruments/upload").field("assetClass", "BOND").attach("file", csvBuf(["Name", "X"]), "b.csv");
    expect(noAuth.status).toBe(401);

    const role = await Role.create({ key: "no_instruments", label: "No instruments", permissions: ["users.view"] });
    const staff = await loginAsStaff(nextMobile(), "upload-noperm@example.com", "employee", String(role._id));
    const res = await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "BOND")
      .attach("file", csvBuf(["Name", "X"]), "b.csv");
    expect(res.status).toBe(403);
  });

  it("uploads a REIT file, returns a summary, and is visible via the normal instrument listing", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-reit@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "reit") // lowercase on purpose — should still work
      .attach("file", csvBuf(["Name,Exchange,Sector", "Embassy Office Parks REIT,NSE,Commercial Real Estate"]), "reits.csv");

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ assetClass: "REIT", fileName: "reits.csv", inserted: 1, updated: 0, deletedFromPrevious: 0 });

    const list = await request(app).get("/api/admin/instruments").query({ assetClass: "REIT" }).set("Authorization", `Bearer ${staff.accessToken}`);
    expect(list.body.instruments.map((i: { name: string }) => i.name)).toContain("Embassy Office Parks REIT");
  });

  it("rejects a missing file, a missing/invalid asset class, and a non-CSV file", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-validate@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const noFile = await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "BOND");
    expect(noFile.status).toBe(400);
    expect(noFile.body.error).toBe("NO_FILE");

    const noClass = await request(app).post("/api/admin/instruments/upload").set(auth).attach("file", csvBuf(["Name", "X"]), "x.csv");
    expect(noClass.status).toBe(400);
    expect(noClass.body.error).toBe("INVALID_ASSET_CLASS");

    const badClass = await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "NOT_REAL").attach("file", csvBuf(["Name", "X"]), "x.csv");
    expect(badClass.status).toBe(400);
    expect(badClass.body.error).toBe("INVALID_ASSET_CLASS");

    const wrongType = await request(app)
      .post("/api/admin/instruments/upload")
      .set(auth)
      .field("assetClass", "BOND")
      .attach("file", Buffer.from("not a spreadsheet"), { filename: "virus.exe", contentType: "application/x-msdownload" });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toBe("UNSUPPORTED_FILE_TYPE"); // same errorHandler.ts convention as the holdings-import upload
  });

  it("refuses a file with no usable row (a clear message, nothing written)", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-empty@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "BOND")
      .attach("file", csvBuf(["Name,Sector", ",Debt"]), "empty.csv");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NO_USABLE_ROWS");
  });

  it("by default, re-uploading for the same class UPSERTS — a previous instrument not in the new file is left in place, not deleted — while a different admin's other-class upload survives untouched", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-replace@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "INVIT").attach("file", csvBuf(["Name,Symbol", "Old InvIT,INVITA"]), "v1.csv");
    await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "ULIP_INSURANCE").attach("file", csvBuf(["Name", "Some ULIP"]), "ulip.csv");

    const v2 = await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "INVIT").attach("file", csvBuf(["Name,Symbol", "New InvIT,INVITB"]), "v2.csv");
    expect(v2.body.summary.deletedFromPrevious).toBe(0);
    expect(v2.body.summary.inserted).toBe(1);

    const invits = await Instrument.find({ assetClass: "INVIT" }).lean();
    expect(invits.map((i) => i.name).sort()).toEqual(["New InvIT", "Old InvIT"]); // both present — nothing deleted by default
    expect(await Instrument.countDocuments({ assetClass: "ULIP_INSURANCE" })).toBe(1); // untouched by the INVIT re-upload
  });

  it("with removeMissing=true, an instrument genuinely absent from the new file for that class is removed (retired if held, deleted if not)", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-removemissing@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    await request(app).post("/api/admin/instruments/upload").set(auth).field("assetClass", "INVIT").attach("file", csvBuf(["Name,Symbol", "Old InvIT,INVITA"]), "v1.csv");
    const v2 = await request(app)
      .post("/api/admin/instruments/upload")
      .set(auth)
      .field("assetClass", "INVIT")
      .field("removeMissing", "true")
      .attach("file", csvBuf(["Name,Symbol", "New InvIT,INVITB"]), "v2.csv");

    expect(v2.body.summary.removeMissingRequested).toBe(true);
    expect(v2.body.summary.deletedFromPrevious).toBe(1);
    const invits = await Instrument.find({ assetClass: "INVIT" }).lean();
    expect(invits.map((i) => i.name)).toEqual(["New InvIT"]);
  });

  it("records the upload in the Audit Log, without the row data itself", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-audit@example.com", "superadmin");
    await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "BOND")
      .attach("file", csvBuf(["Name,Sector", "Real Bond,Corporate", ",Bad Row"]), "bonds.csv");

    const entry = await AuditLog.findOne({ action: "instrument.uploaded" }).lean();
    expect(entry).toBeTruthy();
    expect(entry?.actorLabel).toBe("upload-audit@example.com");
    expect(entry?.meta).toMatchObject({ assetClass: "BOND", fileName: "bonds.csv", inserted: 1, skippedCount: 1 });
    expect(JSON.stringify(entry)).not.toContain("Real Bond");
  });

  it("row-level skip/warning details are returned in the response, so the admin sees exactly what happened", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-rowdetail@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "MUTUAL_FUND")
      .attach("file", csvBuf(["Name,NAV", "Good Fund,120", ",Missing Name", "Odd Fund,not-a-number"]), "mf.csv");

    expect(res.body.summary.inserted).toBe(2);
    expect(res.body.summary.skipped.some((s: { message: string }) => /No name/.test(s.message))).toBe(true);
    expect(res.body.summary.warnings.some((w: { message: string }) => /isn't a number/.test(w.message))).toBe(true);
  });

  it("a Mutual Fund upload with Underlying Holdings reports the Look-Through Model draft update in the response", async () => {
    const staff = await loginAsStaff(nextMobile(), "upload-lookthrough@example.com", "superadmin");
    const res = await request(app)
      .post("/api/admin/instruments/upload")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("assetClass", "MUTUAL_FUND")
      .attach("file", csvBuf(['Name,Symbol,Underlying Holdings', '"Some Flexi Fund",SCHEME1,"Reliance Industries:8.5;HDFC Bank:6.2"']), "mf.csv");

    expect(res.status).toBe(200);
    expect(res.body.summary.lookthrough).toMatchObject({ fundsUpdated: 1, fundsSkippedNoWeight: 0 });
  });
});
