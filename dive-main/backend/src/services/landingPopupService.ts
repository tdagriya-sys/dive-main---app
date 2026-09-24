import { LandingPopup, ILandingPopup } from "../models/LandingPopup";
import { IHighlightStyle, INotificationCallout, INotificationButton } from "../models/NotificationCategory";
import { ApiError } from "../middleware/errorHandler";
import { buildNotificationHtml } from "./notificationEmailService";

/**
 * Public landing-page pop-ups (see models/LandingPopup.ts). Nothing here is
 * per-user: an active popup is served to every anonymous visitor, and the
 * browser remembers a dismissal for its own session only.
 */

export interface LandingPopupContent {
  title: string;
  bodyMarkdown: string;
  highlightStyle?: IHighlightStyle;
  callout?: INotificationCallout;
  button?: INotificationButton;
}

// Always the rich (email/popup) render — there's no in-app variant, and no
// {{name}}/{{email}} substitution (a visitor has no identity).
function renderBodyHtml(content: LandingPopupContent): string {
  return buildNotificationHtml(content.bodyMarkdown, { highlightStyle: content.highlightStyle, callout: content.callout, button: content.button });
}

export interface CreateLandingPopupInput extends LandingPopupContent {
  name: string;
  createdBy: string;
}

export async function createLandingPopup(input: CreateLandingPopupInput): Promise<ILandingPopup> {
  return LandingPopup.create({
    name: input.name,
    title: input.title,
    bodyMarkdown: input.bodyMarkdown,
    highlightStyle: input.highlightStyle,
    callout: input.callout,
    button: input.button,
    bodyHtml: renderBodyHtml(input),
    isActive: false,
    createdBy: input.createdBy,
  });
}

export interface UpdateLandingPopupInput {
  name?: string;
  title?: string;
  bodyMarkdown?: string;
  // null clears; undefined leaves unchanged
  highlightStyle?: IHighlightStyle | null;
  callout?: INotificationCallout | null;
  button?: INotificationButton | null;
}

export async function updateLandingPopup(id: string, input: UpdateLandingPopupInput): Promise<ILandingPopup> {
  const popup = await LandingPopup.findById(id);
  if (!popup) throw new ApiError(404, "LANDING_POPUP_NOT_FOUND", "Landing pop-up not found.");
  if (popup.isActive) throw new ApiError(400, "LANDING_POPUP_ACTIVE", "Deactivate this pop-up before editing it — an active pop-up is live for every visitor.");

  // toObject() gives plain data, so nothing below depends on Mongoose
  // subdocument getters when re-rendering.
  const cur = popup.toObject();
  const next = {
    name: input.name ?? cur.name,
    title: input.title ?? cur.title,
    bodyMarkdown: input.bodyMarkdown ?? cur.bodyMarkdown,
    highlightStyle: input.highlightStyle === undefined ? cur.highlightStyle : input.highlightStyle ?? undefined,
    callout: input.callout === undefined ? cur.callout : input.callout ?? undefined,
    button: input.button === undefined ? cur.button : input.button ?? undefined,
  };

  popup.name = next.name;
  popup.title = next.title;
  popup.bodyMarkdown = next.bodyMarkdown;
  popup.highlightStyle = next.highlightStyle;
  popup.callout = next.callout;
  popup.button = next.button;
  popup.bodyHtml = renderBodyHtml(next);
  await popup.save();
  return popup;
}

export async function setLandingPopupActive(id: string, active: boolean): Promise<ILandingPopup> {
  const popup = await LandingPopup.findById(id);
  if (!popup) throw new ApiError(404, "LANDING_POPUP_NOT_FOUND", "Landing pop-up not found.");
  popup.isActive = active;
  if (active) popup.activatedAt = new Date();
  await popup.save();
  return popup;
}

export async function deleteLandingPopup(id: string): Promise<void> {
  const popup = await LandingPopup.findById(id);
  if (!popup) throw new ApiError(404, "LANDING_POPUP_NOT_FOUND", "Landing pop-up not found.");
  if (popup.isActive) throw new ApiError(400, "LANDING_POPUP_ACTIVE", "Deactivate this pop-up before deleting it.");
  await popup.deleteOne();
}

export async function listAllLandingPopups() {
  return LandingPopup.find({}).sort({ createdAt: -1 }).lean();
}

// The one thing a logged-out visitor's browser ever sees: id, title and the
// pre-rendered HTML. `version` (the last-edited time) lets the frontend
// treat an edited-then-reactivated popup as new for a visitor who already
// dismissed its earlier version this session.
export async function listPublicLandingPopups() {
  const popups = await LandingPopup.find({ isActive: true }).sort({ activatedAt: 1, createdAt: 1 }).limit(5).lean();
  return popups.map((p) => ({ id: String(p._id), title: p.title, bodyHtml: p.bodyHtml, version: new Date(p.activatedAt ?? p.updatedAt).getTime() }));
}
