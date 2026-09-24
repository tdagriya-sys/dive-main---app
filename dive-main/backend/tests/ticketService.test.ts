import { Types } from "mongoose";
import { User } from "../src/models/User";
import { Ticket } from "../src/models/Ticket";
import { TicketMessage } from "../src/models/TicketMessage";
import { TicketCategory } from "../src/models/TicketCategory";
import * as ticketService from "../src/services/ticketService";

// Phase 4 of docs/ADMIN_PANEL_PLAN.md — the ticket lifecycle at the service
// layer (creation, conversation status transitions, SLA, CSAT, merge,
// report), independent of any HTTP surface.

async function makeStaffUser(email: string) {
  return User.create({
    name: "Staff Member",
    mobile: String(9820000000 + Math.floor(Math.random() * 1000000)),
    email,
    age: 30,
    passwordHash: "x",
    staffRole: "admin",
    status: "active",
  });
}

describe("seedDefaultTicketCategoriesIfEmpty", () => {
  it("seeds the default categories when the collection is empty", async () => {
    await ticketService.seedDefaultTicketCategoriesIfEmpty();
    const categories = await TicketCategory.find({}).lean();
    expect(categories.length).toBe(ticketService.DEFAULT_TICKET_CATEGORIES.length);
    expect(categories.map((c) => c.key)).toEqual(expect.arrayContaining(["general", "technical", "billing", "account"]));
  });

  it("is a no-op when categories already exist", async () => {
    await TicketCategory.create({ key: "custom", label: "Custom", defaultPriority: "low", slaHours: 10 });
    await ticketService.seedDefaultTicketCategoriesIfEmpty();
    const categories = await TicketCategory.find({}).lean();
    expect(categories.length).toBe(1);
  });
});

describe("createTicket", () => {
  it("creates a ticket with its first message, using the category's SLA/priority", async () => {
    await TicketCategory.create({ key: "billing", label: "Billing", defaultPriority: "high", slaHours: 24 });
    const ticket = await ticketService.createTicket({
      subject: "Refund question",
      categoryKey: "billing",
      description: "I was charged twice.",
      requesterEmail: "USER@Example.com",
      requesterName: "A User",
      source: "in_app",
    });

    expect(ticket.refNo).toMatch(/^DIV-\d{6}$/);
    expect(ticket.priority).toBe("high");
    expect(ticket.status).toBe("open");
    expect(ticket.requesterEmail).toBe("user@example.com"); // lowercased
    expect(ticket.slaDueAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    const message = await TicketMessage.findOne({ ticketId: ticket._id }).lean();
    expect(message?.body).toBe("I was charged twice.");
    expect(message?.authorType).toBe("requester");
  });

  it("falls back to normal/48h defaults for an unknown category", async () => {
    const ticket = await ticketService.createTicket({
      subject: "Something",
      categoryKey: "nonexistent",
      description: "Details.",
      requesterEmail: "x@example.com",
      requesterName: "X",
      source: "in_app",
    });
    expect(ticket.priority).toBe("normal");
    expect(ticket.slaDueAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);
  });

  it("stores a callback request when given one", async () => {
    const ticket = await ticketService.createTicket({
      subject: "Call me",
      categoryKey: "general",
      description: "Please call.",
      requesterEmail: "call@example.com",
      requesterName: "Caller",
      source: "in_app",
      callback: { mobile: "9876543210", preferredWindow: "Morning" },
    });
    expect(ticket.callbackRequested?.mobile).toBe("9876543210");
    expect(ticket.callbackRequested?.done).toBe(false);
  });
});

describe("addMessage — conversation lifecycle", () => {
  async function newTicket() {
    return ticketService.createTicket({
      subject: "Help",
      categoryKey: "general",
      description: "Initial message.",
      requesterEmail: "req@example.com",
      requesterName: "Requester",
      requesterUserId: String(new Types.ObjectId()),
      source: "in_app",
    });
  }

  it("a non-internal staff reply moves an open ticket to pending and sets firstRespondedAt", async () => {
    const ticket = await newTicket();
    await ticketService.addMessage(String(ticket._id), { authorType: "staff", authorLabel: "Staff", body: "We're on it." });

    const updated = await Ticket.findById(ticket._id);
    expect(updated?.status).toBe("pending");
    expect(updated?.firstRespondedAt).toBeTruthy();
  });

  it("an internal note never changes ticket status", async () => {
    const ticket = await newTicket();
    await ticketService.addMessage(String(ticket._id), { authorType: "staff", authorLabel: "Staff", body: "internal only", isInternalNote: true });
    const updated = await Ticket.findById(ticket._id);
    expect(updated?.status).toBe("open");
    expect(updated?.firstRespondedAt).toBeFalsy();
  });

  it("a requester reply reopens a pending ticket", async () => {
    const ticket = await newTicket();
    await ticketService.addMessage(String(ticket._id), { authorType: "staff", authorLabel: "Staff", body: "reply" });
    await ticketService.addMessage(String(ticket._id), { authorType: "requester", authorLabel: "Requester", body: "still broken" });
    const updated = await Ticket.findById(ticket._id);
    expect(updated?.status).toBe("open");
  });

  it("throws for a nonexistent ticket", async () => {
    await expect(
      ticketService.addMessage(String(new Types.ObjectId()), { authorType: "staff", authorLabel: "Staff", body: "x" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateTicket", () => {
  it("rejects an assigneeId that isn't a staff account", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const normalUser = await User.create({ name: "Normal", mobile: "9800000001", email: "normal@example.com", age: 25, passwordHash: "x" });
    await expect(ticketService.updateTicket(String(ticket._id), { assigneeId: String(normalUser._id) })).rejects.toMatchObject({ status: 400 });
  });

  it("assigns to a staff account and sets resolvedAt/closedAt on status transitions", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const staff = await makeStaffUser("assignee@example.com");
    const assigned = await ticketService.updateTicket(String(ticket._id), { assigneeId: String(staff._id), priority: "urgent", tags: ["vip"] });
    expect(String(assigned.assigneeId)).toBe(String(staff._id));
    expect(assigned.priority).toBe("urgent");
    expect(assigned.tags).toEqual(["vip"]);

    const resolved = await ticketService.updateTicket(String(ticket._id), { status: "resolved" });
    expect(resolved.resolvedAt).toBeTruthy();

    const closed = await ticketService.updateTicket(String(ticket._id), { status: "closed" });
    expect(closed.closedAt).toBeTruthy();
  });

  it("clears the assignee when given null", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const staff = await makeStaffUser("assignee2@example.com");
    await ticketService.updateTicket(String(ticket._id), { assigneeId: String(staff._id) });
    const cleared = await ticketService.updateTicket(String(ticket._id), { assigneeId: null });
    expect(cleared.assigneeId).toBeUndefined();
  });
});

describe("callback requests", () => {
  it("requestCallback sets a fresh request, setCallbackDone marks it done", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const withCallback = await ticketService.requestCallback(String(ticket._id), "9876543210", "Evening");
    expect(withCallback.callbackRequested?.done).toBe(false);
    const done = await ticketService.setCallbackDone(String(ticket._id), true);
    expect(done.callbackRequested?.done).toBe(true);
  });

  it("setCallbackDone throws if no callback was ever requested", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    await expect(ticketService.setCallbackDone(String(ticket._id), true)).rejects.toMatchObject({ status: 400 });
  });
});

describe("submitCsat", () => {
  it("rejects rating a ticket that isn't resolved/closed", async () => {
    const requesterUserId = String(new Types.ObjectId());
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", requesterUserId, source: "in_app" });
    await expect(ticketService.submitCsat(String(ticket._id), requesterUserId, 5)).rejects.toMatchObject({ status: 400 });
  });

  it("accepts a rating once resolved, and rejects a second rating", async () => {
    const requesterUserId = String(new Types.ObjectId());
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", requesterUserId, source: "in_app" });
    await ticketService.updateTicket(String(ticket._id), { status: "resolved" });

    const rated = await ticketService.submitCsat(String(ticket._id), requesterUserId, 4, "Pretty good");
    expect(rated.csatScore).toBe(4);

    await expect(ticketService.submitCsat(String(ticket._id), requesterUserId, 5)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects rating a ticket that belongs to someone else", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", requesterUserId: String(new Types.ObjectId()), source: "in_app" });
    await ticketService.updateTicket(String(ticket._id), { status: "resolved" });
    await expect(ticketService.submitCsat(String(ticket._id), String(new Types.ObjectId()), 5)).rejects.toMatchObject({ status: 404 });
  });
});

