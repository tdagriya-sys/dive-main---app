import { Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { Ticket } from "../models/Ticket";
import { TicketMessage } from "../models/TicketMessage";
import { User } from "../models/User";
import { createTicketSchema, replyMessageSchema, csatSchema } from "../validators/ticket";
import * as ticketService from "../services/ticketService";

/**
 * The logged-in user's own ticket surface (Phase 4 of
 * docs/ADMIN_PANEL_PLAN.md §7 — "My tickets" + "Raise a ticket" +
 * "Request a callback" inside SupportCard.jsx). Mounted at /api/tickets,
 * behind requireAuth (routes/tickets.routes.ts) — every handler here scopes
 * to `req.userId`, so one user can never read or act on another's ticket.
 *
 * Internal notes (TicketMessage.isInternalNote) are unconditionally
 * stripped out of every response here — a requester must never see staff-
 * only notes, regardless of what the frontend does with the response.
 */

async function loadOwnTicketOrThrow(ticketId: string, userId: string) {
  const ticket = await Ticket.findOne({ _id: ticketId, requesterUserId: userId });
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  return ticket;
}

export async function createTicket(req: AuthedRequest, res: Response) {
  const data = createTicketSchema.parse(req.body);
  const user = await User.findById(req.userId).select("name email mobile").lean();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  const ticket = await ticketService.createTicket({
    subject: data.subject,
    categoryKey: data.categoryKey,
    description: data.description,
    requesterUserId: req.userId,
    requesterEmail: user.email,
    requesterName: user.name,
    requesterMobile: data.requestCallback ? data.mobile : user.mobile,
    source: "in_app",
    callback: data.requestCallback && data.mobile ? { mobile: data.mobile, preferredWindow: data.preferredWindow } : undefined,
  });

  res.status(201).json({ ticket: { id: String(ticket._id), refNo: ticket.refNo, status: ticket.status } });
}

export async function listMyTickets(req: AuthedRequest, res: Response) {
  const tickets = await Ticket.find({ requesterUserId: req.userId })
    .select("refNo subject categoryKey priority status createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  res.status(200).json({
    tickets: tickets.map((t) => ({
      id: String(t._id),
      refNo: t.refNo,
      subject: t.subject,
      categoryKey: t.categoryKey,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
}

export async function getMyTicket(req: AuthedRequest, res: Response) {
  const ticket = await loadOwnTicketOrThrow(req.params.id, req.userId!);
  const messages = await TicketMessage.find({ ticketId: ticket._id, isInternalNote: false }).sort({ createdAt: 1 }).lean();

  res.status(200).json({
    ticket: {
      id: String(ticket._id),
      refNo: ticket.refNo,
      subject: ticket.subject,
      categoryKey: ticket.categoryKey,
      priority: ticket.priority,
      status: ticket.status,
      csatScore: ticket.csatScore,
      callbackRequested: ticket.callbackRequested,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
    messages: messages.map((m) => ({
      id: String(m._id),
      authorType: m.authorType,
      authorLabel: m.authorLabel,
      body: m.body,
      createdAt: m.createdAt,
    })),
  });
}

export async function replyToTicket(req: AuthedRequest, res: Response) {
  const ticket = await loadOwnTicketOrThrow(req.params.id, req.userId!);
  const data = replyMessageSchema.parse(req.body);
  const user = await User.findById(req.userId).select("name").lean();

  const message = await ticketService.addMessage(String(ticket._id), {
    authorType: "requester",
    authorId: req.userId,
    authorLabel: user?.name || ticket.requesterName,
    body: data.body,
  });

  res.status(201).json({ message: { id: String(message._id), body: message.body, createdAt: message.createdAt } });
}

export async function requestCallback(req: AuthedRequest, res: Response) {
  const ticket = await loadOwnTicketOrThrow(req.params.id, req.userId!);
  const { mobile, preferredWindow } = req.body as { mobile?: string; preferredWindow?: string };
  if (!mobile) throw new ApiError(400, "MOBILE_REQUIRED", "A mobile number is required to request a callback.");
  const updated = await ticketService.requestCallback(String(ticket._id), mobile, preferredWindow);
  res.status(200).json({ callbackRequested: updated.callbackRequested });
}

export async function submitCsat(req: AuthedRequest, res: Response) {
  const data = csatSchema.parse(req.body);
  const ticket = await ticketService.submitCsat(req.params.id, req.userId!, data.score, data.comment);
  res.status(200).json({ ticket: { id: String(ticket._id), csatScore: ticket.csatScore, csatComment: ticket.csatComment } });
}
