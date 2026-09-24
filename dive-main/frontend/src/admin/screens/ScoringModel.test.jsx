import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import ScoringModel from "./ScoringModel";

jest.mock("../config/useConfigDraft", () => ({ useConfigDraft: jest.fn() }));
jest.mock("../config/useSimulation", () => ({ useSimulation: jest.fn() }));

const PAYLOAD = {
  compositeWeights: { concentration: 0.17, volatility: 0.12, drawdown: 0.12, var: 0.08, liquidity: 0.12, beta: 0.08, correlation: 0.08, diversificationRatio: 0.04, contextFit: 0.11, stockCountFit: 0.08 },
  subScoreBestAt: { volatilityBestAt: 0.03, drawdownBestAt: -0.02, varWorstAt: -0.08, varBestAt: -0.005, betaWorstAt: 1.8, betaBestAt: 0.2, correlationWorstAt: 1, correlationBestAt: -0.2, diversificationRatioWorstAt: 1, diversificationRatioBestAt: 2.2 },
  concentrationSubWeights: { apparent: 0.5, real: 0.15, name: 0.2, withinClass: 0.15 },
  liquidityTiers: { CRYPTO: 95, EQUITY: 95, ETF: 90, MUTUAL_FUND: 70, GOLD: 75, SILVER: 65, REIT: 60, INVIT: 55, BOND: 50, ULIP_INSURANCE: 20, FD: 15, PF: 8 },
  stockCountBreakpoints: [[1, 10], [3, 25]],
  cryptoWithinClassCap: 70,
  equitySectorSpreadTarget: 5,
  singleClassCorrelationScores: { whenExpectedClassesLE1: 50, otherwise: 20 },
  drawdownUnrecoveredPenalty: 15,
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

describe("ScoringModel", () => {
  beforeEach(() => useSimulation.mockReturnValue(makeSimHookValue()));
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ loading: true }));
    render(<ScoringModel />);
    expect(screen.getByTestId("admin-scoring-loading")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ error: "down" }));
    render(<ScoringModel />);
    expect(screen.getByTestId("admin-scoring-error")).toBeInTheDocument();
  });

  it("renders the composite weight sum", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<ScoringModel />);
    expect(screen.getByTestId("admin-scoring-weight-concentration")).toHaveValue(0.17);
    // Both the composite-weights AND concentration-sub-weights sections sum
    // to 1.000 with these fixture values, so two matches are expected.
    expect(screen.getAllByText("sum: 1.000")).toHaveLength(2);
  });

  it("flags a composite weight sum that doesn't add to 1", () => {
    const hook = makeHookValue({ payload: { ...PAYLOAD, compositeWeights: { ...PAYLOAD.compositeWeights, concentration: 0.5 } } });
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    expect(screen.getByText("sum: 1.330")).toBeInTheDocument();
  });

  it("editing a composite weight calls setPayload with the updated payload", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.change(screen.getByTestId("admin-scoring-weight-concentration"), { target: { value: "0.2" } });
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, compositeWeights: { ...PAYLOAD.compositeWeights, concentration: 0.2 } });
  });

  it("editing a liquidity tier calls setPayload with the updated payload", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.change(screen.getByTestId("admin-scoring-liquidity-FD"), { target: { value: "25" } });
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, liquidityTiers: { ...PAYLOAD.liquidityTiers, FD: 25 } });
  });

  it("adding a stock-count breakpoint appends a row", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-scoring-breakpoint-add"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, stockCountBreakpoints: [[1, 10], [3, 25], [0, 0]] });
  });

  it("removing a stock-count breakpoint drops that row", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-scoring-breakpoint-remove-0"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, stockCountBreakpoints: [[3, 25]] });
  });

  it("Save draft calls saveDraft", () => {
    const hook = makeHookValue({ dirty: true });
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-config-save-btn"));
    expect(hook.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("publishing: toggling Publish… opens the panel and confirming calls publish with the change note", async () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-config-publish-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "lower the crypto cap" } });
    fireEvent.click(screen.getByTestId("admin-config-publish-confirm-btn"));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledWith("lower the crypto cap"));
  });

  it("toggling History shows the history panel wired to rollback", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    expect(screen.getByTestId("admin-config-history")).toBeInTheDocument();
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
    render(<ScoringModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
    fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));
    await waitFor(() => expect(hook.getVersion).toHaveBeenCalledWith(1));
    expect(hook.getVersion).toHaveBeenCalledWith(2);
  });

  it("toggling Simulate… opens the panel; Run calls runSimulation with the current payload", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    const simHook = makeSimHookValue();
    useSimulation.mockReturnValue(simHook);
    render(<ScoringModel />);

    fireEvent.click(screen.getByTestId("admin-config-simulate-toggle-btn"));
    expect(screen.getByTestId("admin-config-simulation-panel")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("admin-config-simulation-samplesize-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("admin-config-simulation-run-btn"));
    expect(simHook.runSimulation).toHaveBeenCalledWith(PAYLOAD, 10);
  });

  it("closing the simulation panel clears the result", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    const simHook = makeSimHookValue({ result: { sampleSize: 5 } });
    useSimulation.mockReturnValue(simHook);
    render(<ScoringModel />);

    fireEvent.click(screen.getByTestId("admin-config-simulate-toggle-btn")); // open
    fireEvent.click(screen.getByTestId("admin-config-simulation-cancel-btn")); // close via the panel's own Close button
    expect(simHook.clearResult).toHaveBeenCalled();
  });

  it("shows the step-up modal when the hook says it's open", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ stepUpModalOpen: true }));
    render(<ScoringModel />);
    expect(screen.getByTestId("admin-stepup-modal")).toBeInTheDocument();
  });
});
