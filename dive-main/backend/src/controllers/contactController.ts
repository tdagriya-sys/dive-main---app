import { Request, Response } from "express";
import { contactSubmissionSchema } from "../validators/contact";
import { createTicket } from "../services/ticketService";

// As of Phase 4 of docs/ADMIN_PANEL_PLAN.md, the public contact form feeds
// the same Ticket pipeline as the logged-in "raise a ticket" flow
// (source:"contact_form", no requesterUserId — this visitor has no
// account) instead of the old standalone ContactSubmission collection,
// which is now historical-only (see scripts/migrateContactSubmissions.ts
// for the one-off backfill of pre-existing rows). The form's "best time to
// reach you on a call" field always doubles as a callback request — that's
// exactly what it was already asking for, now backed by
// Ticket.callbackRequested instead of just sitting in a `timeSlot` column
// nobody but a human reading the raw DB could act on.
export async function submit(req: Request, res: Response) {
  const data = contactSubmissionSchema.parse(req.body);

  await createTicket({
    subject: data.subject || "Contact form message",
    categoryKey: "general",
    description: data.description,
    requesterEmail: data.email,
    requesterName: data.name,
    requesterMobile: data.mobile,
    source: "contact_form",
    callback: { mobile: data.mobile, preferredWindow: data.timeSlot },
  });

  return res.status(201).json({ message: "Thanks — we've got your message and will get back to you soon." });
}
