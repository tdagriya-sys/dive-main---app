import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

// GET /api/share/:score — the actual destination behind ShareCard.jsx's
// "Share"/"Copy link" buttons. Before this route existed, every one of
// those links 404'd (see shareController.ts's top comment) — these tests
// guard against that regressing, and specifically against the reflected-XSS
// hole a naive fix could reintroduce (the sharer's own display name is
// attacker-controllable query text reflected straight into HTML).
describe("GET /api/share/:score — public share-card page", () => {
  it("requires no auth and returns a real HTML page, not a 404", async () => {
    const res = await request(app).get("/api/share/72");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).not.toContain("NOT_FOUND");
  });

  it("bakes the real score, name, and top-exposure % into both the visible page and the OG/Twitter preview meta tags", async () => {
    const res = await request(app).get("/api/share/72").query({ u: "Priya", top: "42" });
    expect(res.status).toBe(200);

    // Visible page content
    expect(res.text).toContain("72");
    expect(res.text).toContain("Priya");
    expect(res.text).toContain("42%");

    // Rich-preview metadata — this is what actually renders in WhatsApp/
    // iMessage/Slack/X when the link is shared, independent of whether the
    // page is ever opened directly.
    expect(res.text).toMatch(/<meta property="og:title" content="[^"]*Priya[^"]*72\/100[^"]*"/);
    expect(res.text).toMatch(/<meta property="og:description" content="[^"]*42%[^"]*"/);
    expect(res.text).toContain('<meta name="twitter:card" content="summary"');
  });

  it("escapes a malicious name instead of reflecting it as raw HTML — reflected-XSS guard", async () => {
    const res = await request(app).get("/api/share/50").query({ u: '<script>alert(1)</script>' });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("degrades gracefully instead of crashing on a garbage score", async () => {
    const res = await request(app).get("/api/share/not-a-number");
    expect(res.status).toBe(200);
    expect(res.text).toContain(">0<"); // clamped to 0, not a 500
  });

  it("clamps an out-of-range score into 0-100", async () => {
    const tooHigh = await request(app).get("/api/share/9999");
    expect(tooHigh.status).toBe(200);
    expect(tooHigh.text).toContain(">100<");

    const negative = await request(app).get("/api/share/-30");
    expect(negative.status).toBe(200);
    expect(negative.text).toContain(">0<");
  });

  it("falls back to a generic name when none is given", async () => {
    const res = await request(app).get("/api/share/60");
    expect(res.status).toBe(200);
    expect(res.text).toContain("A DIVVE user");
  });

  it("links its call-to-action at the real app, not back at itself", async () => {
    const res = await request(app).get("/api/share/60");
    expect(res.text).toContain('href="http://localhost:3000"');
  });
});
