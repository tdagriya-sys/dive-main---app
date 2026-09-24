import { Types } from "mongoose";
import { NotificationCampaign, INotificationCampaign, CampaignAudienceType } from "../models/NotificationCampaign";
import { NotificationTemplate } from "../models/NotificationTemplate";
import { UserNotification } from "../models/UserNotification";
import { ExternalDelivery } from "../models/ExternalDelivery";
import { User } from "../models/User";
import { ApiError } from "../middleware/errorHandler";
import { resolveAudienceUserIds, resolveDeliveryChannels } from "./notificationAudienceService";
import {
  renderVars,
  buildNotificationHtml,
  buildInAppNotificationHtml,
  sendNotificationEmail,
  sendNotificationEmailBatch,
  buildUnsubscribeFooterHtml,
  buildUnsubscribeHeaders,
  resolveButtonLink,
  EmailSender,
} from "./notificationEmailService";
import { assertExternalConfig, resolveExternalRecipients, ExternalRecipients } from "./externalContactService";
import { resolveCampaignSender } from "./campaignSenderService";
import { buildUnsubscribeUrl, publicApiBase } from "./unsubscribeService";
import { ICampaignSegmentQuery, ICampaignStats } from "../models/NotificationCampaign";
import { NotificationChannel, IHighlightStyle, INotificationCallout, INotificationButton } from "../models/NotificationCategory";

export interface CampaignContent {
  subject: string;
  bodyMarkdown: string;
  highlightStyle?: IHighlightStyle;
  callout?: INotificationCallout;
  button?: INotificationButton;
}

/**
 * The notification-campaign lifecycle (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5/§5.4). The plan's own §5.4 sketches a BullMQ job queue for sends —
 * deliberately not introduced here, same reasoning Phase 2's simulation
 * sandbox and every prior cron already settled on: no real multi-worker
 * need exists yet, and a straightforward synchronous send (bounded by
 * MAX_AUDIENCE_SIZE, see notificationAudienceService.ts) plus the existing
 * node-cron + distributed-lock pattern (jobs/notificationDispatch.cron.ts)
 * for scheduled sends covers this app's actual scale without new
 * infrastructure. Revisit if a real multi-instance deploy or a much larger
 * user base makes a synchronous send too slow for one HTTP request.
 */

export interface CreateCampaignInput {
  name: string;
  templateKey?: string;
  inlineContent?: CampaignContent;
  categoryKey: string;
  channels: NotificationChannel[];
  audience: CampaignAudienceType;
  segmentQuery?: ICampaignSegmentQuery;
  userIds?: string[];
  externalListKey?: string;
  createdBy: string;
}

export async function createCampaign(input: CreateCampaignInput): Promise<INotificationCampaign> {
  if (input.templateKey) {
    const template = await NotificationTemplate.findOne({ key: input.templateKey }).lean();
    if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "The selected template doesn't exist.");
  }
  assertExternalConfig(input);
  return NotificationCampaign.create({
    name: input.name,
    templateKey: input.templateKey,
    inlineContent: input.inlineContent,
    categoryKey: input.categoryKey,
    channels: input.channels,
    audience: input.audience,
    segmentQuery: input.segmentQuery,
    userIds: input.userIds?.map((id) => new Types.ObjectId(id)),
    externalListKey: input.audience === "external" ? input.externalListKey : undefined,
    status: "draft",
    createdBy: input.createdBy,
  });
}

export interface UpdateCampaignInput extends Partial<Omit<CreateCampaignInput, "createdBy" | "templateKey" | "inlineContent" | "externalListKey">> {
  templateKey?: string | null;
  inlineContent?: CampaignContent | null;
  externalListKey?: string | null;
}

