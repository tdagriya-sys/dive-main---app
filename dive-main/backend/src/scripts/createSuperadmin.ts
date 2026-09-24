import { connectDb, disconnectDb } from "../db/connect";
import { User } from "../models/User";
import { RefreshToken } from "../models/RefreshToken";
import { recordAudit } from "../services/auditLog";

/**
 * One-time bootstrap for the very first superadmin (Phase 0.3 of
 * docs/ADMIN_PANEL_PLAN.md — see docs/ADMIN_PANEL_SETUP_GUIDE.md §1.4 for the
 * full walkthrough). Promotes an EXISTING normal Divve account (sign up
 * first, same as any other user) to `staffRole: "superadmin"`.
 *
 * Deliberately does not touch `staffMeta.totpEnabled` — a fresh promotion
 * starts at the schema default (`false`), which forces TOTP enrolment on the
 * very next login (authController.ts's `login()` returns `totpEnrolled: false`
 * for any staff account without it); re-running this against an account that
 * already has 2FA set up leaves that enrolment untouched.
 *
 * Revokes every existing refresh token for this account (found live, during
 * Phase 5 verification): `requireStaff` (middleware/auth.ts) trusts that "an
 * access token exists" already proves 2FA was satisfied, but that's only
 * true for tokens minted via the staff login+TOTP path. A refresh token
 * issued earlier — while this was still an ordinary account, with a browser
 * tab left open — predates that guarantee entirely; `POST /api/auth/refresh`
 * happily mints a fresh access token from it with no TOTP check of its own.
 * Left alone, that stale session would carry straight into full staff access
 * the next time it silently refreshes, 2FA never having been prompted at
 * all. Killing every refresh token here forces that next refresh to fail
 * and fall back to a real login, which does enforce it.
 */
export async function promoteToSuperadmin(email: string): Promise<{ userId: string; alreadyWasSuperadmin: boolean }> {
  const normalized = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalized });
  if (!user) {
    throw new Error(
      `No account found with email "${normalized}". Sign up for a normal Divve account with this email first, then run this script again.`
    );
  }

  const alreadyWasSuperadmin = user.staffRole === "superadmin";
  user.staffRole = "superadmin";
  user.status = "active";
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });

  await recordAudit(
    { action: "staff.promoted_to_superadmin", resourceType: "User", resourceId: String(user._id) },
    { actorRole: "system", actorLabel: "createSuperadmin.ts script" }
  );

  return { userId: String(user._id), alreadyWasSuperadmin };
}

// Allows `npx tsx src/scripts/createSuperadmin.ts --email you@example.com`.
if (require.main === module) {
  const emailArgIndex = process.argv.indexOf("--email");
  const email = emailArgIndex >= 0 ? process.argv[emailArgIndex + 1] : undefined;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error("Usage: npx tsx src/scripts/createSuperadmin.ts --email you@example.com");
    process.exit(1);
  } else {
    connectDb()
      .then(() => promoteToSuperadmin(email))
      .then(({ userId, alreadyWasSuperadmin }) => {
        // eslint-disable-next-line no-console
        console.log(
          alreadyWasSuperadmin
            ? `Account ${email} (${userId}) was already a superadmin.`
            : `Account ${email} (${userId}) promoted to superadmin. Log in normally in the app — you'll be prompted to set up two-factor authentication before you can enter the admin panel.`
        );
      })
      .then(() => disconnectDb())
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      });
  }
}
