import crypto from "crypto";
import { env } from "../config/env";
import { ExternalContact } from "../models/ExternalContact";
import { maskEmail } from "./notificationAudienceService";

/**
 * Unsubscribe for imported (non-user) marketing contacts. The link in every
 * email carries a signed, non-expiring token — an unsubscribe link has to keep
 * working indefinitely — that names exactly one contact and can be neither
 * forged nor used for anything else (the HMAC key is derived from the JWT
 * secret with a purpose suffix, so it can't collide with any other token).
 */

function mac(contactId: string): string {
  return crypto.createHmac("sha256", `${env.jwtAccessSecret}:external-unsubscribe`).update(contactId).digest("base64url").slice(0, 32);
}

export function signUnsubscribeToken(contactId: string): string {
  return `${contactId}.${mac(contactId)}`;
}

// Returns the contact id the token names, or null if it's malformed/forged.
export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [id, given] = parts;
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  const expected = Buffer.from(mac(id));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return id;
}

export function publicApiBase(): string {
  if (env.publicApiUrl) return env.publicApiUrl;
  if (env.nodeEnv === "production") return `${env.corsOrigins[0].replace(/\/+$/, "")}/api`;
  return `http://localhost:${env.port}/api`;
}

export function buildUnsubscribeUrl(contactId: string): string {
  return `${publicApiBase()}/unsubscribe/${signUnsubscribeToken(contactId)}`;
}

// What the confirm page shows (masked — the page is reachable by anyone
// holding the link, e.g. a forwarded email).
export async function lookupForConfirmation(contactId: string): Promise<{ email: string; alreadyUnsubscribed: boolean } | null> {
  const contact = await ExternalContact.findById(contactId).select("email unsubscribed").lean();
  if (!contact) return null;
  return { email: maskEmail(contact.email), alreadyUnsubscribed: contact.unsubscribed };
}

// Idempotent. Returns false only when the contact no longer exists at all
// (nothing left to mail, so that's effectively success for the person).
export async function unsubscribeContact(contactId: string): Promise<boolean> {
  const result = await ExternalContact.updateOne({ _id: contactId, unsubscribed: { $ne: true } }, { $set: { unsubscribed: true, unsubscribedAt: new Date() } });
  if (result.matchedCount > 0) return true;
  return Boolean(await ExternalContact.exists({ _id: contactId }));
}
