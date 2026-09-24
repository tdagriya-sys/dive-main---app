import { Types } from "mongoose";
import { Counter } from "../models/Counter";
import { Ticket, ITicket, TicketPriority, TicketSource } from "../models/Ticket";
import { TicketMessage, ITicketMessage, TicketMessageAuthorType } from "../models/TicketMessage";
import { TicketCategory } from "../models/TicketCategory";
import { User } from "../models/User";
import { ApiError } from "../middleware/errorHandler";
import { sendTicketCreatedEmail, sendTicketReplyEmail } from "./ticketEmailService";
import { isPremiumUser } from "./entitlementService";

/**
 * The support-ticket lifecycle (Phase 4 of docs/ADMIN_PANEL_PLAN.md §4.4) —
 * creation, the requester<->staff conversation, status transitions, SLA,
 * CSAT, and merging. Both the public contact form (contactController.ts)
 * and the logged-in "raise a ticket" flow (controllers/ticketsController.ts)
 * go through the same `createTicket` here — one intake pipeline, one staff
 * console, instead of the two disconnected systems this app had before
 * (ContactSubmission for the public form, nothing at all for logged-in
 * users). See scripts/migrateContactSubmissions.ts for the one-off backfill
 * of pre-existing ContactSubmission rows into this collection.
 */

const DEFAULT_PRIORITY: TicketPriority = "normal";
const DEFAULT_SLA_HOURS = 48;

export const DEFAULT_TICKET_CATEGORIES = [
  { key: "general", label: "General", defaultPriority: "normal" as TicketPriority, slaHours: 48 },
  { key: "technical", label: "Technical issue", defaultPriority: "high" as TicketPriority, slaHours: 24 },
  { key: "billing", label: "Billing & payments", defaultPriority: "high" as TicketPriority, slaHours: 24 },
  { key: "account", label: "Account & login", defaultPriority: "normal" as TicketPriority, slaHours: 48 },
];

// Mirrors index.ts's "seed the Instrument collection if empty" convention —
// called once at server boot (see index.ts) so a fresh database always has
// somewhere for a ticket to route to, while staying fully admin-editable
// (CRUD via controllers/admin/ticketCategoriesController.ts) from then on.
export async function seedDefaultTicketCategoriesIfEmpty(): Promise<void> {
  const count = await TicketCategory.countDocuments();
  if (count > 0) return;
  await TicketCategory.insertMany(DEFAULT_TICKET_CATEGORIES);
}

