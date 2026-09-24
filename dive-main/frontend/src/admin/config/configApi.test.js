import { api } from "../../lib/api";
import { configApiFor } from "./configApi";
import { setStepUpToken } from "./stepUp";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));

describe("configApiFor", () => {
  const base = "/admin/scoring-config";
  const cfg = configApiFor(base);

  afterEach(() => {
    jest.clearAllMocks();
    setStepUpToken(null);
  });

  it("getActive unwraps { payload }", async () => {
    api.get.mockResolvedValue({ data: { payload: { cryptoWithinClassCap: 70 } } });
    expect(await cfg.getActive()).toEqual({ cryptoWithinClassCap: 70 });
    expect(api.get).toHaveBeenCalledWith(`${base}/active`);
  });

  it("getDraft unwraps { draft }", async () => {
    api.get.mockResolvedValue({ data: { draft: { version: 2, status: "draft" } } });
    expect(await cfg.getDraft()).toEqual({ version: 2, status: "draft" });
    expect(api.get).toHaveBeenCalledWith(`${base}/draft`);
  });

  it("updateDraft PATCHes { payload } and unwraps { draft }", async () => {
    api.patch.mockResolvedValue({ data: { draft: { version: 2, payload: { a: 1 } } } });
    const result = await cfg.updateDraft({ a: 1 });
    expect(api.patch).toHaveBeenCalledWith(`${base}/draft`, { payload: { a: 1 } });
    expect(result).toEqual({ version: 2, payload: { a: 1 } });
  });

  it("validateDraft POSTs { payload } and returns the raw validation result", async () => {
    api.post.mockResolvedValue({ data: { valid: false, errors: ["bad"] } });
    const result = await cfg.validateDraft({ a: 1 });
    expect(api.post).toHaveBeenCalledWith(`${base}/draft/validate`, { payload: { a: 1 } });
    expect(result).toEqual({ valid: false, errors: ["bad"] });
  });

  it("getHistory unwraps { history }", async () => {
    api.get.mockResolvedValue({ data: { history: [{ version: 1 }] } });
    expect(await cfg.getHistory()).toEqual([{ version: 1 }]);
    expect(api.get).toHaveBeenCalledWith(`${base}/history`);
  });

  it("getVersion unwraps { version }", async () => {
    api.get.mockResolvedValue({ data: { version: { version: 3 } } });
    expect(await cfg.getVersion(3)).toEqual({ version: 3 });
    expect(api.get).toHaveBeenCalledWith(`${base}/versions/3`);
  });

  it("publish attaches the cached step-up token as a header by default", async () => {
    setStepUpToken("cached-token");
    api.post.mockResolvedValue({ data: { version: { version: 4, status: "active" } } });
    const result = await cfg.publish("a change");
    expect(api.post).toHaveBeenCalledWith(`${base}/publish`, { changeNote: "a change" }, { headers: { "x-step-up-token": "cached-token" } });
    expect(result).toEqual({ version: 4, status: "active" });
  });

  it("publish uses an explicitly-passed step-up token over the cached one", async () => {
    setStepUpToken("cached-token");
    api.post.mockResolvedValue({ data: { version: { version: 4 } } });
    await cfg.publish("a change", "fresh-token");
    expect(api.post).toHaveBeenCalledWith(`${base}/publish`, { changeNote: "a change" }, { headers: { "x-step-up-token": "fresh-token" } });
  });

  it("rollback attaches the step-up token as a header", async () => {
    api.post.mockResolvedValue({ data: { version: { version: 5 } } });
    await cfg.rollback(3, "fresh-token");
    expect(api.post).toHaveBeenCalledWith(`${base}/rollback`, { targetVersion: 3 }, { headers: { "x-step-up-token": "fresh-token" } });
  });

  it("simulate POSTs { payload, sampleSize } and returns the raw result", async () => {
    api.post.mockResolvedValue({ data: { sampleSize: 5, avgDelta: -2.1 } });
    const result = await cfg.simulate({ cryptoWithinClassCap: 40 }, 5);
    expect(api.post).toHaveBeenCalledWith(`${base}/simulate`, { payload: { cryptoWithinClassCap: 40 }, sampleSize: 5 });
    expect(result).toEqual({ sampleSize: 5, avgDelta: -2.1 });
  });
});
