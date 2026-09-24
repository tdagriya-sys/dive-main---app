import { Response } from "express";
import { NotificationCampaign } from "../../models/NotificationCampaign";
import { NotificationTemplate } from "../../models/NotificationTemplate";
import { User } from "../../models/User";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import {
  createNotificationCampaignSchema,
  updateNotificationCampaignSchema,
  scheduleCampaignSchema,
  testSendCampaignSchema,
  audiencePreviewSchema,
} from "../../validators/notification";
import * as campaignService from "../../services/notificationCampaignService";
import { previewAudience, maskEmail } from "../../services/notificationAudienceService";
import * as externalContactService from "../../services/externalContactService";
import { describeCampaignSender } from "../../services/campaignSenderService";
import { recordAudit } from "../../services/auditLog";

/**
 * The notification-campaign admin API (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5/§5.3/§7). Gated by `notifications.send` — see the categories
 * controller's own comment for why campaigns (not just the final dispatch)
 * sit behind this permission rather than `notifications.manage_templates`.
 * `schedule`/`send` additionally require step-up (admin.routes.ts) — a
 * campaign reaching potentially every user is as consequential and as
 * hard to undo as a config publish or an employee invite.
 */

function serialize(c: {
  _id: unknown;
  name: string;
  templateKey?: string;
  inlineContent?: { subject: string; bodyMarkdown: string; highlightStyle?: unknown; callout?: unknown; button?: unknown };
  sentContent?: unknown;
  categoryKey: string;
  channels: string[];
  audience: string;
  segmentQuery?: unknown;
  userIds?: unknown[];
  externalListKey?: string;
  scheduleAt?: Date;
  status: string;
  stats?: { targeted: number; sent: number; failed: number };
  error?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(c._id),
    name: c.name,
    templateKey: c.templateKey,
    inlineContent: c.inlineContent,
    sentContent: c.sentContent,
    categoryKey: c.categoryKey,
    channels: c.channels,
    audience: c.audience,
    segmentQuery: c.segmentQuery,
    userIds: c.userIds?.map(String),
    externalListKey: c.externalListKey,
    scheduleAt: c.scheduleAt,
    status: c.status,
    stats: c.stats,
    error: c.error,
    sentAt: c.sentAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// The single-campaign detail view: everything `serialize` returns, plus
// what the detail page needs to show "all the details of that campaign" —
// who created it, the template it uses (and that template's content, so a
// draft can be customized from it), the specific recipients for a
// `user_ids` audience (PII-masked, like every other audience preview), and
// a server-rendered preview of what recipients see. A sent campaign
// previews from its send-time snapshot, not the live template.
async function serializeDetail(c: Parameters<typeof serialize>[0] & { createdBy?: unknown }) {
  const [creator, template, audienceUsers, preview, externalList] = await Promise.all([
    c.createdBy ? User.findById(c.createdBy).select("name email").lean() : null,
    c.templateKey ? NotificationTemplate.findOne({ key: c.templateKey }).lean() : null,
    c.audience === "user_ids" && c.userIds?.length ? User.find({ _id: { $in: c.userIds.slice(0, 100) } }).select("name email").lean() : [],
    campaignService.buildCampaignPreview(c as Parameters<typeof campaignService.buildCampaignPreview>[0]).catch(() => null),
    // The current state of the imported list an email-list campaign goes to
    // (its own audience summary; what actually went out is in `stats`).
    c.audience === "external" && c.externalListKey
      ? externalContactService.listSummaries().then((s) => s.lists.find((l) => l.name === c.externalListKey) ?? null)
      : null,
  ]);
  return {
    ...serialize(c),
    externalList,
    createdBy: creator ? { name: creator.name, email: creator.email } : null,
    templateName: template?.name ?? null,
    templateContent: template
      ? { subject: template.subject, bodyMarkdown: template.bodyMarkdown, highlightStyle: template.highlightStyle, callout: template.callout, button: template.button }
      : null,
    audienceUsers: audienceUsers.map((u) => ({ id: String(u._id), name: u.name, email: maskEmail(u.email) })),
    preview,
  };
}

export async function listCampaigns(_req: StaffRequest, res: Response) {
  const campaigns = await NotificationCampaign.find({}).sort({ createdAt: -1 }).lean();
  res.status(200).json({ campaigns: campaigns.map(serialize) });
}

export async function getCampaign(req: StaffRequest, res: Response) {
  const campaign = await NotificationCampaign.findById(req.params.id).lean();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  res.status(200).json({ campaign: await serializeDetail(campaign) });
}

// Which address this campaign's emails will go out from, and whether it can
// right now — shown on the campaign page before anyone clicks Send.
export async function getCampaignSender(req: StaffRequest, res: Response) {
  const campaign = await NotificationCampaign.findById(req.params.id).select("audience categoryKey channels").lean();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  res.status(200).json({ sender: await describeCampaignSender(campaign) });
}

export async function createCampaign(req: StaffRequest, res: Response) {
  const data = createNotificationCampaignSchema.parse(req.body);
  const campaign = await campaignService.createCampaign({ ...data, createdBy: req.staff!.userId });
  await recordAudit(
    { action: "notification_campaign.created", resourceType: "NotificationCampaign", resourceId: String(campaign._id), meta: { name: campaign.name } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ campaign: serialize(campaign) });
}

export async function updateCampaign(req: StaffRequest, res: Response) {
  const data = updateNotificationCampaignSchema.parse(req.body);
  const campaign = await campaignService.updateCampaign(req.params.id, data);
  await recordAudit(
    { action: "notification_campaign.updated", resourceType: "NotificationCampaign", resourceId: String(campaign._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ campaign: serialize(campaign) });
}

export async function previewCampaignAudience(req: StaffRequest, res: Response) {
  const campaign = await NotificationCampaign.findById(req.params.id).lean();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  // An email-list audience has no user ids — it's previewed from the list
  // itself (and must never fall through to previewAudience, which would read
  // it as "all users").
  if (campaign.audience === "external") {
    if (!campaign.externalListKey) throw new ApiError(400, "EXTERNAL_LIST_REQUIRED", "Choose which email list this campaign goes to.");
    return res.status(200).json(await externalContactService.previewExternalAudience(campaign.externalListKey));
  }
  const preview = await previewAudience({ audience: campaign.audience, segmentQuery: campaign.segmentQuery, userIds: campaign.userIds?.map(String) });
  res.status(200).json(preview);
}

export async function previewAudienceAdHoc(req: StaffRequest, res: Response) {
  const data = audiencePreviewSchema.parse(req.body);
  const preview = await previewAudience(data);
  res.status(200).json(preview);
}

export async function testSend(req: StaffRequest, res: Response) {
  const data = testSendCampaignSchema.parse(req.body);
  await campaignService.testSendCampaign(req.params.id, data.email);
  res.status(200).json({ ok: true });
}

export async function schedule(req: StaffRequest, res: Response) {
  const data = scheduleCampaignSchema.parse(req.body);
  const campaign = await campaignService.scheduleCampaign(req.params.id, data.scheduleAt);
  await recordAudit(
    { action: "notification_campaign.scheduled", resourceType: "NotificationCampaign", resourceId: String(campaign._id), meta: { scheduleAt: data.scheduleAt } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ campaign: serialize(campaign) });
}

export async function send(req: StaffRequest, res: Response) {
  const campaign = await campaignService.sendCampaignNow(req.params.id);
  await recordAudit(
    { action: "notification_campaign.sent", resourceType: "NotificationCampaign", resourceId: String(campaign._id), meta: { stats: campaign.stats } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ campaign: serialize(campaign) });
}

export async function cancel(req: StaffRequest, res: Response) {
  const campaign = await campaignService.cancelCampaign(req.params.id);
  await recordAudit(
    { action: "notification_campaign.cancelled", resourceType: "NotificationCampaign", resourceId: String(campaign._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ campaign: serialize(campaign) });
}

export async function getStats(req: StaffRequest, res: Response) {
  const stats = await campaignService.getCampaignStats(req.params.id);
  res.status(200).json({ stats });
}
