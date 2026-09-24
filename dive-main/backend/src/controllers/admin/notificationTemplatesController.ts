import { Response } from "express";
import { NotificationTemplate } from "../../models/NotificationTemplate";
import { NotificationCampaign } from "../../models/NotificationCampaign";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createNotificationTemplateSchema, updateNotificationTemplateSchema } from "../../validators/notification";
import { recordAudit } from "../../services/auditLog";

/**
 * Notification-template admin CRUD (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5/§7 — "template editor: markdown + variable preview"). Gated by
 * `notifications.manage_templates`, same as categories.
 */

function serialize(t: { _id: unknown; key: string; name: string; categoryKey: string; subject: string; bodyMarkdown: string; channels: string[]; highlightStyle?: unknown; callout?: unknown; button?: unknown; isActive: boolean }) {
  return {
    id: String(t._id),
    key: t.key,
    name: t.name,
    categoryKey: t.categoryKey,
    subject: t.subject,
    bodyMarkdown: t.bodyMarkdown,
    channels: t.channels,
    highlightStyle: t.highlightStyle ?? null,
    callout: t.callout ?? null,
    button: t.button ?? null,
    isActive: t.isActive,
  };
}

export async function listTemplates(_req: StaffRequest, res: Response) {
  const templates = await NotificationTemplate.find({}).sort({ name: 1 }).lean();
  res.status(200).json({ templates: templates.map(serialize) });
}

export async function createTemplate(req: StaffRequest, res: Response) {
  const data = createNotificationTemplateSchema.parse(req.body);
  const existing = await NotificationTemplate.findOne({ key: data.key }).lean();
  if (existing) throw new ApiError(409, "TEMPLATE_KEY_TAKEN", "A template with this key already exists.");

  const template = await NotificationTemplate.create(data);
  await recordAudit(
    { action: "notification_template.created", resourceType: "NotificationTemplate", resourceId: String(template._id), meta: { key: template.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ template: serialize(template) });
}

export async function updateTemplate(req: StaffRequest, res: Response) {
  const data = updateNotificationTemplateSchema.parse(req.body);
  const template = await NotificationTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");

  const before = serialize(template);
  if (data.name !== undefined) template.name = data.name;
  if (data.categoryKey !== undefined) template.categoryKey = data.categoryKey;
  if (data.subject !== undefined) template.subject = data.subject;
  if (data.bodyMarkdown !== undefined) template.bodyMarkdown = data.bodyMarkdown;
  if (data.channels !== undefined) template.channels = data.channels;
  if (data.highlightStyle !== undefined) template.highlightStyle = data.highlightStyle ?? undefined;
  if (data.callout !== undefined) template.callout = data.callout ?? undefined;
  if (data.button !== undefined) template.button = data.button ?? undefined;
  if (data.isActive !== undefined) template.isActive = data.isActive;
  await template.save();

  await recordAudit(
    { action: "notification_template.updated", resourceType: "NotificationTemplate", resourceId: String(template._id), before, after: serialize(template) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ template: serialize(template) });
}

export async function deleteTemplate(req: StaffRequest, res: Response) {
  const template = await NotificationTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "Template not found.");

  const inUse = await NotificationCampaign.countDocuments({ templateKey: template.key });
  if (inUse > 0) throw new ApiError(400, "TEMPLATE_IN_USE", `${inUse} campaign(s) still use this template.`);

  await template.deleteOne();
  await recordAudit(
    { action: "notification_template.deleted", resourceType: "NotificationTemplate", resourceId: req.params.id, meta: { key: template.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ ok: true });
}
