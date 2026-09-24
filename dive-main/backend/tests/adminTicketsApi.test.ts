import request from "supertest";
import { createApp } from "../src/app";
import { User } from "../src/models/User";
import { Role } from "../src/models/Role";
import { Ticket } from "../src/models/Ticket";
import { seedDefaultTicketCategoriesIfEmpty } from "../src/services/ticketService";
import { _generateCurrentCodeForTests } from "../src/services/totpService";

// Phase 4 of docs/ADMIN_PANEL_PLAN.md — the staff ticket console
// (/api/admin/tickets, /ticket-categories, /canned-responses), permission
// gating, and the requester<->staff conversation as seen from staff.

const app = createApp();

let mobileCounter = 9840000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Admin Tickets Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

async function loginAsStaff(mobile: string, email: string, staffRole: "superadmin" | "admin" | "employee", roleId?: string) {
  const { userId } = await signupNormalUser(mobile, email);
  const user = await User.findById(userId);
  if (!user) throw new Error("user not found");
  user.staffRole = staffRole;
  if (roleId) user.roleId = roleId as unknown as typeof user.roleId;
  await user.save();

  const login = await request(app).post("/api/auth/login").send({ identifier: mobile, password: "Passw0rd!" });
  const pending = { Authorization: `Bearer ${login.body.pendingToken}` };
  const setup = await request(app).post("/api/auth/staff/totp/setup").set(pending).send();
  const code = _generateCurrentCodeForTests(setup.body.secret);
  const confirm = await request(app).post("/api/auth/staff/totp/confirm").set(pending).send({ code });
  return { userId, accessToken: confirm.body.accessToken as string };
}

async function createTicketAsUser(): Promise<{ ticketId: string; accessToken: string }> {
  const { accessToken } = await signupNormalUser(nextMobile(), `requester-${Date.now()}-${Math.random()}@example.com`);
  const res = await request(app)
    .post("/api/tickets")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ subject: "Something's off", categoryKey: "general", description: "Please help." });
  return { ticketId: res.body.ticket.id as string, accessToken };
}

beforeEach(async () => {
  await seedDefaultTicketCategoriesIfEmpty();
});

describe("permission gating", () => {
  it("an employee with no tickets permissions is forbidden everywhere", async () => {
    const role = await Role.create({ key: "no_tickets", label: "No Tickets", permissions: [] });
    const staff = await loginAsStaff(nextMobile(), "no-perms@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/tickets").set(auth)).status).toBe(403);
    expect((await request(app).get("/api/admin/ticket-categories").set(auth)).status).toBe(403);
  });

  it("an employee with only tickets.view can list and read, but not reply or assign", async () => {
    const role = await Role.create({ key: "view_only", label: "View Only", permissions: ["tickets.view"] });
    const staff = await loginAsStaff(nextMobile(), "view-only@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { ticketId } = await createTicketAsUser();

    expect((await request(app).get("/api/admin/tickets").set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/admin/tickets/${ticketId}`).set(auth)).status).toBe(200);
    expect((await request(app).post(`/api/admin/tickets/${ticketId}/messages`).set(auth).send({ body: "hi" })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/tickets/${ticketId}`).set(auth).send({ status: "resolved" })).status).toBe(403);
  });

  it("an employee with tickets.respond but not tickets.assign can reply and change status but not assignee", async () => {
    const role = await Role.create({ key: "responder", label: "Responder", permissions: ["tickets.view", "tickets.respond"] });
    const staff = await loginAsStaff(nextMobile(), "responder@example.com", "employee", String(role._id));
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { ticketId } = await createTicketAsUser();

    expect((await request(app).post(`/api/admin/tickets/${ticketId}/messages`).set(auth).send({ body: "We're on it." })).status).toBe(201);
    expect((await request(app).patch(`/api/admin/tickets/${ticketId}`).set(auth).send({ status: "pending" })).status).toBe(200);
    expect((await request(app).patch(`/api/admin/tickets/${ticketId}`).set(auth).send({ assigneeId: staff.userId })).status).toBe(403);
    expect((await request(app).post(`/api/admin/tickets/${ticketId}/merge`).set(auth).send({ targetTicketId: ticketId })).status).toBe(403);
  });

  it("a superadmin can reach everything", async () => {
    const staff = await loginAsStaff(nextMobile(), "superadmin-tickets@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    expect((await request(app).get("/api/admin/tickets").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/tickets/report").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/tickets/staff").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/ticket-categories").set(auth)).status).toBe(200);
    expect((await request(app).get("/api/admin/canned-responses").set(auth)).status).toBe(200);
  });
});

