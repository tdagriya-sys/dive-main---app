import { NotificationCategory } from "../models/NotificationCategory";
import { env } from "../config/env";
import { EmailSender } from "./notificationEmailService";
import { assertMarketingSenderReady, getMarketingSender, marketingSenderStatus } from "./externalContactService";

/**
 * Which address a campaign's EMAILS go out from — the one rule shared by send,
 * schedule, test-send and the admin screen that shows it.
 *
 *  - an email-list campaign (people who aren't on Divve) → always the marketing address;
 *  - a campaign whose category has `emailSender: "marketing"` → the marketing address;
 *  - everything else → the normal no-reply address (`EMAIL_FROM`, the same one
 *    that sends sign-in codes), which is what an `undefined` sender means to
 *    the email functions.
 *
 * A marketing-sender campaign with no usable marketing address (unset, or the
 * same address as no-reply) REFUSES to send — it never falls back to no-reply,
 * because that would put promotional spam complaints on the sign-in address.
 * A campaign with no email channel needs no sender and is never blocked.
 */

interface SenderSubject {
  audience: string;
  categoryKey: string;
  channels: string[];
}

export type CampaignSenderKind = "system" | "marketing";

// null when the campaign doesn't send email at all.
export async function campaignSenderKind(campaign: SenderSubject): Promise<CampaignSenderKind | null> {
  if (!campaign.channels.includes("email")) return null;
  if (campaign.audience === "external") return "marketing";
  const category = await NotificationCategory.findOne({ key: campaign.categoryKey }).select("emailSender").lean();
  return category?.emailSender === "marketing" ? "marketing" : "system";
}

// The sender to hand to the email functions (undefined = the no-reply default).
// Throws MARKETING_SENDER_NOT_READY when a marketing send has nowhere to go from.
export async function resolveCampaignSender(campaign: SenderSubject): Promise<EmailSender | undefined> {
  if ((await campaignSenderKind(campaign)) !== "marketing") return undefined;
  assertMarketingSenderReady();
  return getMarketingSender();
}

export interface CampaignSenderInfo {
  sendsEmail: boolean;
  kind: CampaignSenderKind | null;
  from: string | null;
  replyTo: string | null;
  ready: boolean;
  problem: string | null;
}

// What the admin screen shows before sending: which address, and whether it can go.
export async function describeCampaignSender(campaign: SenderSubject): Promise<CampaignSenderInfo> {
  const kind = await campaignSenderKind(campaign);
  if (kind === null) return { sendsEmail: false, kind, from: null, replyTo: null, ready: true, problem: null };
  if (kind === "system") return { sendsEmail: true, kind, from: env.emailFrom || null, replyTo: null, ready: true, problem: null };
  return { sendsEmail: true, kind, ...marketingSenderStatus() };
}
