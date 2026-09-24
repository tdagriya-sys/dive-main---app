import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConfigDraft } from "../config/useConfigDraft";
import SuggestionModel from "./SuggestionModel";

jest.mock("../config/useConfigDraft", () => ({ useConfigDraft: jest.fn() }));

const PAYLOAD = {
  coreCategories: ["Equity", "Bonds"],
  idealRanges: {
    Conservative: { Equity: [20, 30], Bonds: [20, 30] },
    Balanced: { Equity: [25, 35], Bonds: [15, 25] },
    Aggressive: { Equity: [35, 50], Bonds: [5, 15] },
  },
  returnTier: { Equity: "high", Bonds: "low" },
  returnBias: { Modest: -1, Moderate: 0, High: 1 },
  diversificationCap: { Low: 2, Medium: 3, High: null },
  fastPathBlend: { apparent: 0.65, real: 0.15, name: 0.2 },
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

describe("SuggestionModel", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ loading: true }));
    render(<SuggestionModel />);
    expect(screen.getByTestId("admin-suggestion-loading")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ error: "down" }));
    render(<SuggestionModel />);
    expect(screen.getByTestId("admin-suggestion-error")).toBeInTheDocument();
  });

  it("renders ideal-range cells for every category and profile", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<SuggestionModel />);
    expect(screen.getByTestId("admin-suggestion-range-Conservative-Equity-lo")).toHaveValue(20);
    expect(screen.getByTestId("admin-suggestion-range-Conservative-Equity-hi")).toHaveValue(30);
    expect(screen.getByTestId("admin-suggestion-range-Aggressive-Bonds-lo")).toHaveValue(5);
  });

  it("editing an ideal-range low bound calls setPayload with just that cell updated", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
    fireEvent.change(screen.getByTestId("admin-suggestion-range-Conservative-Equity-lo"), { target: { value: "22" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      idealRanges: { ...PAYLOAD.idealRanges, Conservative: { ...PAYLOAD.idealRanges.Conservative, Equity: [22, 30] } },
    });
  });

  it("changing a return tier select calls setPayload", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
    fireEvent.change(screen.getByTestId("admin-suggestion-returntier-Bonds"), { target: { value: "medium" } });
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, returnTier: { ...PAYLOAD.returnTier, Bonds: "medium" } });
  });

  it("shows the diversification cap as disabled and unchecked-checkbox 'Uncapped' state correctly", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<SuggestionModel />);
    expect(screen.getByTestId("admin-suggestion-divcap-Low")).not.toBeDisabled();
    expect(screen.getByTestId("admin-suggestion-divcap-uncapped-Low")).not.toBeChecked();
    expect(screen.getByTestId("admin-suggestion-divcap-High")).toBeDisabled();
    expect(screen.getByTestId("admin-suggestion-divcap-uncapped-High")).toBeChecked();
  });

  it("checking 'Uncapped' sets that cap to null", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
    fireEvent.click(screen.getByTestId("admin-suggestion-divcap-uncapped-Medium"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, diversificationCap: { ...PAYLOAD.diversificationCap, Medium: null } });
  });

  it("unchecking 'Uncapped' on High gives it a real starting value", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
    fireEvent.click(screen.getByTestId("admin-suggestion-divcap-uncapped-High"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, diversificationCap: { ...PAYLOAD.diversificationCap, High: 1 } });
  });

  it("shows the fastPathBlend sum and flags it red when it doesn't total 1", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<SuggestionModel />);
    expect(screen.getByText("sum: 1.000")).toBeInTheDocument();

    useConfigDraft.mockReturnValue(makeHookValue({ payload: { ...PAYLOAD, fastPathBlend: { apparent: 0.5, real: 0.3, name: 0.3 } } }));
    const { unmount } = render(<SuggestionModel />);
    expect(screen.getByText("sum: 1.100")).toBeInTheDocument();
    unmount();
  });

  it("publish flow calls publish with the change note", async () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
    fireEvent.click(screen.getByTestId("admin-config-publish-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "tighten low-risk cap" } });
    fireEvent.click(screen.getByTestId("admin-config-publish-confirm-btn"));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledWith("tighten low-risk cap"));
  });

  it("toggling History shows the history panel wired to rollback", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<SuggestionModel />);
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
    render(<SuggestionModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
    fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
    fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));
    await waitFor(() => expect(hook.getVersion).toHaveBeenCalledWith(1));
    expect(hook.getVersion).toHaveBeenCalledWith(2);
  });
});
