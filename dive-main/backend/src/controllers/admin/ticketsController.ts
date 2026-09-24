import { Response } from "express";
import { FilterQuery } from "mongoose";
import { Ticket, ITicket } from "../../models/Ticket";
import { TicketMessage } from "../../models/TicketMessage";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { addStaffMessageSchema, updateTicketSchema, mergeTicketSchema, callbackDoneSchema } from "../../validators/ticket";
import * as ticketService from "../../services/ticketService";
import { recordAudit } from "../../services/auditLog";

/**
 * The staff ticket console (Phase 4 of docs/ADMIN_PANEL_PLAN.md §5.3/§7) —
 * inbox / conversation (incl. internal notes) / assignment / SLA / merge /
 * report. Every route is gated by the `tickets.*` permission group in
 * admin.routes.ts; mutations are audited the same as every other admin
 * write.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function listTickets(req: StaffRequest, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const { status, priority, categoryKey, assigneeId, q } = req.query as Record<string, string | undefined>;

  const filter: FilterQuery<ITicket> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (categoryKey) filter.categoryKey = categoryKey;
  if (assigneeId) filter.assigneeId = assigneeId === "unassigned" ? { $exists: false } : assigneeId;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ refNo: re }, { subject: re }, { requesterEmail: re }, { requesterName: re }];
  }

  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);

  res.status(200).json({
    tickets: tickets.map((t) => ({
      id: String(t._id),
      refNo: t.refNo,
      subject: t.subject,
      categoryKey: t.categoryKey,
      priority: t.priority,
      status: t.status,
      requesterName: t.requesterName,
      requesterEmail: t.requesterEmail,
      assigneeId: t.assigneeId ? String(t.assigneeId) : undefined,
      tags: t.tags,
      source: t.source,
      slaDueAt: t.slaDueAt,
      slaBreached: !!(t.slaDueAt && t.slaDueAt < new Date() && !["resolved", "closed"].includes(t.status)),
      callbackRequested: t.callbackRequested,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function getTicketDetail(req: StaffRequest, res: Response) {
  const ticket = await Ticket.findById(req.params.id).lean();
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  const messages = await TicketMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean();

  res.status(200).json({
    ticket: {
      id: String(ticket._id),
      refNo: ticket.refNo,
      subject: ticket.subject,
      categoryKey: ticket.categoryKey,
      priority: ticket.priority,
      status: ticket.status,
      requesterName: ticket.requesterName,
      requesterEmail: ticket.requesterEmail,
      requesterMobile: ticket.requesterMobile,
      assigneeId: ticket.assigneeId ? String(ticket.assigneeId) : undefined,
      tags: ticket.tags,
      source: ticket.source,
      slaDueAt: ticket.slaDueAt,
      firstRespondedAt: ticket.firstRespondedAt,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      csatScore: ticket.csatScore,
      csatComment: ticket.csatComment,
      callbackRequested: ticket.callbackRequested,
      mergedIntoTicketId: ticket.mergedIntoTicketId ? String(ticket.mergedIntoTicketId) : undefined,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
    messages: messages.map((m) => ({
      id: String(m._id),
      authorType: m.authorType,
      authorLabel: m.authorLabel,
      body: m.body,
      isInternalNote: m.isInternalNote,
      createdAt: m.createdAt,
    })),
  });
}

export async function addStaffMessage(req: StaffRequest, res: Response) {
  const data = addStaffMessageSchema.parse(req.body);
  const message = await ticketService.addMessage(req.params.id, {
    authorType: "staff",
    authorId: req.staff!.userId,
    authorLabel: req.staff!.email,
    body: data.body,
    isInternalNote: data.isInternalNote,
  });

  await recordAudit(
    { action: data.isInternalNote ? "ticket.internal_note_added" : "ticket.replied", resourceType: "Ticket", resourceId: req.params.id },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(201).json({ message: { id: String(message._id), body: message.body, isInternalNote: message.isInternalNote, createdAt: message.createdAt } });
}

// The route itself only requires "tickets.respond" (status/priority/tags
// are routine ticket-handling work); reassigning who owns a ticket is
// specifically gated to "tickets.assign" here, one level more sensitive,
// rather than splitting this into a second endpoint for one field.
export async function updateTicket(req: StaffRequest, res: Response) {
  const data = updateTicketSchema.parse(req.body);
  if (data.assigneeId !== undefined && !req.staff!.permissions.has("tickets.assign")) {
    throw new ApiError(403, "FORBIDDEN", "Missing permission: tickets.assign");
  }
  const before = await Ticket.findById(req.params.id).select("status assigneeId priority tags").lean();
  if (!before) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");

  const ticket = await ticketService.updateTicket(req.params.id, data);

  await recordAudit(
    {
      action: "ticket.updated",
      resourceType: "Ticket",
      resourceId: req.params.id,
      before: { status: before.status, assigneeId: before.assigneeId, priority: before.priority, tags: before.tags },
      after: { status: ticket.status, assigneeId: ticket.assigneeId, priority: ticket.priority, tags: ticket.tags },
    },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(200).json({
    ticket: { id: String(ticket._id), status: ticket.status, assigneeId: ticket.assigneeId ? String(ticket.assigneeId) : undefined, priority: ticket.priority, tags: ticket.tags },
  });
}

export async function mergeTickets(req: StaffRequest, res: Response) {
  const data = mergeTicketSchema.parse(req.body);
  const { source, target } = await ticketService.mergeTickets(req.params.id, data.targetTicketId);

  await recordAudit(
    { action: "ticket.merged", resourceType: "Ticket", resourceId: String(source._id), meta: { targetTicketId: String(target._id), targetRefNo: target.refNo } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );

  res.status(200).json({ source: { id: String(source._id), status: source.status }, target: { id: String(target._id) } });
}

export async function setCallbackDone(req: StaffRequest, res: Response) {
  const data = callbackDoneSchema.parse(req.body);
  const ticket = await ticketService.setCallbackDone(req.params.id, data.done);
  res.status(200).json({ callbackRequested: ticket.callbackRequested });
}

export async function listAssignableStaff(_req: StaffRequest, res: Response) {
  const staff = await ticketService.listAssignableStaff();
  res.status(200).json({ staff });
}

export async function getReport(_req: StaffRequest, res: Response) {
  const report = await ticketService.getTicketReport();
  res.status(200).json({ report });
}
