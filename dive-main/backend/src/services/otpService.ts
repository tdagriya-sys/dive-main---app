import axios from "axios";
import bcrypt from "bcryptjs";
import { Otp, OtpPurpose } from "../models/Otp";
import { env } from "../config/env";

/**
 * Abstraction over OTP delivery. `deliver()` is the one place this app talks
 * to an email provider — swap the Resend call below for a different one
 * later without touching anything else. `identifier` (used for DB lookup/
 * verification) stays the user's mobile number throughout, unrelated to
 * `email`, which is only ever the delivery address.
 */
interface OtpDeliveryResult {
  delivered: boolean;
  devOtp?: string; // DEV ONLY — only set when no real provider is configured
}

// Resend's API (https://resend.com/docs/api-reference/emails/send-email) —
// no per-message approval/template needed (unlike SMS to Indian numbers,
// which requires DLT registration before anything can send at all), so this
// works the moment a real key is configured, no waiting period.
async function sendViaResend(email: string, code: string): Promise<boolean> {
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails",
      {
        from: env.emailFrom,
        to: [email],
        subject: "Your Divve verification code",
        html: `<p>Your Divve verification code is <b style="font-size:20px;letter-spacing:2px;">${code}</b>.</p><p>It expires in ${env.otpTtlMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>`,
      },
      {
        headers: { Authorization: `Bearer ${env.emailApiKey}`, "Content-Type": "application/json" },
        timeout: 8000,
      }
    );
    if (!data?.id) {
      // eslint-disable-next-line no-console
      console.error(`[otpService] Resend returned an unexpected response: ${JSON.stringify(data)}`);
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[otpService] Resend send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function deliver(identifier: string, code: string, email: string): Promise<OtpDeliveryResult> {
  if (env.emailApiKeyIsPlaceholder) {
    // DEV ONLY — no real email provider configured (EMAIL_API_KEY is a placeholder).
    // Logging + returning the code so the flow is testable without a real gateway.
    // eslint-disable-next-line no-console
    console.log(`[otpService] DEV MODE — OTP for ${identifier} (${email}): ${code}`);
    return { delivered: true, devOtp: code };
  }

  const delivered = await sendViaResend(email, code);
  if (!delivered && env.nodeEnv !== "production") {
    // Real delivery failed (bad key, Resend error, network issue) — fall back
    // to dev-mode visibility so testing isn't blocked on getting email fully
    // configured. Gated to non-production specifically: in production this
    // must be a hard failure surfaced to the user instead (see requestOtp's
    // caller), never a silent code-in-response fallback — that's exactly the
    // OTP-leak risk flagged in docs/PRODUCTION_READINESS_AUDIT.md.
    // eslint-disable-next-line no-console
    console.log(`[otpService] FALLBACK (non-prod only) — real email delivery failed, OTP for ${identifier}: ${code}`);
    return { delivered: true, devOtp: code };
  }
  return { delivered };
}

export async function requestOtp(identifier: string, purpose: OtpPurpose, email: string): Promise<OtpDeliveryResult> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

  await Otp.deleteMany({ identifier, purpose, verified: false });
  await Otp.create({ identifier, purpose, codeHash, expiresAt, verified: false, attempts: 0 });

  return deliver(identifier, code, email);
}

export async function verifyOtp(identifier: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const otp = await Otp.findOne({ identifier, purpose, verified: false }).sort({ createdAt: -1 });
  if (!otp) return false;
  if (otp.expiresAt.getTime() < Date.now()) return false;
  if (otp.attempts >= 5) return false;

  const matches = await bcrypt.compare(code, otp.codeHash);
  otp.attempts += 1;
  if (!matches) {
    await otp.save();
    return false;
  }
  otp.verified = true;
  await otp.save();
  return true;
}