describe("mergeTickets", () => {
  it("moves messages into the target, closes the source, and tags it merged", async () => {
    const source = await ticketService.createTicket({ subject: "Duplicate", categoryKey: "general", description: "First.", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const target = await ticketService.createTicket({ subject: "Original", categoryKey: "general", description: "Second.", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });

    const { source: mergedSource, target: mergedTarget } = await ticketService.mergeTickets(String(source._id), String(target._id));
    expect(mergedSource.status).toBe("closed");
    expect(mergedSource.mergedIntoTicketId?.toString()).toBe(String(target._id));
    expect(mergedSource.tags).toContain("merged");

    const targetMessages = await TicketMessage.find({ ticketId: mergedTarget._id }).lean();
    // the target's own first message + the source's first message + the system merge note
    expect(targetMessages.length).toBe(3);
    const sourceMessagesLeft = await TicketMessage.find({ ticketId: mergedSource._id }).lean();
    expect(sourceMessagesLeft.length).toBe(0);
  });

  it("rejects merging a ticket into itself", async () => {
    const ticket = await ticketService.createTicket({ subject: "S", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    await expect(ticketService.mergeTickets(String(ticket._id), String(ticket._id))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects merging an already-merged ticket again", async () => {
    const source = await ticketService.createTicket({ subject: "S1", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const target = await ticketService.createTicket({ subject: "S2", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    const other = await ticketService.createTicket({ subject: "S3", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", source: "in_app" });
    await ticketService.mergeTickets(String(source._id), String(target._id));
    await expect(ticketService.mergeTickets(String(source._id), String(other._id))).rejects.toMatchObject({ status: 400 });
  });
});

describe("getTicketReport", () => {
  it("aggregates counts, timing averages, CSAT, and SLA breaches", async () => {
    const requesterUserId = String(new Types.ObjectId());
    const t1 = await ticketService.createTicket({ subject: "S1", categoryKey: "general", description: "D", requesterEmail: "a@example.com", requesterName: "A", requesterUserId, source: "in_app" });
    await ticketService.updateTicket(String(t1._id), { status: "resolved" });
    await ticketService.submitCsat(String(t1._id), requesterUserId, 5);

    await ticketService.createTicket({ subject: "S2", categoryKey: "general", description: "D", requesterEmail: "b@example.com", requesterName: "B", source: "in_app" });
    // Force this second ticket's SLA into the past to exercise the breach count.
    await Ticket.updateOne({ subject: "S2" }, { slaDueAt: new Date(Date.now() - 1000) });

    const report = await ticketService.getTicketReport();
    expect(report.byStatus.resolved).toBe(1);
    expect(report.byStatus.open).toBe(1);
    expect(report.csatCount).toBe(1);
    expect(report.csatAverage).toBe(5);
    expect(report.slaBreached).toBe(1);
    expect(report.totalOpen).toBe(1);
  });
});