async function nextRefNo(): Promise<string> {
  const counter = await Counter.findOneAndUpdate({ _id: "ticket_ref" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `DIV-${String(counter.seq).padStart(6, "0")}`;
}

async function resolveCategoryDefaults(categoryKey: string): Promise<{ priority: TicketPriority; slaHours: number }> {
  const category = await TicketCategory.findOne({ key: categoryKey, isActive: true }).lean();
  if (!category) return { priority: DEFAULT_PRIORITY, slaHours: DEFAULT_SLA_HOURS };
  return { priority: category.defaultPriority, slaHours: category.slaHours };
}

export interface CreateTicketInput {
  subject: string;
  categoryKey: string;
  description: string;
  requesterUserId?: string;
  requesterEmail: string;
  requesterName: string;
  requesterMobile?: string;
  source: TicketSource;
  sourceRef?: string;
  callback?: { mobile: string; preferredWindow?: string };
  // Set by scripts/migrateContactSubmissions.ts — a historical backfill
  // must never re-notify people about years-old submissions.
  skipConfirmationEmail?: boolean;
}

const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.2 — "Priority (ticket auto-priority
// high, shorter SLA)" for Premium. Never DOWNGRADES a category's own default
// (a category already set to "urgent" stays "urgent"), and halves the
// category's SLA window with a 4h floor, rather than a separate hardcoded
// Premium SLA — so a future admin edit to a category's own slaHours still
// scales the Premium version proportionally instead of the two silently
// drifting apart.
async function applyPremiumSupportBoost(categoryKey: string, priority: TicketPriority, slaHours: number, requesterUserId?: string): Promise<{ priority: TicketPriority; slaHours: number }> {
  if (!requesterUserId) return { priority, slaHours };
  if (!(await isPremiumUser(requesterUserId))) return { priority, slaHours };
  const boostedPriority = PRIORITY_RANK[priority] >= PRIORITY_RANK.high ? priority : "high";
  return { priority: boostedPriority, slaHours: Math.max(4, Math.round(slaHours / 2)) };
}

export async function createTicket(input: CreateTicketInput): Promise<ITicket> {
  const categoryDefaults = await resolveCategoryDefaults(input.categoryKey);
  const { priority, slaHours } = await applyPremiumSupportBoost(input.categoryKey, categoryDefaults.priority, categoryDefaults.slaHours, input.requesterUserId);
  const refNo = await nextRefNo();

  const ticket = await Ticket.create({
    refNo,
    subject: input.subject,
    categoryKey: input.categoryKey,
    priority,
    status: "open",
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail.trim().toLowerCase(),
    requesterName: input.requesterName,
    requesterMobile: input.requesterMobile,
    source: input.source,
    sourceRef: input.sourceRef,
    slaDueAt: new Date(Date.now() + slaHours * 60 * 60 * 1000),
    callbackRequested: input.callback
      ? { requestedAt: new Date(), mobile: input.callback.mobile, preferredWindow: input.callback.preferredWindow, done: false }
      : undefined,
  });

  await TicketMessage.create({
    ticketId: ticket._id,
    authorType: "requester",
    authorId: input.requesterUserId,
    authorLabel: input.requesterName,
    body: input.description,
    isInternalNote: false,
  });

  if (!input.skipConfirmationEmail) {
    await sendTicketCreatedEmail(ticket.requesterEmail, ticket.refNo, ticket.subject).catch(() => undefined);
  }

  return ticket;
}

export interface AddMessageInput {
  authorType: TicketMessageAuthorType;
  authorId?: string;
  authorLabel: string;
  body: string;
  isInternalNote?: boolean;
}

// Lifecycle rule (helpdesk-standard, not specific to any one plan section):
// a non-internal staff reply moves an "open" ticket to "pending" (awaiting
// the requester); any requester reply reopens a "pending"/"resolved"/
// "closed" ticket back to "open" (awaiting staff). Internal notes never
// touch status — they're not part of the requester-visible conversation.
export async function addMessage(ticketId: string, input: AddMessageInput): Promise<ITicketMessage> {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");

  const message = await TicketMessage.create({
    ticketId: ticket._id,
    authorType: input.authorType,
    authorId: input.authorId,
    authorLabel: input.authorLabel,
    body: input.body,
    isInternalNote: input.isInternalNote ?? false,
  });

  if (input.authorType === "staff" && !message.isInternalNote) {
    if (!ticket.firstRespondedAt) ticket.firstRespondedAt = new Date();
    if (ticket.status === "open") ticket.status = "pending";
    await ticket.save();
    await sendTicketReplyEmail(ticket.requesterEmail, ticket.refNo, input.body).catch(() => undefined);
  } else if (input.authorType === "requester" && ticket.status !== "open") {
    ticket.status = "open";
    await ticket.save();
  }

  return message;
}

export interface UpdateTicketInput {
  status?: ITicket["status"];
  assigneeId?: string | null;
  priority?: TicketPriority;
  tags?: string[];
}

export async function updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ITicket> {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");

  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) {
      ticket.assigneeId = undefined;
    } else {
      const assignee = await User.findOne({ _id: input.assigneeId, staffRole: { $ne: null } }).lean();
      if (!assignee) throw new ApiError(400, "ASSIGNEE_NOT_STAFF", "The selected assignee isn't a staff account.");
      ticket.assigneeId = new Types.ObjectId(input.assigneeId);
    }
  }
  if (input.priority) ticket.priority = input.priority;
  if (input.tags) ticket.tags = input.tags;
  if (input.status) {
    ticket.status = input.status;
    if (input.status === "resolved") ticket.resolvedAt = new Date();
    if (input.status === "closed") ticket.closedAt = new Date();
  }

  await ticket.save();
  return ticket;
}

export async function requestCallback(ticketId: string, mobile: string, preferredWindow?: string): Promise<ITicket> {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  ticket.callbackRequested = { requestedAt: new Date(), mobile, preferredWindow, done: false };
  await ticket.save();
  return ticket;
}

