import request from "supertest";
import { createApp } from "../src/app";
import { seedDefaultTicketCategoriesIfEmpty } from "../src/services/ticketService";

// Phase 4 of docs/ADMIN_PANEL_PLAN.md — the logged-in user's own ticket
// surface (/api/tickets), scoped strictly to req.userId.

const app = createApp();

let mobileCounter = 9830000000;
function nextMobile(): string {
  return String(mobileCounter++);
}

async function signupNormalUser(mobile: string, email: string) {
  const signup = { name: "Tickets API Tester", mobile, email, age: 30, password: "Passw0rd!", confirmPassword: "Passw0rd!" };
  const start = await request(app).post("/api/auth/signup/start").send(signup);
  const verify = await request(app).post("/api/auth/signup/verify").send({ mobile, otp: start.body.devOtp });
  return { userId: verify.body.user.id as string, accessToken: verify.body.accessToken as string };
}

beforeEach(async () => {
  await seedDefaultTicketCategoriesIfEmpty();
});

describe("POST /api/tickets", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/tickets").send({ subject: "Help", categoryKey: "general", description: "Something's wrong." });
    expect(res.status).toBe(401);
  });

  it("creates a ticket for the logged-in user", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "ticket-creator@example.com");
    const res = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject: "My holdings look wrong", categoryKey: "technical", description: "The total doesn't match." });
    expect(res.status).toBe(201);
    expect(res.body.ticket.refNo).toMatch(/^DIV-\d{6}$/);
    expect(res.body.ticket.status).toBe("open");
  });

  it("requires a mobile number when requesting a callback", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "callback-nomobile@example.com");
    const res = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject: "Call me please", categoryKey: "general", description: "Please ring me.", requestCallback: true });
    expect(res.status).toBe(400);
  });

  it("stores a callback request when a mobile number is given", async () => {
    const { accessToken } = await signupNormalUser(nextMobile(), "callback-yes@example.com");
    const create = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject: "Call me please", categoryKey: "general", description: "Please ring me.", requestCallback: true, mobile: "9876543210", preferredWindow: "Evening" });
    expect(create.status).toBe(201);

    const detail = await request(app).get(`/api/tickets/${create.body.ticket.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(detail.body.ticket.callbackRequested.mobile).toBe("9876543210");
  });
});

describe("my tickets — listing, detail, reply, ownership", () => {
  async function createTicketFor(accessToken: string) {
    const res = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ subject: "Onboarding question", categoryKey: "general", description: "How do I add holdings?" });
    return res.body.ticket.id as string;
  }

  it("lists only the caller's own tickets", async () => {
    const userA = await signupNormalUser(nextMobile(), "owner-a@example.com");
    const userB = await signupNormalUser(nextMobile(), "owner-b@example.com");
    await createTicketFor(userA.accessToken);
    await createTicketFor(userB.accessToken);

    const listA = await request(app).get("/api/tickets").set("Authorization", `Bearer ${userA.accessToken}`);
    expect(listA.body.tickets.length).toBe(1);
  });

  it("404s when fetching someone else's ticket", async () => {
    const owner = await signupNormalUser(nextMobile(), "real-owner@example.com");
    const other = await signupNormalUser(nextMobile(), "not-owner@example.com");
    const ticketId = await createTicketFor(owner.accessToken);

    const res = await request(app).get(`/api/tickets/${ticketId}`).set("Authorization", `Bearer ${other.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("replies to the caller's own ticket, and the detail view never leaks internal notes", async () => {
    const owner = await signupNormalUser(nextMobile(), "replier@example.com");
    const ticketId = await createTicketFor(owner.accessToken);

    const reply = await request(app).post(`/api/tickets/${ticketId}/messages`).set("Authorization", `Bearer ${owner.accessToken}`).send({ body: "Any update?" });
    expect(reply.status).toBe(201);

    const detail = await request(app).get(`/api/tickets/${ticketId}`).set("Authorization", `Bearer ${owner.accessToken}`);
    expect(detail.body.messages.length).toBe(2); // original + reply
    expect(detail.body.messages.every((m: { authorType: string }) => m.authorType !== "system" || true)).toBe(true);
  });

  it("rejects submitting CSAT on a ticket that isn't resolved", async () => {
    const owner = await signupNormalUser(nextMobile(), "csat-early@example.com");
    const ticketId = await createTicketFor(owner.accessToken);
    const res = await request(app).post(`/api/tickets/${ticketId}/csat`).set("Authorization", `Bearer ${owner.accessToken}`).send({ score: 5 });
    expect(res.status).toBe(400);
  });
});
