import { User } from "../src/models/User";
import { AuditLog } from "../src/models/AuditLog";
import { RefreshToken } from "../src/models/RefreshToken";
import { promoteToSuperadmin } from "../src/scripts/createSuperadmin";
import bcrypt from "bcryptjs";

// Phase 0.3 of docs/ADMIN_PANEL_PLAN.md — the exported core of
// scripts/createSuperadmin.ts (the CLI wrapper itself is a thin argv-parsing
// shell around this, not separately tested).
describe("promoteToSuperadmin", () => {
  it("throws a clear error when no account exists with that email", async () => {
    await expect(promoteToSuperadmin("nobody@example.com")).rejects.toThrow(/No account found/);
  });

  it("promotes an existing account to superadmin, active, and audits it", async () => {
    const passwordHash = await bcrypt.hash("whatever", 10);
    const user = await User.create({
      name: "Founder",
      mobile: "9800000001",
      email: "Founder@Example.com", // deliberately mixed case — should still match
      age: 35,
      passwordHash,
    });

    const result = await promoteToSuperadmin("founder@example.com");
    expect(result.alreadyWasSuperadmin).toBe(false);
    expect(result.userId).toBe(String(user._id));

    const reloaded = await User.findById(user._id);
    expect(reloaded!.staffRole).toBe("superadmin");
    expect(reloaded!.status).toBe("active");
    // Doesn't touch TOTP enrolment — a fresh promotion starts unenrolled, so
    // the very next login forces setup.
    expect(reloaded!.staffMeta.totpEnabled).toBe(false);

    const audit = await AuditLog.findOne({ action: "staff.promoted_to_superadmin", resourceId: String(user._id) }).lean();
    expect(audit).toBeTruthy();
    expect(audit!.actorRole).toBe("system");
  });

  // Found live during Phase 5 verification: a browser tab left open as a
  // plain user, still holding a refresh token minted long before 2FA was
  // ever relevant, must not be able to silently ride that same session
  // straight into staff access post-promotion — see promoteToSuperadmin's
  // own comment on why requireStaff's "an access token already proves 2FA"
  // assumption breaks without this.
  it("revokes every pre-existing refresh token so an already-open session can't silently refresh into staff access", async () => {
    const passwordHash = await bcrypt.hash("whatever", 10);
    const user = await User.create({ name: "PreExisting", mobile: "9800000003", email: "preexisting@example.com", age: 35, passwordHash });
    const liveToken = await RefreshToken.create({ jti: "live-jti", userId: user._id, expiresAt: new Date(Date.now() + 60 * 60 * 1000), revokedAt: null });
    const alreadyRevoked = await RefreshToken.create({ jti: "already-revoked-jti", userId: user._id, expiresAt: new Date(Date.now() + 60 * 60 * 1000), revokedAt: new Date() });

    await promoteToSuperadmin("preexisting@example.com");

    const reloadedLive = await RefreshToken.findById(liveToken._id).lean();
    expect(reloadedLive?.revokedAt).toBeTruthy();
    const reloadedAlreadyRevoked = await RefreshToken.findById(alreadyRevoked._id).lean();
    expect(reloadedAlreadyRevoked?.revokedAt?.getTime()).toBe(alreadyRevoked.revokedAt?.getTime()); // untouched, not re-stamped
  });

  it("running it again on an already-superadmin account reports that, without disturbing existing TOTP enrolment", async () => {
    const passwordHash = await bcrypt.hash("whatever", 10);
    const user = await User.create({
      name: "Founder2",
      mobile: "9800000002",
      email: "founder2@example.com",
      age: 35,
      passwordHash,
      staffRole: "superadmin",
      staffMeta: { totpEnabled: true, totpSecret: "ABCDEFGH", recoveryCodeHashes: ["x"] },
    });

    const result = await promoteToSuperadmin("founder2@example.com");
    expect(result.alreadyWasSuperadmin).toBe(true);

    const reloaded = await User.findById(user._id);
    expect(reloaded!.staffMeta.totpEnabled).toBe(true);
    expect(reloaded!.staffMeta.recoveryCodeHashes).toEqual(["x"]);
  });
});
