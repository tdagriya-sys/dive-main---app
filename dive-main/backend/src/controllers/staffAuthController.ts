import { Request, Response } from "express";
import { User } from "../models/User";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { totpConfirmSchema, totpVerifySchema, stepUpSchema } from "../validators/staffAuth";
import { acceptStaffInviteSchema } from "../validators/staffInvite";
import { getInvitePreview, acceptStaffInvite } from "../services/staffInviteService";
import {
  generateTotpSecret,
  buildOtpauthUrl,
  generateQrDataUrl,
  verifyTotpCode,
  generateRecoveryCodes,
  findMatchingRecoveryCodeIndex,
} from "../services/totpService";
import { signStaffAccessToken, signStepUpToken } from "../utils/jwt";
import { issueRefreshToken } from "../services/refreshTokenService";
import { publicUser } from "../utils/publicUser";
import { recordAudit } from "../services/auditLog";
import bcrypt from "bcryptjs";

/**
 * The staff 2FA endpoints (Phase 0.3 of docs/ADMIN_PANEL_PLAN.md). Every
 * handler here runs behind requireStaffPending (middleware/auth.ts) — the
 * caller has already passed a password check (authController.ts's login())
 * but does NOT have a real access token yet.
 */

async function loadPendingStaffUser(userId: string | undefined) {
  const user = userId ? await User.findById(userId) : null;
  if (!user || !user.staffRole) {
    throw new ApiError(403, "FORBIDDEN", "Staff access required.");
  }
  if (user.status !== "active") {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This staff account is not active.");
  }
  return user;
}

// Step 1 of first-time enrolment: generates (or re-returns, if setup was
// started but never confirmed) a TOTP secret and its QR code. Safe to call
// again before confirm() — it does NOT enable 2FA by itself.
export async function totpSetup(req: AuthedRequest, res: Response) {
  const user = await loadPendingStaffUser(req.userId);
  if (user.staffMeta.totpEnabled) {
    throw new ApiError(400, "ALREADY_ENROLLED", "Two-factor authentication is already set up for this account — enter your code instead.");
  }
  if (!user.staffMeta.totpSecret) {
    user.staffMeta.totpSecret = generateTotpSecret();
    await user.save();
  }
  const otpauthUrl = buildOtpauthUrl(user.staffMeta.totpSecret, user.email);
  const qrDataUrl = await generateQrDataUrl(otpauthUrl);
  return res.status(200).json({ otpauthUrl, qrDataUrl, secret: user.staffMeta.totpSecret });
}

// Step 2: confirms the code the staff member's authenticator app is now
// producing matches the secret from setup(), turns 2FA on, issues one-time
// recovery codes (shown ONCE — only their bcrypt hashes are ever stored), and
// completes the login (real access/refresh tokens), since password + a valid
// TOTP code together are exactly what a normal login proves in one step.
export async function totpConfirm(req: AuthedRequest, res: Response) {
  const { code } = totpConfirmSchema.parse(req.body);
  const user = await loadPendingStaffUser(req.userId);
  if (user.staffMeta.totpEnabled) {
    throw new ApiError(400, "ALREADY_ENROLLED", "Two-factor authentication is already set up for this account — enter your code instead.");
  }
  if (!user.staffMeta.totpSecret) {
    throw new ApiError(400, "SETUP_NOT_STARTED", "Start two-factor setup first.");
  }
  if (!verifyTotpCode(user.staffMeta.totpSecret, code)) {
    throw new ApiError(400, "INVALID_CODE", "That code is incorrect or has expired.");
  }

  const { plaintext, hashes } = await generateRecoveryCodes();
  user.staffMeta.totpEnabled = true;
  user.staffMeta.totpEnrolledAt = new Date();
  user.staffMeta.recoveryCodeHashes = hashes;
  user.staffMeta.lastAdminLoginAt = new Date();
  await user.save();

  await recordAudit(
    { action: "staff.totp_enrolled", resourceType: "User", resourceId: String(user._id) },
    { actorId: String(user._id), actorRole: user.staffRole ?? undefined, actorLabel: user.email },
    req
  );

  const accessToken = signStaffAccessToken(user._id.toString());
  await issueRefreshToken(res, user._id.toString());

  return res.status(200).json({ accessToken, user: publicUser(user), recoveryCodes: plaintext });
}