export async function updateCampaign(campaignId: string, input: UpdateCampaignInput): Promise<INotificationCampaign> {
  const campaign = await NotificationCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  if (campaign.status !== "draft") throw new ApiError(400, "CAMPAIGN_NOT_DRAFT", "Only a draft campaign can be edited.");

  if (input.name !== undefined) campaign.name = input.name;
  if (input.templateKey !== undefined) campaign.templateKey = input.templateKey || undefined;
  if (input.inlineContent !== undefined) campaign.inlineContent = input.inlineContent || undefined;
  if (input.categoryKey !== undefined) campaign.categoryKey = input.categoryKey;
  if (input.channels !== undefined) campaign.channels = input.channels;
  if (input.audience !== undefined) campaign.audience = input.audience;
  if (input.segmentQuery !== undefined) campaign.segmentQuery = input.segmentQuery;
  if (input.userIds !== undefined) campaign.userIds = input.userIds.map((id) => new Types.ObjectId(id));
  if (input.externalListKey !== undefined) campaign.externalListKey = input.externalListKey || undefined;
  // Switching an audience AWAY from an email list must not leave a stale list
  // name behind.
  if (campaign.audience !== "external") campaign.externalListKey = undefined;
  assertExternalConfig(campaign);

  await campaign.save();
  return campaign;
}

function plainHighlightStyle(style?: IHighlightStyle): IHighlightStyle | undefined {
  if (!style) return undefined;
  return { color: style.color, gradientFrom: style.gradientFrom, gradientTo: style.gradientTo, fontWeight: style.fontWeight, fontStyle: style.fontStyle, fontSize: style.fontSize };
}

function plainCallout(callout?: INotificationCallout): INotificationCallout | undefined {
  if (!callout || (!callout.text?.trim() && !callout.imageUrl?.trim())) return undefined;
  return { text: callout.text, imageUrl: callout.imageUrl, linkUrl: callout.linkUrl, highlightStyle: plainHighlightStyle(callout.highlightStyle) };
}

function plainButton(button?: INotificationButton): INotificationButton | undefined {
  if (!button?.label?.trim() || !button.url?.trim()) return undefined;
  return { label: button.label, url: button.url };
}

// `campaign` here is frequently a LIVE Mongoose document (sendCampaignNow
// doesn't .lean() it, since it also needs to call campaign.save()), so
// campaign.inlineContent is a Mongoose subdocument. Its schema fields live
// on getters, not as the subdocument's own enumerable properties — spreading
// it directly (as callers of resolveContent do, to inject per-recipient
// {{name}}/{{email}} substitution) silently drops fields like callout.imageUrl.
// Reading each field explicitly here forces the getters and returns plain
// data that survives a later `{ ...callout }` spread intact.
export async function resolveContent(campaign: Pick<INotificationCampaign, "templateKey" | "inlineContent">): Promise<CampaignContent> {
  if (campaign.inlineContent) {
    const c = campaign.inlineContent;
    return { subject: c.subject, bodyMarkdown: c.bodyMarkdown, highlightStyle: plainHighlightStyle(c.highlightStyle), callout: plainCallout(c.callout), button: plainButton(c.button) };
  }
  if (campaign.templateKey) {
    const template = await NotificationTemplate.findOne({ key: campaign.templateKey }).lean();
    if (!template) throw new ApiError(400, "TEMPLATE_NOT_FOUND", "This campaign's template no longer exists.");
    return {
      subject: template.subject,
      bodyMarkdown: template.bodyMarkdown,
      highlightStyle: plainHighlightStyle(template.highlightStyle),
      callout: plainCallout(template.callout),
      button: plainButton(template.button),
    };
  }
  throw new ApiError(400, "NO_CONTENT", "This campaign has no content configured.");
}

// What a recipient would see, rendered with sample values — for the admin
// detail page's preview (drafts and sent campaigns alike). `content` is the
// snapshot taken at send time when there is one, so a sent campaign always
// previews exactly what went out even if its template has since changed.
export async function buildCampaignPreview(campaign: Pick<INotificationCampaign, "templateKey" | "inlineContent" | "sentContent">): Promise<{ content: CampaignContent; richHtml: string; inAppHtml: string; inAppLink?: { link: string; linkLabel: string } }> {
  const content = campaign.sentContent
    ? {
        subject: campaign.sentContent.subject,
        bodyMarkdown: campaign.sentContent.bodyMarkdown,
        highlightStyle: plainHighlightStyle(campaign.sentContent.highlightStyle),
        callout: plainCallout(campaign.sentContent.callout),
        button: plainButton(campaign.sentContent.button),
      }
    : await resolveContent(campaign);
  const vars = { name: "Recipient", email: "recipient@example.com" };
  const body = renderVars(content.bodyMarkdown, vars);
  const callout = content.callout?.text ? { ...content.callout, text: renderVars(content.callout.text, vars) } : content.callout;
  return {
    content,
    richHtml: buildNotificationHtml(body, { highlightStyle: content.highlightStyle, callout, button: content.button }),
    inAppHtml: buildInAppNotificationHtml(body),
    inAppLink: resolveButtonLink(content.button),
  };
}