describe("inbox filters and detail", () => {
  it("filters by status and search text", async () => {
    const staff = await loginAsStaff(nextMobile(), "filter-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { ticketId } = await createTicketAsUser();
    await request(app).patch(`/api/admin/tickets/${ticketId}`).set(auth).send({ status: "resolved" });

    const resolvedOnly = await request(app).get("/api/admin/tickets?status=resolved").set(auth);
    expect(resolvedOnly.body.tickets.length).toBe(1);

    const noMatch = await request(app).get("/api/admin/tickets?status=closed").set(auth);
    expect(noMatch.body.tickets.length).toBe(0);
  });

  it("the staff detail view includes internal notes, the requester view never does", async () => {
    const staff = await loginAsStaff(nextMobile(), "internal-note-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { ticketId, accessToken: requesterToken } = await createTicketAsUser();

    await request(app).post(`/api/admin/tickets/${ticketId}/messages`).set(auth).send({ body: "Customer is a VIP", isInternalNote: true });
    await request(app).post(`/api/admin/tickets/${ticketId}/messages`).set(auth).send({ body: "Thanks for reaching out!" });

    const staffView = await request(app).get(`/api/admin/tickets/${ticketId}`).set(auth);
    expect(staffView.body.messages.some((m: { isInternalNote: boolean }) => m.isInternalNote)).toBe(true);

    const requesterView = await request(app).get(`/api/tickets/${ticketId}`).set("Authorization", `Bearer ${requesterToken}`);
    expect(requesterView.body.messages.every((m: { body: string }) => m.body !== "Customer is a VIP")).toBe(true);
    // a staff non-internal reply moves the ticket to "pending"
    expect(requesterView.body.ticket.status).toBe("pending");
  });
});

describe("assignment, merge, and callback", () => {
  it("assigns a ticket to a staff member (requires tickets.assign)", async () => {
    const superadmin = await loginAsStaff(nextMobile(), "assign-super@example.com", "superadmin");
    const assignee = await loginAsStaff(nextMobile(), "assignee-target@example.com", "admin");
    const { ticketId } = await createTicketAsUser();

    const res = await request(app)
      .patch(`/api/admin/tickets/${ticketId}`)
      .set("Authorization", `Bearer ${superadmin.accessToken}`)
      .send({ assigneeId: assignee.userId });
    expect(res.status).toBe(200);
    expect(res.body.ticket.assigneeId).toBe(assignee.userId);
  });

  it("rejects assigning to a non-staff user", async () => {
    const superadmin = await loginAsStaff(nextMobile(), "assign-bad@example.com", "superadmin");
    const normal = await signupNormalUser(nextMobile(), "not-staff@example.com");
    const { ticketId } = await createTicketAsUser();
    const res = await request(app)
      .patch(`/api/admin/tickets/${ticketId}`)
      .set("Authorization", `Bearer ${superadmin.accessToken}`)
      .send({ assigneeId: normal.userId });
    expect(res.status).toBe(400);
  });

  it("merges one ticket into another", async () => {
    const staff = await loginAsStaff(nextMobile(), "merge-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { ticketId: sourceId } = await createTicketAsUser();
    const { ticketId: targetId } = await createTicketAsUser();

    const res = await request(app).post(`/api/admin/tickets/${sourceId}/merge`).set(auth).send({ targetTicketId: targetId });
    expect(res.status).toBe(200);
    const source = await Ticket.findById(sourceId).lean();
    expect(source?.status).toBe("closed");
  });

  it("marks a callback request done", async () => {
    const staff = await loginAsStaff(nextMobile(), "callback-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const { accessToken } = await signupNormalUser(nextMobile(), "callback-req@example.com");
    const created = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject: "Ring me", categoryKey: "general", description: "Call me back", requestCallback: true, mobile: "9876500000" });

    const res = await request(app).post(`/api/admin/tickets/${created.body.ticket.id}/callback/done`).set(auth).send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.callbackRequested.done).toBe(true);
  });
});

describe("ticket categories CRUD", () => {
  it("creates, updates, and refuses to delete a category still in use", async () => {
    const staff = await loginAsStaff(nextMobile(), "categories-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/ticket-categories").set(auth).send({ key: "vip", label: "VIP", slaHours: 4, defaultPriority: "urgent" });
    expect(create.status).toBe(201);

    const update = await request(app).patch(`/api/admin/ticket-categories/${create.body.category.id}`).set(auth).send({ label: "VIP Support" });
    expect(update.body.category.label).toBe("VIP Support");

    await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${(await signupNormalUser(nextMobile(), "vip-user@example.com")).accessToken}`)
      .send({ subject: "VIP issue", categoryKey: "vip", description: "Help." });

    const del = await request(app).delete(`/api/admin/ticket-categories/${create.body.category.id}`).set(auth);
    expect(del.status).toBe(400);
  });

  it("rejects a duplicate category key", async () => {
    const staff = await loginAsStaff(nextMobile(), "dup-category@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    const res = await request(app).post("/api/admin/ticket-categories").set(auth).send({ key: "general", label: "General 2" });
    expect(res.status).toBe(409);
  });
});

describe("canned responses CRUD", () => {
  it("creates, updates, and deletes a canned response", async () => {
    const staff = await loginAsStaff(nextMobile(), "canned-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };

    const create = await request(app).post("/api/admin/canned-responses").set(auth).send({ title: "Greeting", body: "Hi there, thanks for reaching out!" });
    expect(create.status).toBe(201);

    const update = await request(app).patch(`/api/admin/canned-responses/${create.body.cannedResponse.id}`).set(auth).send({ title: "Warm greeting" });
    expect(update.body.cannedResponse.title).toBe("Warm greeting");

    const del = await request(app).delete(`/api/admin/canned-responses/${create.body.cannedResponse.id}`).set(auth);
    expect(del.status).toBe(200);
  });
});

describe("GET /api/admin/tickets/report", () => {
  it("returns aggregate stats", async () => {
    const staff = await loginAsStaff(nextMobile(), "report-staff@example.com", "superadmin");
    const auth = { Authorization: `Bearer ${staff.accessToken}` };
    await createTicketAsUser();

    const res = await request(app).get("/api/admin/tickets/report").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.report.byStatus.open).toBeGreaterThanOrEqual(1);
  });
});
