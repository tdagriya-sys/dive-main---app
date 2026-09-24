import { renderHook, act, waitFor } from "@testing-library/react";
import { useConfigDraft } from "./useConfigDraft";
import { configApiFor } from "./configApi";

jest.mock("./configApi", () => ({ configApiFor: jest.fn() }));

function makeMockApi(overrides = {}) {
  return {
    getDraft: jest.fn().mockResolvedValue({ version: 2, status: "draft", payload: { a: 1 } }),
    getHistory: jest.fn().mockResolvedValue([{ version: 1, status: "active", changeNote: "v1" }]),
    updateDraft: jest.fn().mockResolvedValue({ version: 2, status: "draft", payload: { a: 2 } }),
    validateDraft: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    publish: jest.fn().mockResolvedValue({ version: 2, status: "active" }),
    rollback: jest.fn().mockResolvedValue({ version: 3, status: "active" }),
    getVersion: jest.fn().mockResolvedValue({ version: 1, payload: { a: 1 } }),
    ...overrides,
  };
}

describe("useConfigDraft", () => {
  afterEach(() => jest.clearAllMocks());

  it("loads the draft and history on mount", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);

    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.draft).toEqual({ version: 2, status: "draft", payload: { a: 1 } });
    expect(result.current.payload).toEqual({ a: 1 });
    expect(result.current.activeEntry).toEqual({ version: 1, status: "active", changeNote: "v1" });
    expect(result.current.dirty).toBe(false);
  });

  it("forwards getVersion from the underlying configApi, for HistoryPanel's version-diff view", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);
    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getVersion).toBe(api.getVersion);
  });

  it("reports an error state when loading fails", async () => {
    const api = makeMockApi({ getDraft: jest.fn().mockRejectedValue(new Error("down")) });
    configApiFor.mockReturnValue(api);

    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it("marks dirty once the local payload diverges from the saved draft, and runs live validation", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);
    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPayload({ a: 2 }));
    expect(result.current.dirty).toBe(true);

    await waitFor(() => expect(api.validateDraft).toHaveBeenCalledWith({ a: 2 }), { timeout: 2000 });
  });

  it("saveDraft persists the local payload and clears dirty state", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);
    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPayload({ a: 2 }));
    await act(async () => {
      await result.current.saveDraft();
    });

    expect(api.updateDraft).toHaveBeenCalledWith({ a: 2 });
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft.payload).toEqual({ a: 2 });
  });

  it("publish saves first when dirty, then publishes and reloads", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);
    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPayload({ a: 2 }));
    await act(async () => {
      await result.current.publish("a change note");
    });

    expect(api.updateDraft).toHaveBeenCalledWith({ a: 2 }); // auto-saved before publish
    expect(api.publish).toHaveBeenCalledWith("a change note", undefined);
    expect(api.getDraft).toHaveBeenCalledTimes(2); // initial load + post-publish reload
  });

  it("publish opens the step-up flow when the backend requires it, then retries with the obtained token", async () => {
    const stepUpError = { response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } };
    const publish = jest.fn().mockRejectedValueOnce(stepUpError).mockResolvedValueOnce({ version: 2, status: "active" });
    const api = makeMockApi({ publish });
    configApiFor.mockReturnValue(api);

    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let publishPromise;
    act(() => {
      publishPromise = result.current.publish("needs step-up");
    });

    await waitFor(() => expect(result.current.stepUpModalOpen).toBe(true));

    act(() => result.current.resolveStepUp("fresh-token"));
    await act(async () => {
      await publishPromise;
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(2, "needs step-up", "fresh-token");
    expect(result.current.stepUpModalOpen).toBe(false);
  });

  it("cancelling the step-up modal rejects the pending publish", async () => {
    const stepUpError = { response: { status: 401, data: { error: "STEP_UP_REQUIRED" } } };
    const api = makeMockApi({ publish: jest.fn().mockRejectedValue(stepUpError) });
    configApiFor.mockReturnValue(api);

    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let publishPromise;
    act(() => {
      publishPromise = result.current.publish("won't finish").catch((e) => e);
    });
    await waitFor(() => expect(result.current.stepUpModalOpen).toBe(true));

    let rejection;
    await act(async () => {
      result.current.cancelStepUp();
      rejection = await publishPromise;
    });
    expect(rejection).toBeTruthy();
    expect(result.current.stepUpModalOpen).toBe(false);
  });

  it("rollback runs the step-up-gated call and reloads on success", async () => {
    const api = makeMockApi();
    configApiFor.mockReturnValue(api);
    const { result } = renderHook(() => useConfigDraft("/admin/scoring-config"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rollback(1);
    });

    expect(api.rollback).toHaveBeenCalledWith(1, undefined);
    expect(api.getHistory).toHaveBeenCalledTimes(2); // initial load + post-rollback reload
  });
});