export async function setCallbackDone(ticketId: string, done: boolean): Promise<ITicket> {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  if (!ticket.callbackRequested) throw new ApiError(400, "NO_CALLBACK_REQUESTED", "This ticket has no callback request.");
  ticket.callbackRequested.done = done;
  await ticket.save();
  return ticket;
}

export async function submitCsat(ticketId: string, requesterUserId: string, score: number, comment?: string): Promise<ITicket> {
  const ticket = await Ticket.findOne({ _id: ticketId, requesterUserId });
  if (!ticket) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new ApiError(400, "TICKET_NOT_RESOLVED", "You can only rate a resolved ticket.");
  }
  if (ticket.csatScore !== undefined) {
    throw new ApiError(400, "ALREADY_RATED", "You've already rated this ticket.");
  }
  ticket.csatScore = score;
  ticket.csatComment = comment;
  await ticket.save();
  return ticket;
}

export async function mergeTickets(sourceId: string, targetId: string): Promise<{ source: ITicket; target: ITicket }> {
  if (sourceId === targetId) throw new ApiError(400, "CANNOT_MERGE_SELF", "A ticket can't be merged into itself.");
  const [source, target] = await Promise.all([Ticket.findById(sourceId), Ticket.findById(targetId)]);
  if (!source || !target) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  if (source.mergedIntoTicketId) throw new ApiError(400, "ALREADY_MERGED", "This ticket has already been merged.");
  if (target.mergedIntoTicketId) throw new ApiError(400, "TARGET_ALREADY_MERGED", "The target ticket has itself been merged elsewhere — merge into its target instead.");

  await TicketMessage.updateMany({ ticketId: source._id }, { ticketId: target._id });
  await TicketMessage.create({
    ticketId: target._id,
    authorType: "system",
    authorLabel: "System",
    body: `Merged from ticket ${source.refNo} ("${source.subject}").`,
    isInternalNote: true,
  });

  source.status = "closed";
  source.closedAt = new Date();
  source.mergedIntoTicketId = target._id;
  if (!source.tags.includes("merged")) source.tags.push("merged");
  await source.save();

  return { source, target };
}

export async function listAssignableStaff() {
  const staff = await User.find({ staffRole: { $ne: null }, status: "active" }).select("name email staffRole").sort({ name: 1 }).lean();
  return staff.map((s) => ({ id: String(s._id), name: s.name, email: s.email, staffRole: s.staffRole }));
}

export interface TicketReport {
  totalOpen: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAverage: number | null;
  csatCount: number;
  slaBreached: number;
}

export async function getTicketReport(): Promise<TicketReport> {
  const [statusAgg, priorityAgg, categoryAgg, timingAgg, csatAgg, slaBreached, totalOpen] = await Promise.all([
    Ticket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Ticket.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Ticket.aggregate([{ $group: { _id: "$categoryKey", count: { $sum: 1 } } }]),
    Ticket.aggregate([
      {
        $project: {
          firstResponseMinutes: {
            $cond: [{ $ifNull: ["$firstRespondedAt", false] }, { $divide: [{ $subtract: ["$firstRespondedAt", "$createdAt"] }, 60000] }, null],
          },
          resolutionMinutes: {
            $cond: [{ $ifNull: ["$resolvedAt", false] }, { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 60000] }, null],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgFirstResponseMinutes: { $avg: "$firstResponseMinutes" },
          avgResolutionMinutes: { $avg: "$resolutionMinutes" },
        },
      },
    ]),
    Ticket.aggregate([{ $match: { csatScore: { $ne: null } } }, { $group: { _id: null, avg: { $avg: "$csatScore" }, count: { $sum: 1 } } }]),
    Ticket.countDocuments({ status: { $in: ["open", "pending"] }, slaDueAt: { $lt: new Date() } }),
    Ticket.countDocuments({ status: { $in: ["open", "pending"] } }),
  ]);

  const toRecord = (rows: { _id: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r._id, r.count]));

  return {
    totalOpen,
    byStatus: toRecord(statusAgg),
    byPriority: toRecord(priorityAgg),
    byCategory: toRecord(categoryAgg),
    avgFirstResponseMinutes: timingAgg[0]?.avgFirstResponseMinutes ?? null,
    avgResolutionMinutes: timingAgg[0]?.avgResolutionMinutes ?? null,
    csatAverage: csatAgg[0]?.avg ?? null,
    csatCount: csatAgg[0]?.count ?? 0,
    slaBreached,
  };
}
