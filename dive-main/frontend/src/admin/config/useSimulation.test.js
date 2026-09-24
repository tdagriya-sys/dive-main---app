import { renderHook, act, waitFor } from "@testing-library/react";
import { useSimulation } from "./useSimulation";
import { configApiFor } from "./configApi";

jest.mock("./configApi", () => ({ configApiFor: jest.fn() }));

describe("useSimulation", () => {
  afterEach(() => jest.clearAllMocks());

  it("runs a simulation and stores the result", async () => {
    const simulate = jest.fn().mockResolvedValue({ sampleSize: 5, avgDelta: -1.2 });
    configApiFor.mockReturnValue({ simulate });
    const { result } = renderHook(() => useSimulation("/admin/scoring-config"));

    await act(async () => {
      await result.current.runSimulation({ cryptoWithinClassCap: 40 }, 5);
    });

    expect(simulate).toHaveBeenCalledWith({ cryptoWithinClassCap: 40 }, 5);
    expect(result.current.result).toEqual({ sampleSize: 5, avgDelta: -1.2 });
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("sets running true while in flight", async () => {
    let resolvePromise;
    const simulate = jest.fn(() => new Promise((resolve) => (resolvePromise = resolve)));
    configApiFor.mockReturnValue({ simulate });
    const { result } = renderHook(() => useSimulation("/admin/scoring-config"));

    let runPromise;
    act(() => {
      runPromise = result.current.runSimulation({}, 5);
    });
    await waitFor(() => expect(result.current.running).toBe(true));

    await act(async () => {
      resolvePromise({ sampleSize: 0 });
      await runPromise;
    });
    expect(result.current.running).toBe(false);
  });

  it("sets an error message and clears any stale result on failure", async () => {
    const simulate = jest.fn().mockRejectedValue(new Error("down"));
    configApiFor.mockReturnValue({ simulate });
    const { result } = renderHook(() => useSimulation("/admin/scoring-config"));

    await act(async () => {
      await result.current.runSimulation({}, 5);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.result).toBeNull();
  });

  it("clearResult resets both result and error", async () => {
    const simulate = jest.fn().mockResolvedValue({ sampleSize: 1 });
    configApiFor.mockReturnValue({ simulate });
    const { result } = renderHook(() => useSimulation("/admin/scoring-config"));

    await act(async () => {
      await result.current.runSimulation({}, 5);
    });
    expect(result.current.result).toBeTruthy();

    act(() => result.current.clearResult());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe("");
  });
});
