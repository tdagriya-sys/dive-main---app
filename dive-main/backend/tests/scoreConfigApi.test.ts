import request from "supertest";
import { createApp } from "../src/app";
import { CONTEXT_CONFIG_DEFAULTS } from "../src/config/contextDefaults";
import { SUGGESTION_CONFIG_DEFAULTS } from "../src/config/suggestionDefaults";

// Phase 2 of docs/ADMIN_PANEL_PLAN.md — the public, cacheable endpoint the
// frontend's offline fast-path engines (diveEngine.js/contextMessaging.js)
// use to pick up an admin-published Context/Suggestion config instead of
// only ever falling back to their bundled literal defaults.

const app = createApp();

describe("GET /api/score/config", () => {
  it("requires no authentication", async () => {
    const res = await request(app).get("/api/score/config");
    expect(res.status).toBe(200);
  });

  it("returns the built-in context and suggestion defaults when nothing has been published", async () => {
    const res = await request(app).get("/api/score/config");
    expect(res.body.context).toEqual(CONTEXT_CONFIG_DEFAULTS);
    expect(res.body.suggestion).toEqual(SUGGESTION_CONFIG_DEFAULTS);
  });

  it("never includes scoring config — that surface stays backend-only", async () => {
    const res = await request(app).get("/api/score/config");
    expect(Object.keys(res.body).sort()).toEqual(["context", "suggestion"]);
  });

  it("sets a public, cacheable Cache-Control header", async () => {
    const res = await request(app).get("/api/score/config");
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
  });
});
