import { ContactSubmission } from "../src/models/ContactSubmission";
import { Ticket } from "../src/models/Ticket";
import { TicketMessage } from "../src/models/TicketMessage";
import { migrateContactSubmissions } from "../src/scripts/migrateContactSubmissions";

// Phase 4 of docs/ADMIN_PANEL_PLAN.md — the one-off backfill of pre-existing
// ContactSubmission rows into the new Ticket/TicketMessage collections.

describe("migrateContactSubmissions", () => {
  it("creates one ticket + message per contact submission", async () => {
    await ContactSubmission.create({
      name: "Old Visitor",
      email: "old@example.com",
      mobile: "9876500001",
      subject: "Pre-existing question",
      description: "This was submitted before tickets existed.",
      timeSlot: "Afternoon · 12 PM – 3 PM",
    });

    const result = await migrateContactSubmissions();
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);

    const ticket = await Ticket.findOne({ requesterEmail: "old@example.com" });
    expect(ticket?.source).toBe("contact_form");
    expect(ticket?.subject).toBe("Pre-existing question");
    expect(ticket?.callbackRequested?.preferredWindow).toBe("Afternoon · 12 PM – 3 PM");

    const message = await TicketMessage.findOne({ ticketId: ticket?._id });
    expect(message?.body).toBe("This was submitted before tickets existed.");
  });

  it("is idempotent — re-running skips already-migrated rows", async () => {
    await ContactSubmission.create({
      name: "Another Visitor",
      email: "another@example.com",
      mobile: "9876500002",
      subject: "",
      description: "Second submission.",
      timeSlot: "Morning · 9 AM – 12 PM",
    });

    const first = await migrateContactSubmissions();
    expect(first.migrated).toBe(1);

    const second = await migrateContactSubmissions();
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);

    const tickets = await Ticket.find({ requesterEmail: "another@example.com" });
    expect(tickets.length).toBe(1);
  });

  it("defaults an empty subject to a generic title", async () => {
    await ContactSubmission.create({
      name: "No Subject",
      email: "nosubject@example.com",
      mobile: "9876500003",
      subject: "",
      description: "No subject given.",
      timeSlot: "Anytime works",
    });
    await migrateContactSubmissions();
    const ticket = await Ticket.findOne({ requesterEmail: "nosubject@example.com" });
    expect(ticket?.subject).toBe("Contact form message");
  });
});
