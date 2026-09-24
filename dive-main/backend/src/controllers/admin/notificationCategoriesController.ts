import { Response } from "express";
import { NotificationCategory } from "../../models/NotificationCategory";
import { NotificationTemplate } from "../../models/NotificationTemplate";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createNotificationCategorySchema, updateNotificationCategorySchema } from "../../validators/notification";
import { recordAudit } from "../../services/auditLog";

/**
 * Notification-category admin CRUD (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5). Gated by `notifications.manage_templates` — see this phase's own
 * changelog entry for why category/template CRUD is split from
 * `notifications.send` (the plan's §5.3 table lists only one permission
 * for the whole group; §6's registry lists both, and the split by resource
 * matches every other Phase 3/4 permission group).
 */

function serialize(c: { _id: unknown; key: string; label: string; description?: string; defaultChannels: string[]; userOptOutAllowed: boolean; emailSender?: string; isSystem: boolean }) {
  // `emailSender` can be absent on a row saved before the field existed (a
  // lean() read skips schema defaults) — treat that as the no-reply default.
  return { id: String(c._id), key: c.key, label: c.label, description: c.description, defaultChannels: c.defaultChannels, userOptOutAllowed: c.userOptOutAllowed, emailSender: c.emailSender ?? "system", isSystem: c.isSystem };
}

export async function listCategories(_req: StaffRequest, res: Response) {
  const categories = await NotificationCategory.find({}).sort({ label: 1 }).lean();
  res.status(200).json({ categories: categories.map(serialize) });
}

export async function createCategory(req: StaffRequest, res: Response) {
  const data = createNotificationCategorySchema.parse(req.body);
  const existing = await NotificationCategory.findOne({ key: data.key }).lean();
  if (existing) throw new ApiError(409, "CATEGORY_KEY_TAKEN", "A category with this key already exists.");

  const category = await NotificationCategory.create(data);
  await recordAudit(
    { action: "notification_category.created", resourceType: "NotificationCategory", resourceId: String(category._id), meta: { key: category.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ category: serialize(category) });
}

export async function updateCategory(req: StaffRequest, res: Response) {
  const data = updateNotificationCategorySchema.parse(req.body);
  const category = await NotificationCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found.");

  const before = { label: category.label, description: category.description, defaultChannels: category.defaultChannels, userOptOutAllowed: category.userOptOutAllowed, emailSender: category.emailSender ?? "system" };
  if (data.label !== undefined) category.label = data.label;
  if (data.description !== undefined) category.description = data.description;
  if (data.defaultChannels !== undefined) category.defaultChannels = data.defaultChannels;
  if (data.userOptOutAllowed !== undefined) category.userOptOutAllowed = data.userOptOutAllowed;
  if (data.emailSender !== undefined) category.emailSender = data.emailSender;
  await category.save();

  await recordAudit(
    {
      action: "notification_category.updated",
      resourceType: "NotificationCategory",
      resourceId: String(category._id),
      before,
      after: { label: category.label, description: category.description, defaultChannels: category.defaultChannels, userOptOutAllowed: category.userOptOutAllowed, emailSender: category.emailSender },
    },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ category: serialize(category) });
}

export async function deleteCategory(req: StaffRequest, res: Response) {
  const category = await NotificationCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found.");
  if (category.isSystem) throw new ApiError(400, "SYSTEM_CATEGORY", "A system category can't be deleted.");

  const inUse = await NotificationTemplate.countDocuments({ categoryKey: category.key });
  if (inUse > 0) throw new ApiError(400, "CATEGORY_IN_USE", `${inUse} template(s) still use this category.`);

  await category.deleteOne();
  await recordAudit(
    { action: "notification_category.deleted", resourceType: "NotificationCategory", resourceId: req.params.id, meta: { key: category.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ ok: true });
}
