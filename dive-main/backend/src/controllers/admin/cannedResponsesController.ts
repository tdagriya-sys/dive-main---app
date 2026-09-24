import { Response } from "express";
import { CannedResponse } from "../../models/CannedResponse";
import { StaffRequest } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { cannedResponseSchema, updateCannedResponseSchema } from "../../validators/ticket";
import { recordAudit } from "../../services/auditLog";

/**
 * Canned-response admin CRUD (Phase 4 of docs/ADMIN_PANEL_PLAN.md §4.4/§7 —
 * the picker inside the ticket console's reply box). Gated by
 * `tickets.manage`, same bar as category management.
 */

function serialize(c: { _id: unknown; title: string; body: string; categoryKey?: string }) {
  return { id: String(c._id), title: c.title, body: c.body, categoryKey: c.categoryKey };
}

export async function listCannedResponses(_req: StaffRequest, res: Response) {
  const responses = await CannedResponse.find({}).sort({ title: 1 }).lean();
  res.status(200).json({ cannedResponses: responses.map(serialize) });
}

export async function createCannedResponse(req: StaffRequest, res: Response) {
  const data = cannedResponseSchema.parse(req.body);
  const response = await CannedResponse.create({ ...data, createdBy: req.staff!.userId });
  await recordAudit(
    { action: "canned_response.created", resourceType: "CannedResponse", resourceId: String(response._id), meta: { title: response.title } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ cannedResponse: serialize(response) });
}

export async function updateCannedResponse(req: StaffRequest, res: Response) {
  const data = updateCannedResponseSchema.parse(req.body);
  const response = await CannedResponse.findById(req.params.id);
  if (!response) throw new ApiError(404, "CANNED_RESPONSE_NOT_FOUND", "Canned response not found.");

  if (data.title !== undefined) response.title = data.title;
  if (data.body !== undefined) response.body = data.body;
  if (data.categoryKey !== undefined) response.categoryKey = data.categoryKey;
  await response.save();

  await recordAudit(
    { action: "canned_response.updated", resourceType: "CannedResponse", resourceId: String(response._id) },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ cannedResponse: serialize(response) });
}

export async function deleteCannedResponse(req: StaffRequest, res: Response) {
  const response = await CannedResponse.findById(req.params.id);
  if (!response) throw new ApiError(404, "CANNED_RESPONSE_NOT_FOUND", "Canned response not found.");
  await response.deleteOne();
  await recordAudit(
    { action: "canned_response.deleted", resourceType: "CannedResponse", resourceId: req.params.id },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ ok: true });
}
