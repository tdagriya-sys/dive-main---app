import { Response } from "express";
import { StaffRequest } from "../../middleware/auth";
import { createLandingPopupSchema, updateLandingPopupSchema } from "../../validators/landingPopup";
import * as landingPopupService from "../../services/landingPopupService";
import { recordAudit } from "../../services/auditLog";

/**
 * Admin CRUD + activate/deactivate for public landing-page pop-ups (see
 * models/LandingPopup.ts). Gated by `notifications.send` — a live popup
 * reaches every anonymous visitor, the same blast radius as a campaign to
 * "all users". Activating additionally requires step-up (admin.routes.ts);
 * deactivating (taking one DOWN) deliberately doesn't. An active popup
 * can't be edited or deleted until it's deactivated, so a live public
 * change always goes back through the step-up-gated activate action.
 */

function serialize(p: {
  _id: unknown;
  name: string;
  title: string;
  bodyMarkdown: string;
  highlightStyle?: unknown;
  callout?: unknown;
  button?: unknown;
  bodyHtml: string;
  isActive: boolean;
  activatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(p._id),
    name: p.name,
    title: p.title,
    bodyMarkdown: p.bodyMarkdown,
    highlightStyle: p.highlightStyle ?? null,
    callout: p.callout ?? null,
    button: p.button ?? null,
    bodyHtml: p.bodyHtml,
    isActive: p.isActive,
    activatedAt: p.activatedAt ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function actor(req: StaffRequest) {
  return { actorId: req.staff!.userId, actorRole: req.staff!.staffRole, actorLabel: req.staff!.email };
}

export async function listLandingPopups(_req: StaffRequest, res: Response) {
  const popups = await landingPopupService.listAllLandingPopups();
  res.status(200).json({ popups: popups.map(serialize) });
}

export async function createLandingPopup(req: StaffRequest, res: Response) {
  const data = createLandingPopupSchema.parse(req.body);
  const popup = await landingPopupService.createLandingPopup({ ...data, createdBy: req.staff!.userId });
  await recordAudit({ action: "landing_popup.created", resourceType: "LandingPopup", resourceId: String(popup._id), meta: { name: popup.name } }, actor(req), req);
  res.status(201).json({ popup: serialize(popup) });
}

export async function updateLandingPopup(req: StaffRequest, res: Response) {
  const data = updateLandingPopupSchema.parse(req.body);
  const popup = await landingPopupService.updateLandingPopup(req.params.id, data);
  await recordAudit({ action: "landing_popup.updated", resourceType: "LandingPopup", resourceId: String(popup._id) }, actor(req), req);
  res.status(200).json({ popup: serialize(popup) });
}

export async function activateLandingPopup(req: StaffRequest, res: Response) {
  const popup = await landingPopupService.setLandingPopupActive(req.params.id, true);
  await recordAudit({ action: "landing_popup.activated", resourceType: "LandingPopup", resourceId: String(popup._id), meta: { name: popup.name } }, actor(req), req);
  res.status(200).json({ popup: serialize(popup) });
}

export async function deactivateLandingPopup(req: StaffRequest, res: Response) {
  const popup = await landingPopupService.setLandingPopupActive(req.params.id, false);
  await recordAudit({ action: "landing_popup.deactivated", resourceType: "LandingPopup", resourceId: String(popup._id), meta: { name: popup.name } }, actor(req), req);
  res.status(200).json({ popup: serialize(popup) });
}

export async function deleteLandingPopup(req: StaffRequest, res: Response) {
  await landingPopupService.deleteLandingPopup(req.params.id);
  await recordAudit({ action: "landing_popup.deleted", resourceType: "LandingPopup", resourceId: req.params.id }, actor(req), req);
  res.status(200).json({ ok: true });
}