export async function cancelCampaign(campaignId: string): Promise<INotificationCampaign> {
  const campaign = await NotificationCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  if (!["draft", "scheduled"].includes(campaign.status)) {
    throw new ApiError(400, "CANNOT_CANCEL", "Only a draft or scheduled campaign can be cancelled.");
  }
  campaign.status = "cancelled";
  await campaign.save();
  return campaign;
}

export async function scheduleCampaign(campaignId: string, scheduleAt: Date): Promise<INotificationCampaign> {
  const campaign = await NotificationCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  if (campaign.status !== "draft") throw new ApiError(400, "CAMPAIGN_NOT_DRAFT", "Only a draft campaign can be scheduled.");
  await resolveContent(campaign); // fail fast if the content is missing/invalid, before committing to a schedule
  assertExternalConfig(campaign);
  // Don't accept a schedule for a send that can't go out (a marketing-sender
  // campaign — email list or marketing category — with no marketing sender yet).
  await resolveCampaignSender(campaign);
  campaign.status = "scheduled";
  campaign.scheduleAt = scheduleAt;
  await campaign.save();
  return campaign;
}

const EXTERNAL_BATCH_SIZE = 100;

// The email-list send: personalized per person, ~100 emails per provider call,
// one `ExternalDelivery` record per address. `{{name}}` falls back to "there"
// for a contact with no name ("Hi there,"), so a message never reads "Hi ,".
// Every email carries its own signed unsubscribe link (footer + the
// List-Unsubscribe headers Gmail/Yahoo/Outlook use for their native button).
async function deliverToExternalContacts(campaign: INotificationCampaign, content: CampaignContent, resolved: ExternalRecipients, sender: EmailSender | undefined): Promise<ICampaignStats> {
  let sent = 0;
  let failed = 0;
  const { recipients } = resolved;
  for (let i = 0; i < recipients.length; i += EXTERNAL_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + EXTERNAL_BATCH_SIZE);
    const emails = chunk.map((contact) => {
      const vars = { name: contact.name?.trim() || "there", email: contact.email };
      const body = renderVars(content.bodyMarkdown, vars);
      const callout = content.callout?.text ? { ...content.callout, text: renderVars(content.callout.text, vars) } : content.callout;
      const unsubscribeUrl = buildUnsubscribeUrl(String(contact._id));
      return {
        to: contact.email,
        subject: renderVars(content.subject, vars),
        html: buildNotificationHtml(body, { highlightStyle: content.highlightStyle, callout, button: content.button }) + buildUnsubscribeFooterHtml(unsubscribeUrl),
        headers: buildUnsubscribeHeaders(unsubscribeUrl),
      };
    });
    // Sent AS the marketing address — never the no-reply EMAIL_FROM.
    const results = await sendNotificationEmailBatch(emails, `campaign:${campaign._id}`, sender);
    await ExternalDelivery.insertMany(chunk.map((contact, index) => ({ campaignId: campaign._id, contactId: contact._id, email: contact.email, status: results[index] ? "sent" : "failed" })));
    for (const ok of results) {
      if (ok) sent += 1;
      else failed += 1;
    }
  }
  return { targeted: recipients.length, sent, failed, skippedRegistered: resolved.skippedRegistered, skippedUnsubscribed: resolved.skippedUnsubscribed };
}

