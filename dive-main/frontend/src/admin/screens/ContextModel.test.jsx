import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import ContextModel from "./ContextModel";

jest.mock("../config/useConfigDraft", () => ({ useConfigDraft: jest.fn() }));
jest.mock("../config/useSimulation", () => ({ useSimulation: jest.fn() }));

const PAYLOAD = {
  corpusTiers: [
    { id: "starter", label: "Starter", maxAmount: 25000, expectedClassCount: 1, reasoning: "small" },
    { id: "large", label: "Large", maxAmount: 9007199254740991, expectedClassCount: 12, reasoning: "big" },
  ],
  personaBrackets: [
    { id: "earlyCareer", label: "Early Career", minAge: 18, maxAge: 28, priorityClasses: [], deprioritizedClasses: [], volatilityWorstAt: 0.55, drawdownWorstAt: -0.7, reasoning: "young" },
    { id: "retired", label: "Retired/Senior", minAge: 65, maxAge: null, priorityClasses: [], deprioritizedClasses: [], volatilityWorstAt: 0.28, drawdownWorstAt: -0.35, reasoning: "old" },
  ],
  defaultClassOrder: ["EQUITY", "MUTUAL_FUND", "GOLD"],
};

function makeHookValue(overrides = {}) {
  return {
    draft: { version: 2 },
    payload: PAYLOAD,
    setPayload: jest.fn(),
    history: [{ version: 1, status: "archived", changeNote: "v1" }],
    activeEntry: { version: 1 },
    validation: { valid: true, errors: [] },
    loading: false,
    error: "",
    saving: false,
    publishing: false,
    dirty: false,
    saveDraft: jest.fn(),
    publish: jest.fn().mockResolvedValue({}),
    rollback: jest.fn().mockResolvedValue({}),
    stepUpModalOpen: false,
    resolveStepUp: jest.fn(),
    cancelStepUp: jest.fn(),
    getVersion: jest.fn().mockResolvedValue({ payload: {} }),
    ...overrides,
  };
}

function makeSimHookValue(overrides = {}) {
  return {
    result: null,
    running: false,
    error: "",
    runSimulation: jest.fn().mockResolvedValue({ sampleSize: 0 }),
    clearResult: jest.fn(),
    ...overrides,
  };
}

describe("ContextModel", () => {
  beforeEach(() => useSimulation.mockReturnValue(makeSimHookValue()));
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ loading: true }));
    render(<ContextModel />);
    expect(screen.getByTestId("admin-context-loading")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ error: "down" }));
    render(<ContextModel />);
    expect(screen.getByTestId("admin-context-error")).toBeInTheDocument();
  });

  it("renders corpus tiers and persona brackets by label", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<ContextModel />);
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.getByText("Early Career")).toBeInTheDocument();
    expect(screen.getByText("Retired/Senior")).toBeInTheDocument();
  });

  it("editing a corpus tier's max amount calls setPayload with the updated tier only", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.change(screen.getByTestId("admin-context-tier-maxamount-0"), { target: { value: "30000" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      corpusTiers: [{ ...PAYLOAD.corpusTiers[0], maxAmount: 30000 }, PAYLOAD.corpusTiers[1]],
    });
  });

  it("shows 'No upper bound' for a persona bracket with maxAge null, instead of a number input", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<ContextModel />);
    expect(screen.getByText("No upper bound")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-context-persona-maxage-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-context-persona-maxage-0")).toHaveValue(28);
  });

  it("editing a persona bracket's volatilityWorstAt calls setPayload with just that bracket updated", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.change(screen.getByTestId("admin-context-persona-volworstat-0"), { target: { value: "0.6" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      personaBrackets: [{ ...PAYLOAD.personaBrackets[0], volatilityWorstAt: 0.6 }, PAYLOAD.personaBrackets[1]],
    });
  });

  it("moving a class down in the default order swaps it with the next one", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.click(screen.getByTestId("admin-context-order-down-EQUITY"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, defaultClassOrder: ["MUTUAL_FUND", "EQUITY", "GOLD"] });
  });

  it("disables the up-arrow for the first item and the down-arrow for the last", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<ContextModel />);
    expect(screen.getByTestId("admin-context-order-up-EQUITY")).toBeDisabled();
    expect(screen.getByTestId("admin-context-order-down-GOLD")).toBeDisabled();
  });

  it("publish flow calls publish with the change note", async () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.click(screen.getByTestId("admin-config-publish-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "reorder classes" } });
    fireEvent.click(screen.getByTestId("admin-config-publish-confirm-btn"));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledWith("reorder classes"));
  });

  it("toggling Simulate… opens the panel; Run calls runSimulation with the current payload", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    const simHook = makeSimHookValue();
    useSimulation.mockReturnValue(simHook);
    render(<ContextModel />);

    fireEvent.click(screen.getByTestId("admin-config-simulate-toggle-btn"));
    expect(screen.getByTestId("admin-config-simulation-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-config-simulation-run-btn"));
    expect(simHook.runSimulation).toHaveBeenCalledWith(PAYLOAD, 20); // default sample size
  });

  it("toggling History shows the history panel wired to rollback", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-rollback-btn-1"));
    expect(hook.rollback).toHaveBeenCalledWith(1);
  });

  it("wires the hook's getVersion into the history panel's version-diff view", async () => {
    const twoVersionHistory = [
      { version: 2, status: "active", changeNote: "v2" },
      { version: 1, status: "archived", changeNote: "v1" },
    ];
    const hook = makeHookValue({ history: twoVersionHistory });
    useConfigDraft.mockReturnValue(hook);
    render(<ContextModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
    fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));
    await waitFor(() => expect(hook.getVersion).toHaveBeenCalledWith(1));
    expect(hook.getVersion).toHaveBeenCalledWith(2);
  });
});
