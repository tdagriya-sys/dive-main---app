import request from "supertest";
import { createApp } from "../src/app";
import { ContactSubmission } from "../src/models/ContactSubmission";

const app = createApp();

const validPayload = {
  name: "Test User",
  email: "test@example.com",
  mobile: "9876543210",
  subject: "Question about pricing",
  description: "Just checking things out, wanted to ask a quick question.",
  timeSlot: "Morning · 9 AM – 12 PM",
};

describe("contact", () => {
  it("saves a valid contact submission to the database", async () => {
    const res = await request(app).post("/api/contact").send(validPayload);
    expect(res.status).toBe(201);

    const saved = await ContactSubmission.findOne({ email: "test@example.com" });
    expect(saved).toBeTruthy();
    expect(saved?.name).toBe("Test User");
    expect(saved?.mobile).toBe("9876543210");
    expect(saved?.subject).toBe("Question about pricing");
    expect(saved?.timeSlot).toBe("Morning · 9 AM – 12 PM");
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

  it("accepts a submission with no subject, defaulting it to an empty string", async () => {
    const { subject, ...rest } = validPayload;
    const res = await request(app).post("/api/contact").send(rest);
    expect(res.status).toBe(201);

    const saved = await ContactSubmission.findOne({ email: "test@example.com" });
    expect(saved?.subject).toBe("");
  });
});