// The one real send path — called directly from the admin "Send now"
// action, and from jobs/notificationDispatch.cron.ts for a campaign whose
// scheduleAt has arrived. Resolves the audience FRESH at send time (a
// "segment" is dynamic, not a snapshot taken at creation) — deliberately
// synchronous end-to-end; see this file's own top comment for why no queue.
export async function sendCampaignNow(campaignId: string): Promise<INotificationCampaign> {
  const campaign = await NotificationCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  if (!["draft", "scheduled"].includes(campaign.status)) {
    throw new ApiError(400, "CANNOT_SEND", "Only a draft or scheduled campaign can be sent.");
  }

  // An email-list campaign is checked (and its recipients resolved) BEFORE the
  // status flips to "sending", so a fixable problem — no list chosen, wrong
  // channels, a list that's too big — is a clear error on a still-draft
  // campaign rather than a permanently "failed" one.
  assertExternalConfig(campaign);
  // Which address the emails go out from — refuses (leaving a fixable draft)
  // when this is a marketing-sender campaign with no usable marketing address.
  const emailSender = await resolveCampaignSender(campaign);
  const externalRecipients = campaign.audience === "external" ? await resolveExternalRecipients(campaign.externalListKey!) : null;

  campaign.status = "sending";
  await campaign.save();

  try {
    const { subject, bodyMarkdown, highlightStyle, callout, button } = await resolveContent(campaign);
    const buttonLink = resolveButtonLink(button);
    // Snapshot what's actually going out (see INotificationCampaign.sentContent).
    campaign.sentContent = { subject, bodyMarkdown, highlightStyle, callout, button };

    if (externalRecipients) {
      campaign.stats = await deliverToExternalContacts(campaign, { subject, bodyMarkdown, highlightStyle, callout, button }, externalRecipients, emailSender);
      campaign.status = "sent";
      campaign.sentAt = new Date();
      await campaign.save();
      return campaign;
    }

    const userIds = await resolveAudienceUserIds({ audience: campaign.audience, segmentQuery: campaign.segmentQuery, userIds: campaign.userIds?.map(String) });
    const recipients = await User.find({ _id: { $in: userIds } }).select("name email").lean();

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const { channels } = await resolveDeliveryChannels(recipient._id, campaign.categoryKey, campaign.channels);
      const vars = { name: recipient.name, email: recipient.email };
      const title = renderVars(subject, vars);
      const body = renderVars(bodyMarkdown, vars);
      // The callout's own `text` gets the same {{name}}/{{email}} treatment
      // as subject/body, so a callout can say "Hi {{name}}" too. It's an
      // email/popup-only banner concept, though — never reaches in_app.
      const recipientCallout = callout?.text ? { ...callout, text: renderVars(callout.text, vars) } : callout;
      const richBodyHtml = buildNotificationHtml(body, { highlightStyle, callout: recipientCallout, button });
      const inAppBodyHtml = buildInAppNotificationHtml(body);
      // The button's resolved URL + label ride on every row (the bell shows
      // them as a simple "Label →" link; email/popup already have the real
      // button baked into bodyHtml).
      const linkFields = buttonLink ?? {};

      for (const channel of channels) {
        if (channel === "in_app") {
          // Reduced render — no callout, no images, ==highlighted== spans
          // lose their styling (words stay, marker/color don't), inline
          // links keep their words but drop the link — only **bold**
          // survives. See buildInAppNotificationHtml's own comment.
          await UserNotification.create({ userId: recipient._id, campaignId: campaign._id, categoryKey: campaign.categoryKey, title, body, bodyHtml: inAppBodyHtml, ...linkFields, channel: "in_app" });
          sent += 1;
        } else if (channel === "popup") {
          await UserNotification.create({ userId: recipient._id, campaignId: campaign._id, categoryKey: campaign.categoryKey, title, body, bodyHtml: richBodyHtml, ...linkFields, channel: "popup" });
          sent += 1;
        } else if (channel === "email") {
          const delivered = await sendNotificationEmail(recipient.email, title, richBodyHtml, `campaign:${campaign._id}`, emailSender);
          await UserNotification.create({
            userId: recipient._id,
            campaignId: campaign._id,
            categoryKey: campaign.categoryKey,
            title,
            body,
            bodyHtml: richBodyHtml,
            ...linkFields,
            channel: "email",
            emailStatus: delivered ? "sent" : "failed",
          });
          if (delivered) sent += 1;
          else failed += 1;
        }
      }
    }

    campaign.status = "sent";
    campaign.sentAt = new Date();
    campaign.stats = { targeted: recipients.length, sent, failed };
    await campaign.save();
    return campaign;
  } catch (err) {
    campaign.status = "failed";
    campaign.error = err instanceof Error ? err.message : String(err);
    await campaign.save();
    throw err;
  }
}

