import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { StaffInvite } from "../src/models/StaffInvite";
import {
  createStaffInvite,
  acceptStaffInvite,
  revokeStaffInvite,
  getInvitePreview,
  listPendingInvites,
  effectiveInviteStatus,
} from "../src/services/staffInviteService";

// Phase 3 of docs/ADMIN_PANEL_PLAN.md — the staff invite lifecycle, in
// isolation from the HTTP/permission layer (covered separately in
// employeesRolesApi.test.ts).

async function makeSuperadmin() {
  return User.create({
    name: "Inviter", mobile: "9800000001", email: "inviter@example.com", age: 30,
    passwordHash: "x", staffRole: "superadmin", status: "active",
  });
}

describe("createStaffInvite", () => {
  it("creates a pending invite and returns a raw token distinct from the stored hash", async () => {
    const inviter = await makeSuperadmin();
    const { invite, rawToken } = await createStaffInvite({ email: "new-admin@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    expect(invite.status).toBe("pending");
    expect(invite.tokenHash).not.toBe(rawToken);
    expect(rawToken).toHaveLength(64); // 32 bytes, hex
  });

  it("requires a roleId when inviting an employee, and validates it exists", async () => {
    const inviter = await makeSuperadmin();
    await expect(createStaffInvite({ email: "e1@example.com", staffRole: "employee", invitedBy: String(inviter._id) })).rejects.toMatchObject({
      code: "ROLE_REQUIRED",
    });
    await expect(
      createStaffInvite({ email: "e1@example.com", staffRole: "employee", roleId: "000000000000000000000000", invitedBy: String(inviter._id) })
    ).rejects.toMatchObject({ code: "ROLE_NOT_FOUND" });
  });

  it("succeeds for an employee invite with a real roleId", async () => {
    const inviter = await makeSuperadmin();
    const role = await Role.create({ key: "support", label: "Support" });
    const { invite } = await createStaffInvite({ email: "e2@example.com", staffRole: "employee", roleId: String(role._id), invitedBy: String(inviter._id) });
    expect(String(invite.roleId)).toBe(String(role._id));
  });

  it("rejects inviting an email that already belongs to a staff account", async () => {
    const inviter = await makeSuperadmin();
    await expect(createStaffInvite({ email: "inviter@example.com", staffRole: "admin", invitedBy: String(inviter._id) })).rejects.toMatchObject({
      code: "ALREADY_STAFF",
    });
  });

  it("supersedes (revokes) an existing pending invite for the same email rather than stacking", async () => {
    const inviter = await makeSuperadmin();
    const first = await createStaffInvite({ email: "dup@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    const second = await createStaffInvite({ email: "dup@example.com", staffRole: "admin", invitedBy: String(inviter._id) });

    const firstReloaded = await StaffInvite.findById(first.invite._id).lean();
    expect(firstReloaded!.status).toBe("revoked");
    const secondReloaded = await StaffInvite.findById(second.invite._id).lean();
    expect(secondReloaded!.status).toBe("pending");
  });
});

describe("getInvitePreview / acceptStaffInvite", () => {
  it("returns null for an unknown or already-used token", async () => {
    expect(await getInvitePreview("not-a-real-token")).toBeNull();
  });

  it("previews a pending invite by its raw token", async () => {
    const inviter = await makeSuperadmin();
    const { rawToken } = await createStaffInvite({ email: "preview@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    expect(await getInvitePreview(rawToken)).toEqual({ email: "preview@example.com", staffRole: "admin" });
  });

  it("accepts a valid invite, creating a real staff User with the invited role", async () => {
    const inviter = await makeSuperadmin();
    const { rawToken } = await createStaffInvite({ email: "accept1@example.com", staffRole: "admin", invitedBy: String(inviter._id) });

    const user = await acceptStaffInvite({ token: rawToken, name: "New Admin", mobile: "9800000010", age: 28, password: "Passw0rd!" });
    expect(user.email).toBe("accept1@example.com");
    expect(user.staffRole).toBe("admin");
    expect(user.staffMeta.acceptedAt).toBeTruthy();
    expect(user.staffMeta.totpEnabled).toBe(false); // still forced through normal enrolment on first login

    const invite = await StaffInvite.findOne({ email: "accept1@example.com" }).lean();
    expect(invite!.status).toBe("accepted");
    expect(String(invite!.acceptedUserId)).toBe(String(user._id));
  });

  it("rejects an already-accepted or unknown token", async () => {
    const inviter = await makeSuperadmin();
    const { rawToken } = await createStaffInvite({ email: "accept2@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    await acceptStaffInvite({ token: rawToken, name: "A", mobile: "9800000011", age: 28, password: "Passw0rd!" });

    await expect(acceptStaffInvite({ token: rawToken, name: "A", mobile: "9800000012", age: 28, password: "Passw0rd!" })).rejects.toMatchObject({
      code: "INVALID_INVITE",
    });
  });

  it("rejects accepting with a mobile or email already in use", async () => {
    const inviter = await makeSuperadmin();
    const { rawToken } = await createStaffInvite({ email: "accept3@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    await expect(
      acceptStaffInvite({ token: rawToken, name: "A", mobile: inviter.mobile, age: 28, password: "Passw0rd!" })
    ).rejects.toMatchObject({ code: "USER_EXISTS" });
  });

  it("rejects an expired invite even with a correct token", async () => {
    const inviter = await makeSuperadmin();
    const { invite, rawToken } = await createStaffInvite({ email: "expired@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    invite.expiresAt = new Date(Date.now() - 1000);
    await invite.save();

    await expect(acceptStaffInvite({ token: rawToken, name: "A", mobile: "9800000013", age: 28, password: "Passw0rd!" })).rejects.toMatchObject({
      code: "INVALID_INVITE",
    });
  });
});

describe("revokeStaffInvite", () => {
  it("revokes a pending invite", async () => {
    const inviter = await makeSuperadmin();
    const { invite } = await createStaffInvite({ email: "revoke1@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    const revoked = await revokeStaffInvite(String(invite._id));
    expect(revoked.status).toBe("revoked");
  });

  it("refuses to revoke an already-accepted invite", async () => {
    const inviter = await makeSuperadmin();
    const { invite, rawToken } = await createStaffInvite({ email: "revoke2@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    await acceptStaffInvite({ token: rawToken, name: "A", mobile: "9800000014", age: 28, password: "Passw0rd!" });
    await expect(revokeStaffInvite(String(invite._id))).rejects.toMatchObject({ code: "NOT_PENDING" });
  });

  it("404s for an unknown invite id", async () => {
    await expect(revokeStaffInvite("000000000000000000000000")).rejects.toMatchObject({ code: "INVITE_NOT_FOUND" });
  });
});

describe("effectiveInviteStatus / listPendingInvites", () => {
  it("reports an expired pending invite as 'expired' without mutating the stored status", async () => {
    const inviter = await makeSuperadmin();
    const { invite } = await createStaffInvite({ email: "expired2@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    invite.expiresAt = new Date(Date.now() - 1000);
    await invite.save();

    expect(effectiveInviteStatus(invite)).toBe("expired");
    const reloaded = await StaffInvite.findById(invite._id).lean();
    expect(reloaded!.status).toBe("pending"); // untouched in the DB
  });

  it("lists only pending invites, newest first", async () => {
    const inviter = await makeSuperadmin();
    await createStaffInvite({ email: "list1@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    await createStaffInvite({ email: "list2@example.com", staffRole: "admin", invitedBy: String(inviter._id) });
    const list = await listPendingInvites();
    expect(list.map((i) => i.email)).toEqual(["list2@example.com", "list1@example.com"]);
  });
});
