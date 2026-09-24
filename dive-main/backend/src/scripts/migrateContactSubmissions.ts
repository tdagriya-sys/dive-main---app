import { connectDb, disconnectDb } from "../db/connect";
import { ContactSubmission } from "../models/ContactSubmission";
import { Ticket } from "../models/Ticket";
import { createTicket } from "../services/ticketService";

/**
 * One-off backfill (Phase 4 of docs/ADMIN_PANEL_PLAN.md §4.4) — turns every
 * pre-existing `ContactSubmission` row (written before this phase; the
 * public contact form now creates a Ticket directly, see
 * contactController.ts) into one `Ticket` + its first `TicketMessage`,
 * `source:"contact_form"`.
 *
 * Idempotent via `Ticket.sourceRef` (the original ContactSubmission._id) —
 * safe to re-run (e.g. after a partial failure) without creating duplicates.
 * `ContactSubmission` itself is left untouched (read-only historical
 * record); this only ever creates new Ticket/TicketMessage documents.
 */
export async function migrateContactSubmissions(): Promise<{ migrated: number; skipped: number }> {
  const submissions = await ContactSubmission.find({}).sort({ createdAt: 1 }).lean();
  let migrated = 0;
  let skipped = 0;

  for (const sub of submissions) {
    const sourceRef = String(sub._id);
    const already = await Ticket.exists({ source: "contact_form", sourceRef });
    if (already) {
      skipped += 1;
      continue;
    }

    await createTicket({
      subject: sub.subject || "Contact form message",
      categoryKey: "general",
      description: sub.description,
      requesterEmail: sub.email,
      requesterName: sub.name,
      requesterMobile: sub.mobile,
      source: "contact_form",
      sourceRef,
      callback: { mobile: sub.mobile, preferredWindow: sub.timeSlot },
      skipConfirmationEmail: true,
    });
    migrated += 1;
  }

  return { migrated, skipped };
}

// Allows `npx tsx src/scripts/migrateContactSubmissions.ts`.
if (require.main === module) {
  connectDb()
    .then(() => migrateContactSubmissions())
    .then(({ migrated, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(`Migrated ${migrated} contact submission(s) into tickets (${skipped} already migrated, skipped).`);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
