import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env";

/**
 * TOTP two-factor auth for staff accounts (Phase 0.3 of
 * docs/ADMIN_PANEL_PLAN.md — "mandatory TOTP for every staff role"). Wraps
 * `otplib` + `qrcode` behind this app's own vocabulary so the rest of the
 * codebase never touches either library directly.
 *
 * `window: 1` tolerates one 30s step of clock drift on either side (±30s) —
 * enough for a phone's clock to be slightly off without meaningfully weakening
 * the code's ~30-90s effective lifetime.
 */
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

// otpauth:// URI an authenticator app scans (via the QR code below) or a user
// can paste in manually. `label` is the account identifier shown in the app
// (this staff member's email) — issuer is env.totpIssuer so multiple Divve
// environments (staging vs prod) are visually distinguishable in the app.
export function buildOtpauthUrl(secret: string, label: string): string {
  return authenticator.keyuri(label, env.totpIssuer, secret);
}

export async function generateQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code.trim())) return false;
  try {
    return authenticator.check(code.trim(), secret);
  } catch {
    return false;
  }
}

const RECOVERY_CODE_COUNT = 8;

// "XXXX-XXXX" of unambiguous uppercase base32-ish characters (no 0/O/1/I) —
// shown to the staff member exactly once at enrolment; only the bcrypt hashes
// are ever persisted (User.staffMeta.recoveryCodeHashes), same convention as
// passwordHash.
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomRecoveryCode(): string {
  const chars = Array.from({ length: 8 }, () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export interface RecoveryCodeSet {
  plaintext: string[]; // return to the client ONCE, never store
  hashes: string[]; // persist these
}

export async function generateRecoveryCodes(): Promise<RecoveryCodeSet> {
  const plaintext = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  const hashes = await Promise.all(plaintext.map((code) => bcrypt.hash(code, 10)));
  return { plaintext, hashes };
}

// Checks `code` against every stored hash and returns the matched hash's
// index (so the caller can splice it out — one-time use), or -1 if none
// matched. Sequential bcrypt.compare calls are fine at this scale (at most
// RECOVERY_CODE_COUNT hashes per staff account).
export async function findMatchingRecoveryCodeIndex(hashes: string[], code: string): Promise<number> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(normalized, hashes[i])) return i;
  }
  return -1;
}

// Test-only escape hatch: produces a currently-valid code for a known secret,
// used so tests never need to depend on wall-clock timing to pass.
export function _generateCurrentCodeForTests(secret: string): string {
  return authenticator.generate(secret);
}
