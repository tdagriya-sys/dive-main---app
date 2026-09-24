import { Response } from "express";
import { TicketCategory } from "../../models/TicketCategory";
import { Ticket } from "../../models/Ticket";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { createTicketCategorySchema, updateTicketCategorySchema } from "../../validators/ticket";
import { recordAudit } from "../../services/auditLog";

/**
 * Ticket-category admin CRUD (Phase 4 of docs/ADMIN_PANEL_PLAN.md §4.4).
 * Gated by `tickets.manage` in admin.routes.ts — a step below `tickets.view`
 * (seeing/answering tickets) or `tickets.assign`, since editing the routing
 * defaults is a more structural change than day-to-day ticket work.
 */

function serialize(c: { _id: unknown; key: string; label: string; defaultAssigneeId?: unknown; defaultPriority: string; slaHours: number; isActive: boolean }) {
  return {
    id: String(c._id),
    key: c.key,
    label: c.label,
    defaultAssigneeId: c.defaultAssigneeId ? String(c.defaultAssigneeId) : undefined,
    defaultPriority: c.defaultPriority,
    slaHours: c.slaHours,
    isActive: c.isActive,
  };
}

export async function listCategories(_req: StaffRequest, res: Response) {
  const categories = await TicketCategory.find({}).sort({ label: 1 }).lean();
  res.status(200).json({ categories: categories.map(serialize) });
}

export async function createCategory(req: StaffRequest, res: Response) {
  const data = createTicketCategorySchema.parse(req.body);
  const existing = await TicketCategory.findOne({ key: data.key }).lean();
  if (existing) throw new ApiError(409, "CATEGORY_KEY_TAKEN", "A category with this key already exists.");

  const category = await TicketCategory.create(data);
  await recordAudit(
    { action: "ticket_category.created", resourceType: "TicketCategory", resourceId: String(category._id), meta: { key: category.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ category: serialize(category) });
}

export async function updateCategory(req: StaffRequest, res: Response) {
  const data = updateTicketCategorySchema.parse(req.body);
  const category = await TicketCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found.");

  const before = { label: category.label, defaultPriority: category.defaultPriority, slaHours: category.slaHours, isActive: category.isActive };
  if (data.label !== undefined) category.label = data.label;
  if (data.defaultAssigneeId !== undefined) category.defaultAssigneeId = data.defaultAssigneeId ? (data.defaultAssigneeId as never) : undefined;
  if (data.defaultPriority !== undefined) category.defaultPriority = data.defaultPriority;
  if (data.slaHours !== undefined) category.slaHours = data.slaHours;
  if (data.isActive !== undefined) category.isActive = data.isActive;
  await category.save();

  await recordAudit(
    { action: "ticket_category.updated", resourceType: "TicketCategory", resourceId: String(category._id), before, after: { label: category.label, defaultPriority: category.defaultPriority, slaHours: category.slaHours, isActive: category.isActive } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ category: serialize(category) });
}

export async function deleteCategory(req: StaffRequest, res: Response) {
  const category = await TicketCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found.");

  const inUse = await Ticket.countDocuments({ categoryKey: category.key });
  if (inUse > 0) throw new ApiError(400, "CATEGORY_IN_USE", `${inUse} ticket(s) still use this category.`);

  await category.deleteOne();
  await recordAudit(
    { action: "ticket_category.deleted", resourceType: "TicketCategory", resourceId: req.params.id, meta: { key: category.key } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ ok: true });
}
