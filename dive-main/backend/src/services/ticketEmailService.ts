import axios from "axios";
import { env } from "../config/env";

/**
 * Outbound ticket-notification email (Phase 4 of docs/ADMIN_PANEL_PLAN.md
 * §4.4/§5.4) — mirrors otpService.ts's/staffInviteService.ts's
 * sendViaResend/dev-mode-fallback shape exactly. Unlike the invite email,
 * nothing here is acceptance-critical (a failed send just means the
 * requester finds out via "My tickets" instead of their inbox), so the
 * caller never needs a dev-preview value back — this only ever logs.
 */

async function sendViaResend(email: string, subject: string, html: string, tag: string): Promise<boolean> {
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails",
      { from: env.emailFrom, to: [email], subject, html, ...(env.supportReplyTo ? { reply_to: env.supportReplyTo } : {}) },
      { headers: { Authorization: `Bearer ${env.emailApiKey}`, "Content-Type": "application/json" }, timeout: 8000 }
    );
    if (!data?.id) {
      // eslint-disable-next-line no-console
      console.error(`[ticketEmailService] Resend returned an unexpected response (${tag}): ${JSON.stringify(data)}`);
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ticketEmailService] Resend send failed (${tag}):`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function deliver(email: string, subject: string, html: string, tag: string): Promise<void> {
  if (env.emailApiKeyIsPlaceholder) {
    // eslint-disable-next-line no-console
    console.log(`[ticketEmailService] DEV MODE — ${tag} email to ${email} not sent (no real provider configured)`);
    return;
  }
  await sendViaResend(email, subject, html, tag);
}

export async function sendTicketCreatedEmail(email: string, refNo: string, subject: string): Promise<void> {
  await deliver(
    email,
    `We've got your message — ${refNo}`,
    `<p>Thanks for reaching out. Your ticket <b>${refNo}</b> — "${subject}" — has been created and a member of our team will get back to you soon.</p>`,
    "ticket_created"
  );
}

export async function sendTicketReplyEmail(email: string, refNo: string, replyBody: string): Promise<void> {
  await deliver(
    email,
    `New reply on your ticket ${refNo}`,
    `<p>Our team replied to your ticket <b>${refNo}</b>:</p><blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333;">${replyBody}</blockquote><p>Reply from inside the app to continue the conversation.${env.supportReplyTo ? " You can also reply to this email and it will reach our support team." : ""}</p>`,
    "ticket_reply"
  );
}
