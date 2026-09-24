import crypto from "crypto";
import axios from "axios";
import bcrypt from "bcryptjs";
import { StaffInvite, IStaffInvite } from "../models/StaffInvite";
import { Role } from "../models/Role";
import { User, IUser } from "../models/User";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";

/**
 * Staff invite lifecycle (Phase 3 of docs/ADMIN_PANEL_PLAN.md) — the only way
 * a NEW superadmin/admin/employee account gets created, other than the
 * one-time `createSuperadmin.ts` bootstrap script (see that script's own
 * comment, which names this exact flow as the intended next step).
 */

const INVITE_TTL_DAYS = 7;

// A raw invite token is 256 bits of true randomness — unlike a password or a
// 6-digit OTP, guessing it is already computationally infeasible regardless
// of how fast the STORED form can be compared. bcrypt's deliberate slowness
// exists to blunt brute-forcing a LOW-entropy secret; applying it here would
// only add latency for no real security gain, so a plain SHA-256 digest is
// used instead — same reasoning `otpService.ts`/passwords don't share.
function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface CreateStaffInviteInput {
  email: string;
  staffRole: "superadmin" | "admin" | "employee";
  roleId?: string;
  invitedBy: string;
}

export async function createStaffInvite(input: CreateStaffInviteInput): Promise<{ invite: IStaffInvite; rawToken: string }> {
  const email = input.email.trim().toLowerCase();

  const existingStaff = await User.findOne({ email, staffRole: { $ne: null } }).lean();
  if (existingStaff) {
    throw new ApiError(409, "ALREADY_STAFF", "This email already belongs to a staff account.");
  }

  if (input.staffRole === "employee") {
    if (!input.roleId) throw new ApiError(400, "ROLE_REQUIRED", "A role is required when inviting an employee.");
    const role = await Role.findById(input.roleId).lean();
    if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "The selected role doesn't exist.");
  }

  // Superseding rather than stacking: an admin re-inviting the same email
  // (e.g. the first invite expired, or the intended role changed) shouldn't
  // leave two simultaneously-valid tokens for one email address.
  await StaffInvite.updateMany({ email, status: "pending" }, { status: "revoked" });

  const rawToken = generateInviteToken();
  const invite = await StaffInvite.create({
    email,
    staffRole: input.staffRole,
    roleId: input.staffRole === "employee" ? input.roleId : undefined,
    tokenHash: hashInviteToken(rawToken),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    status: "pending",
    invitedBy: input.invitedBy,
  });

  return { invite, rawToken };
}

interface InviteEmailResult {
  delivered: boolean;
  devInviteLink?: string; // DEV ONLY — only set when no real provider is configured
}

// Mirrors otpService.ts's sendViaResend/deliver shape exactly — see that
// file's own comments for the dev-mode-fallback reasoning, unchanged here.
async function sendViaResend(email: string, inviteLink: string, staffRoleLabel: string): Promise<boolean> {
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails",
      {
        from: env.emailFrom,
        to: [email],
        subject: "You've been invited to the Divve admin panel",
        html: `<p>You've been invited to join Divve's admin panel as <b>${staffRoleLabel}</b>.</p><p><a href="${inviteLink}">Click here to accept and set up your account</a>.</p><p>This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can safely ignore this email.</p>`,
      },
      { headers: { Authorization: `Bearer ${env.emailApiKey}`, "Content-Type": "application/json" }, timeout: 8000 }
    );
    if (!data?.id) {
      // eslint-disable-next-line no-console
      console.error(`[staffInviteService] Resend returned an unexpected response: ${JSON.stringify(data)}`);
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[staffInviteService] Resend send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function buildInviteLink(rawToken: string): string {
  return `${env.corsOrigins[0]}/admin/accept-invite?token=${rawToken}`;
}

export async function sendStaffInviteEmail(email: string, rawToken: string, staffRoleLabel: string): Promise<InviteEmailResult> {
  const inviteLink = buildInviteLink(rawToken);

  if (env.emailApiKeyIsPlaceholder) {
    // eslint-disable-next-line no-console
    console.log(`[staffInviteService] DEV MODE — invite link for ${email}: ${inviteLink}`);
    return { delivered: true, devInviteLink: inviteLink };
  }

  const delivered = await sendViaResend(email, inviteLink, staffRoleLabel);
  if (!delivered && env.nodeEnv !== "production") {
    // eslint-disable-next-line no-console
    console.log(`[staffInviteService] FALLBACK (non-prod only) — real email delivery failed, invite link for ${email}: ${inviteLink}`);
    return { delivered: true, devInviteLink: inviteLink };
  }
  return { delivered };
}

export async function getInvitePreview(rawToken: string): Promise<{ email: string; staffRole: string } | null> {
  const invite = await StaffInvite.findOne({ tokenHash: hashInviteToken(rawToken), status: "pending" }).lean();
  if (!invite || invite.expiresAt.getTime() < Date.now()) return null;
  return { email: invite.email, staffRole: invite.staffRole };
}

export interface AcceptStaffInviteInput {
  token: string;
  name: string;
  mobile: string;
  age: number;
  password: string;
}

export async function acceptStaffInvite(input: AcceptStaffInviteInput): Promise<IUser> {
  const invite = await StaffInvite.findOne({ tokenHash: hashInviteToken(input.token), status: "pending" });
  if (!invite || invite.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "INVALID_INVITE", "This invite link is invalid or has expired.");
  }

  const mobile = input.mobile.replace(/^\+91/, "").replace(/^0/, "");
  const existing = await User.findOne({ $or: [{ mobile }, { email: invite.email }] }).lean();
  if (existing) {
    throw new ApiError(409, "USER_EXISTS", "An account with this mobile or email already exists.");
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await User.create({
    name: input.name,
    mobile,
    email: invite.email,
    age: input.age,
    passwordHash,
    staffRole: invite.staffRole,
    roleId: invite.roleId,
    status: "active",
    staffMeta: { invitedBy: invite.invitedBy, invitedAt: invite.createdAt, acceptedAt: new Date(), totpEnabled: false, recoveryCodeHashes: [] },
  });

  invite.status = "accepted";
  invite.acceptedUserId = user._id;
  await invite.save();

  return user;
}

export async function revokeStaffInvite(inviteId: string): Promise<IStaffInvite> {
  const invite = await StaffInvite.findById(inviteId);
  if (!invite) throw new ApiError(404, "INVITE_NOT_FOUND", "Invite not found.");
  if (invite.status !== "pending") throw new ApiError(400, "NOT_PENDING", "Only a pending invite can be revoked.");
  invite.status = "revoked";
  await invite.save();
  return invite;
}

// Never mutates the DB just to reflect an elapsed TTL — an expired invite is
// still stored as "pending" until someone revokes it or a new invite
// supersedes it; callers compute the display status live instead.
export function effectiveInviteStatus(invite: Pick<IStaffInvite, "status" | "expiresAt">): StaffInviteDisplayStatus {
  if (invite.status === "pending" && invite.expiresAt.getTime() < Date.now()) return "expired";
  return invite.status;
}
export type StaffInviteDisplayStatus = "pending" | "accepted" | "revoked" | "expired";

export async function listPendingInvites() {
  const invites = await StaffInvite.find({ status: "pending" }).sort({ createdAt: -1 }).lean();
  return invites.map((i) => ({
    id: String(i._id),
    email: i.email,
    staffRole: i.staffRole,
    roleId: i.roleId ? String(i.roleId) : undefined,
    status: effectiveInviteStatus(i),
    expiresAt: i.expiresAt,
    invitedBy: i.invitedBy,
    createdAt: i.createdAt,
  }));
}