export async function testSendCampaign(campaignId: string, testEmail: string): Promise<void> {
  const campaign = await NotificationCampaign.findById(campaignId).lean();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  const { subject, bodyMarkdown, highlightStyle, callout, button } = await resolveContent(campaign);
  const vars = { name: "Test Recipient", email: testEmail };
  const title = `[TEST] ${renderVars(subject, vars)}`;
  const body = renderVars(bodyMarkdown, vars);
  const testCallout = callout?.text ? { ...callout, text: renderVars(callout.text, vars) } : callout;
  // An email-list campaign always carries the unsubscribe footer, so the test
  // shows it too (pointing at a link that intentionally isn't a real token).
  const isExternal = campaign.audience === "external";
  const footer = isExternal ? buildUnsubscribeFooterHtml(`${publicApiBase()}/unsubscribe/test`) : "";
  // A test goes out from the SAME address the real send will use (the
  // marketing address for an email list or a marketing category), so it shows
  // exactly what recipients will see and proves the sender works. A test
  // email is always an email, whichever channels the campaign has — so the
  // sender is resolved as if "email" were one of them.
  const sender = await resolveCampaignSender({ ...campaign, channels: [...campaign.channels, "email"] });
  await sendNotificationEmail(testEmail, title, buildNotificationHtml(body, { highlightStyle, callout: testCallout, button }) + footer, `campaign-test:${campaign._id}`, sender);
}

export interface CampaignStats {
  targeted: number;
  sent: number;
  failed: number;
  delivered: number;
  opened: number;
}

// "opened" is computed live from UserNotification.readAt rather than an
// incremental counter — readAt changes long after send, so a stored count
// would immediately go stale.
export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const campaign = await NotificationCampaign.findById(campaignId).lean();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  // An email-list campaign has no UserNotification rows (no accounts): its
  // deliveries are ExternalDelivery records, and there's no way to know if an
  // email was opened (no tracking pixel, by design), so `opened` is always 0.
  const [delivered, opened] =
    campaign.audience === "external"
      ? [await ExternalDelivery.countDocuments({ campaignId: campaign._id, status: "sent" }), 0]
      : await Promise.all([
          UserNotification.countDocuments({ campaignId: campaign._id }),
          UserNotification.countDocuments({ campaignId: campaign._id, readAt: { $ne: null } }),
        ]);
  return {
    targeted: campaign.stats?.targeted ?? 0,
    sent: campaign.stats?.sent ?? 0,
    failed: campaign.stats?.failed ?? 0,
    delivered,
    opened,
  };
}

// Called by jobs/notificationDispatch.cron.ts — every campaign whose
// scheduled time has arrived, sent one at a time (this app's realistic
// campaign volume never makes sequential a real bottleneck).
export async function dispatchDueCampaigns(): Promise<{ sent: number; failed: number }> {
  const due = await NotificationCampaign.find({ status: "scheduled", scheduleAt: { $lte: new Date() } }).select("_id").lean();
  let sent = 0;
  let failed = 0;
  for (const { _id } of due) {
    try {
      await sendCampaignNow(String(_id));
      sent += 1;
    } catch (err) {
      failed += 1;
      // A pre-flight failure (e.g. an email list that's since grown too big)
      // is thrown BEFORE the campaign flips to "sending", so it would stay
      // "scheduled" and be retried — and fail — every minute forever. Mark it
      // failed with the reason instead.
      await NotificationCampaign.updateOne({ _id, status: "scheduled" }, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}
