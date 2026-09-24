import request from "supertest";
import { createApp } from "../src/app";

// Phase 0.2 of docs/ADMIN_PANEL_PLAN.md — GET /api/health now also reports
// Redis status (never gates the 200/503, since nothing user-facing depends on
// Redis yet — see app.ts's own comment).
describe("GET /api/health", () => {
  it("reports db connected and redis not_configured in the test environment", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "connected", redis: "not_configured" });
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });
});
