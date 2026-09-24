import { Schema, model, Document, Types } from "mongoose";
import { IHighlightStyle, highlightStyleSchema, INotificationCallout, calloutSchema, INotificationButton, buttonSchema } from "./NotificationCategory";

/**
 * A pop-up shown on the public landing page to logged-out visitors — no
 * account, no per-user rows, no audience. Unlike a campaign, nothing is
 * "sent": an ACTIVE popup is simply served to every anonymous visitor via
 * the public `GET /api/landing-popups`, and the browser remembers a dismissal
 * for the current session only (sessionStorage — see
 * frontend/src/components/LandingPopupCard.jsx), so it reappears in a new
 * session.
 *
 * Content mirrors a campaign's (title/body/callout/button/highlight), but is
 * rendered ONCE at save time into `bodyHtml` with the rich (email/popup)
 * renderer — there is no in-app variant, and `{{name}}`/`{{email}}` aren't
 * available since a visitor has no identity.
 *
 * An active popup's content is locked: it must be deactivated before it can
 * be edited or deleted, so a live public change can never happen without
 * going back through the (step-up-gated) activate action.
 */
export interface ILandingPopup extends Document {
  _id: Types.ObjectId;
  name: string;
  title: string;
  bodyMarkdown: string;
  highlightStyle?: IHighlightStyle;
  callout?: INotificationCallout;
  button?: INotificationButton;
  bodyHtml: string;
  isActive: boolean;
  activatedAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const landingPopupSchema = new Schema<ILandingPopup>(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    bodyMarkdown: { type: String, required: true },
    highlightStyle: { type: highlightStyleSchema },
    callout: { type: calloutSchema },
    button: { type: buttonSchema },
    bodyHtml: { type: String, required: true },
    isActive: { type: Boolean, default: false, index: true },
    activatedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export const LandingPopup = model<ILandingPopup>("LandingPopup", landingPopupSchema);
