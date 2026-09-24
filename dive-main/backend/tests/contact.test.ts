import request from "supertest";
import { createApp } from "../src/app";
import { Ticket } from "../src/models/Ticket";
import { TicketMessage } from "../src/models/TicketMessage";

const app = createApp();

const validPayload = {
  name: "Test User",
  email: "test@example.com",
  mobile: "9876543210",
  subject: "Question about pricing",
  description: "Just checking things out, wanted to ask a quick question.",
  timeSlot: "Morning · 9 AM – 12 PM",
};

// Phase 4 of docs/ADMIN_PANEL_PLAN.md: the contact form now creates a real
// Ticket (source:"contact_form") instead of a standalone ContactSubmission
// row — see contactController.ts's own comment for why.
describe("contact", () => {
  it("creates a ticket from a valid contact submission", async () => {
    const res = await request(app).post("/api/contact").send(validPayload);
    expect(res.status).toBe(201);

    const ticket = await Ticket.findOne({ requesterEmail: "test@example.com" });
    expect(ticket).toBeTruthy();
    expect(ticket?.requesterName).toBe("Test User");
    expect(ticket?.requesterMobile).toBe("9876543210");
    expect(ticket?.subject).toBe("Question about pricing");
    expect(ticket?.source).toBe("contact_form");
    expect(ticket?.categoryKey).toBe("general");
    expect(ticket?.callbackRequested?.preferredWindow).toBe("Morning · 9 AM – 12 PM");
    expect(ticket?.callbackRequested?.mobile).toBe("9876543210");

    const message = await TicketMessage.findOne({ ticketId: ticket?._id });
    expect(message?.body).toBe(validPayload.description);
    expect(message?.authorType).toBe("requester");
  });

  it("rejects a submission with an invalid email", async () => {
    const res = await request(app).post("/api/contact").send({ ...validPayload, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects a submission with an invalid mobile number", async () => {
    const res = await request(app).post("/api/contact").send({ ...validPayload, mobile: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects a submission missing a description", async () => {
    const res = await request(app).post("/api/contact").send({ ...validPayload, description: "" });
    expect(res.status).toBe(400);
  });

  it("accepts a submission with no subject, defaulting the ticket's subject to a generic title", async () => {
    const { subject, ...rest } = validPayload;
    const res = await request(app).post("/api/contact").send(rest);
    expect(res.status).toBe(201);

    const ticket = await Ticket.findOne({ requesterEmail: "test@example.com" });
    expect(ticket?.subject).toBe("Contact form message");
  });
});