// Regular sign-in's second step, once 2FA is already enrolled. Accepts
// either a fresh TOTP code or a one-time recovery code as a fallback (e.g. a
// lost phone) — a used recovery code is immediately removed.
export async function totpVerify(req: AuthedRequest, res: Response) {
  const { code } = totpVerifySchema.parse(req.body);
  const user = await loadPendingStaffUser(req.userId);
  if (!user.staffMeta.totpEnabled || !user.staffMeta.totpSecret) {
    throw new ApiError(400, "NOT_ENROLLED", "Two-factor authentication isn't set up for this account yet.");
  }

  let usedRecovery = false;
  let ok = verifyTotpCode(user.staffMeta.totpSecret, code);
  if (!ok) {
    const idx = await findMatchingRecoveryCodeIndex(user.staffMeta.recoveryCodeHashes, code);
    if (idx >= 0) {
      ok = true;
      usedRecovery = true;
      user.staffMeta.recoveryCodeHashes.splice(idx, 1);
    }
  }
  if (!ok) {
    throw new ApiError(401, "INVALID_CODE", "That code is incorrect or has expired.");
  }

  user.staffMeta.lastAdminLoginAt = new Date();
  await user.save();

  await recordAudit(
    { action: usedRecovery ? "staff.login_via_recovery_code" : "staff.login", resourceType: "User", resourceId: String(user._id) },
    { actorId: String(user._id), actorRole: user.staffRole ?? undefined, actorLabel: user.email },
    req
  );

  const accessToken = signStaffAccessToken(user._id.toString());
  await issueRefreshToken(res, user._id.toString());

  return res.status(200).json({
    accessToken,
    user: publicUser(user),
    ...(usedRecovery ? { recoveryCodeUsed: true, recoveryCodesRemaining: user.staffMeta.recoveryCodeHashes.length } : {}),
  });
}

// Issues a short-lived step-up token (see middleware/auth.ts's requireStepUp)
// — re-confirms the CURRENT password of an already-logged-in staff member,
// required before a sensitive action (impersonate, publish a scoring config,
// refund, delete a user, manage roles/employees). Runs behind requireAuth +
// requireStaff (a real session), not requireStaffPending.
export async function stepUp(req: AuthedRequest, res: Response) {
  const { password } = stepUpSchema.parse(req.body);
  const user = req.userId ? await User.findById(req.userId) : null;
  if (!user || !user.staffRole) {
    throw new ApiError(403, "FORBIDDEN", "Staff access required.");
  }
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect password.");
  }
  const stepUpToken = signStepUpToken(user._id.toString());
  return res.status(200).json({ stepUpToken });
}

// Public — lets the accept-invite screen show "you're joining as Employee,
// email@example.com" BEFORE the person fills in the rest of the form,
// without exposing anything beyond what the invite itself already names.
export async function getInviteInfo(req: Request, res: Response) {
  const preview = await getInvitePreview(String(req.params.token));
  if (!preview) {
    throw new ApiError(404, "INVALID_INVITE", "This invite link is invalid or has expired.");
  }
  return res.status(200).json(preview);
}

// Public — the only way (other than the one-time createSuperadmin.ts
// bootstrap script) a new staff account gets created. Deliberately does NOT
// log the new account in or issue any tokens: TOTP enrolment is mandatory
// for every staff account, and forcing a normal login right after account
// creation reuses the exact same, already-tested pending-token → totp/setup
// path every other staff account goes through, rather than a second one.
export async function acceptInvite(req: Request, res: Response) {
  const data = acceptStaffInviteSchema.parse(req.body);
  const user = await acceptStaffInvite(data);
  return res.status(201).json({ message: "Account created. Please log in to finish setting up two-factor authentication.", email: user.email });
}
