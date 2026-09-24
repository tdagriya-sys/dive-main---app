import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import * as dataRequestService from "../../services/dataRequestService";
import { dataRequestRejectSchema, dataRequestLogSchema } from "../../validators/adminSetting";
import { recordAudit } from "../../services/auditLog";
import { IDataRequest } from "../../models/DataRequest";

/**
 * DPDP data-subject request queue, staff side (Phase 7 of
 * docs/ADMIN_PANEL_PLAN.md §4.6/§5.3/§11). Listing is `users.view`; fulfilling
 * an export or a deletion each require their own specific permission PLUS
 * step-up — a bulk PII export and an irreversible account deletion are each
 * exactly as consequential as a refund or a role change.
 */

function serialize(r: IDataRequest) {
  return {
    id: String(r._id),
    userId: r.userId ? String(r.userId) : null,
    userEmailSnapshot: r.userEmailSnapshot,
    type: r.type,
    status: r.status,
    requestedAt: r.requestedAt,
    fulfilledAt: r.fulfilledAt,
    handledBy: r.handledBy,
    rejectionReason: r.rejectionReason,
  };
}

export async function listDataRequests(req: StaffRequest, res: Response) {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const requests = await dataRequestService.listDataRequests(status);
  res.status(200).json({ requests: requests.map(serialize) });
}

// Logs a request that arrived outside the app (e.g. by email) so it enters
// the same queue a self-serve one lands in — fixes a real gap where a
// staff-initiated deletion had no way to ever get queued at all (see
// dataRequestService.ts::createAdminLoggedRequest's own comment).
export async function logRequest(req: StaffRequest, res: Response) {
  const data = dataRequestLogSchema.parse(req.body);
  const request = await dataRequestService.createAdminLoggedRequest(data.email, data.type);
  await recordAudit(
    { action: "data_request.logged", resourceType: "DataRequest", resourceId: String(request._id), meta: { type: data.type, email: data.email } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(201).json({ request: serialize(request) });
}

export async function fulfilExport(req: StaffRequest, res: Response) {
  const bundle = await dataRequestService.fulfilExportRequest(req.params.id, req.staff!.email);
  await recordAudit(
    { action: "data_request.export_fulfilled", resourceType: "DataRequest", resourceId: req.params.id },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="divve-data-export-${req.params.id}.json"`);
  res.status(200).send(JSON.stringify(bundle, null, 2));
}

export async function fulfilDelete(req: StaffRequest, res: Response) {
  const before = await dataRequestService.listDataRequests().then((all) => all.find((r) => String(r._id) === req.params.id));
  const request = await dataRequestService.fulfilDeleteRequest(req.params.id, req.staff!.email);
  await recordAudit(
    { action: "data_request.delete_fulfilled", resourceType: "DataRequest", resourceId: req.params.id, meta: { userId: before?.userId ? String(before.userId) : undefined } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ request: serialize(request) });
}

export async function rejectRequest(req: StaffRequest, res: Response) {
  const data = dataRequestRejectSchema.parse(req.body);
  const request = await dataRequestService.rejectDataRequest(req.params.id, data.reason, req.staff!.email);
  await recordAudit(
    { action: "data_request.rejected", resourceType: "DataRequest", resourceId: req.params.id, meta: { reason: data.reason } },
    { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email },
    req
  );
  res.status(200).json({ request: serialize(request) });
}
