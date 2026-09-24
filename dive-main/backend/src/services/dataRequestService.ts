import { Types } from "mongoose";
import { DataRequest, DataRequestType, IDataRequest } from "../models/DataRequest";
import { User } from "../models/User";
import { Holding } from "../models/Holding";
import { AaConsent } from "../models/AaConsent";
import { Payment } from "../models/Payment";
import { Subscription } from "../models/Subscription";
import { Ticket } from "../models/Ticket";
import { TicketMessage } from "../models/TicketMessage";
import { ApiError } from "../middleware/errorHandler";

/**
 * DPDP data-subject request queue (Phase 7 of docs/ADMIN_PANEL_PLAN.md
 * §4.6/§5.3/§11) — see models/DataRequest.ts's own top comment for the
 * export-vs-delete request-shape split.
 */

export async function createExportRequest(userId: string): Promise<IDataRequest> {
  const user = await User.findById(userId).select("email").lean();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account not found.");
  const existing = await DataRequest.findOne({ userId, type: "export", status: "pending" }).lean();
  if (existing) throw new ApiError(409, "REQUEST_ALREADY_PENDING", "You already have a pending data export request.");
  return DataRequest.create({ userId, userEmailSnapshot: user.email, type: "export", status: "pending" });
}

// Called from userController.ts::deleteMe at the moment of the user's own
// instant self-serve deletion — purely a compliance-trail stamp, since that
// deletion has already happened by the time this is called; never blocks or
// delays it.
export async function logSelfServeDeletion(userId: string, email: string): Promise<void> {
  await DataRequest.create({ userId, userEmailSnapshot: email, type: "delete", status: "fulfilled", fulfilledAt: new Date() });
}

// Admin logs a request that arrived outside the app (e.g. by email) so it
// enters the same review queue as a self-serve one, looked up by email since
// that's what an out-of-band request naturally arrives with. Fixes a real
// gap: fulfilDeleteRequest below has always required a pre-existing pending
// "delete" row, but until this function existed nothing ever created one —
// self-serve deletion (logSelfServeDeletion) always creates its row already
// fulfilled, so a staff-initiated deletion for a request that arrived by
// email had no way to ever get queued at all. Supports "export" too, for the
// same out-of-band scenario on that side.
export async function createAdminLoggedRequest(email: string, type: DataRequestType): Promise<IDataRequest> {
  const user = await User.findOne({ email: email.toLowerCase().trim(), staffRole: null }).select("_id email").lean();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "No account found with that email.");
  const existing = await DataRequest.findOne({ userId: user._id, type, status: "pending" }).lean();
  if (existing) throw new ApiError(409, "REQUEST_ALREADY_PENDING", `This user already has a pending ${type} request.`);
  return DataRequest.create({ userId: user._id, userEmailSnapshot: user.email, type, status: "pending" });
}

export async function listDataRequests(status?: string): Promise<IDataRequest[]> {
  const filter = status ? { status } : {};
  return DataRequest.find(filter).sort({ requestedAt: -1 }).lean() as unknown as Promise<IDataRequest[]>;
}

// The actual DPDP export bundle — every collection a user's account
// meaningfully touches, PII intact (this IS the "give the subject their own
// data" flow, unlike every list view elsewhere in the admin panel which
// masks it). Ticket messages exclude internal staff notes, the same
// requester-facing boundary ticketService.ts already enforces everywhere
// else. Read-only; never mutates anything.
export async function buildExportBundle(userId: string) {
  const userObjectId = new Types.ObjectId(userId);
  const [user, holdings, consents, payments, subscriptions, tickets] = await Promise.all([
    User.findById(userId).select("-passwordHash").lean(),
    Holding.find({ userId: userObjectId }).lean(),
    AaConsent.find({ userId: userObjectId }).select("-rawResponses").lean(),
    Payment.find({ userId: userObjectId }).lean(),
    Subscription.find({ userId: userObjectId }).lean(),
    Ticket.find({ requesterUserId: userObjectId }).lean(),
  ]);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account not found.");

  const ticketIds = tickets.map((t) => t._id);
  const messages = await TicketMessage.find({ ticketId: { $in: ticketIds }, isInternalNote: false }).lean();

  return {
    exportedAt: new Date().toISOString(),
    profile: user,
    holdings,
    accountAggregatorConsents: consents,
    payments,
    subscriptions,
    tickets: tickets.map((t) => ({ ...t, messages: messages.filter((m) => String(m.ticketId) === String(t._id)) })),
  };
}

export async function fulfilExportRequest(requestId: string, handledBy: string) {
  const request = await DataRequest.findById(requestId);
  if (!request) throw new ApiError(404, "REQUEST_NOT_FOUND", "Data request not found.");
  if (request.type !== "export") throw new ApiError(400, "WRONG_REQUEST_TYPE", "This isn't an export request.");
  if (!request.userId) throw new ApiError(400, "NO_TARGET_USER", "This request has no target account left to export.");
  const bundle = await buildExportBundle(String(request.userId));
  request.status = "fulfilled";
  request.fulfilledAt = new Date();
  request.handledBy = handledBy;
  await request.save();
  return bundle;
}

// Admin-triggered deletion (a request that arrived outside the app, e.g. by
// email) — mirrors userController.ts::deleteMe's own cleanup exactly, just
// staff-initiated instead of self-serve.
export async function fulfilDeleteRequest(requestId: string, handledBy: string): Promise<IDataRequest> {
  const request = await DataRequest.findById(requestId);
  if (!request) throw new ApiError(404, "REQUEST_NOT_FOUND", "Data request not found.");
  if (request.type !== "delete") throw new ApiError(400, "WRONG_REQUEST_TYPE", "This isn't a deletion request.");
  if (request.status === "fulfilled") throw new ApiError(400, "ALREADY_FULFILLED", "This request was already fulfilled.");
  if (!request.userId) throw new ApiError(400, "NO_TARGET_USER", "This account no longer exists.");

  await Promise.all([Holding.deleteMany({ userId: request.userId }), AaConsent.deleteMany({ userId: request.userId }), User.deleteOne({ _id: request.userId })]);

  request.status = "fulfilled";
  request.fulfilledAt = new Date();
  request.handledBy = handledBy;
  await request.save();
  return request;
}

export async function rejectDataRequest(requestId: string, reason: string, handledBy: string): Promise<IDataRequest> {
  const request = await DataRequest.findById(requestId);
  if (!request) throw new ApiError(404, "REQUEST_NOT_FOUND", "Data request not found.");
  if (request.status !== "pending") throw new ApiError(400, "NOT_PENDING", "Only a pending request can be rejected.");
  request.status = "rejected";
  request.rejectionReason = reason;
  request.handledBy = handledBy;
  await request.save();
  return request;
}
