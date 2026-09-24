import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConfigDraft } from "../config/useConfigDraft";
import { useSimulation } from "../config/useSimulation";
import LookthroughModel from "./LookthroughModel";

jest.mock("../config/useConfigDraft", () => ({ useConfigDraft: jest.fn() }));
jest.mock("../config/useSimulation", () => ({ useSimulation: jest.fn() }));

const PAYLOAD = {
  exactIssuerStrength: 1,
  sameSectorStrength: 0.3,
  sectoralMfAffinityStrength: 0.15,
  keywordSectorAffinity: [{ keywords: ["titan", "kalyan jewellers"], affinity: { GOLD: 0.25, SILVER: 0.15 } }],
  industryAssetClassAffinity: { Realty: { REIT: 0.3, INVIT: 0.15 } },
  mfSegmentToNseIndustry: { Realty: ["Realty"] },
  mutualFundTopHoldings: { hdfcflexicap: [{ company: "HDFC Bank", weightPct: 8.9 }] },
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

// The Look-Through / Connectedness model — explicitly deferred out of Phase 2
// of docs/ADMIN_PANEL_PLAN.md, built here as a fourth sibling to
// Scoring/Context/Suggestion Model. Structural pattern mirrors
// ContextModel.test.jsx exactly (shared useConfigDraft/useSimulation hooks,
// shared toolbar/publish/history/simulation components).
describe("LookthroughModel", () => {
  beforeEach(() => useSimulation.mockReturnValue(makeSimHookValue()));
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ loading: true }));
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-loading")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    useConfigDraft.mockReturnValue(makeHookValue({ error: "down" }));
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-error")).toBeInTheDocument();
  });

  it("renders the three tier-strength fields with their current values", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-strength-exactissuer")).toHaveValue(1);
    expect(screen.getByTestId("admin-lookthrough-strength-samesector")).toHaveValue(0.3);
    expect(screen.getByTestId("admin-lookthrough-strength-sectoralmf")).toHaveValue(0.15);
  });

  it("editing a tier strength calls setPayload with just that field updated", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.change(screen.getByTestId("admin-lookthrough-strength-samesector"), { target: { value: "0.25" } });
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, sameSectorStrength: 0.25 });
  });

  it("renders a keyword affinity group's keywords and lets them be edited", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-keyword-keywords-0")).toHaveValue("titan, kalyan jewellers");

    fireEvent.change(screen.getByTestId("admin-lookthrough-keyword-keywords-0"), { target: { value: "titan, joyalukkas" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      keywordSectorAffinity: [{ ...PAYLOAD.keywordSectorAffinity[0], keywords: ["titan", "joyalukkas"] }],
    });
  });

  it("editing a keyword group's affinity grid updates just that asset class", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.change(screen.getByTestId("admin-lookthrough-keyword-affinity-0-GOLD"), { target: { value: "0.4" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      keywordSectorAffinity: [{ ...PAYLOAD.keywordSectorAffinity[0], affinity: { ...PAYLOAD.keywordSectorAffinity[0].affinity, GOLD: 0.4 } }],
    });
  });

  it("adding a keyword group appends an empty entry", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-lookthrough-keyword-add"));
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      keywordSectorAffinity: [...PAYLOAD.keywordSectorAffinity, { keywords: [], affinity: {} }],
    });
  });

  it("removing a keyword group drops it from the list", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-lookthrough-keyword-remove-0"));
    expect(hook.setPayload).toHaveBeenCalledWith({ ...PAYLOAD, keywordSectorAffinity: [] });
  });

  it("renders an industry affinity entry and lets its key be renamed", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-industry-key-0")).toHaveValue("Realty");

    fireEvent.change(screen.getByTestId("admin-lookthrough-industry-key-0"), { target: { value: "Construction" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      industryAssetClassAffinity: { Construction: PAYLOAD.industryAssetClassAffinity.Realty },
    });
  });

  it("renders an MF segment mapping and lets its industries list be edited", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-mfsegment-industries-0")).toHaveValue("Realty");

    fireEvent.change(screen.getByTestId("admin-lookthrough-mfsegment-industries-0"), { target: { value: "Realty, Construction" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      mfSegmentToNseIndustry: { Realty: ["Realty", "Construction"] },
    });
  });

  it("renders a fund's holdings and lets a holding's weight be edited", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    expect(screen.getByTestId("admin-lookthrough-fund-0-company-0")).toHaveValue("HDFC Bank");

    fireEvent.change(screen.getByTestId("admin-lookthrough-fund-0-weight-0"), { target: { value: "9.5" } });
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      mutualFundTopHoldings: { hdfcflexicap: [{ company: "HDFC Bank", weightPct: 9.5 }] },
    });
  });

  it("adding a holding to a fund appends an empty row", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-lookthrough-fund-0-add-holding"));
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      mutualFundTopHoldings: { hdfcflexicap: [...PAYLOAD.mutualFundTopHoldings.hdfcflexicap, { company: "", weightPct: 0 }] },
    });
  });

  it("adding a fund appends a new empty-holdings entry", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-lookthrough-fund-add"));
    expect(hook.setPayload).toHaveBeenCalledWith({
      ...PAYLOAD,
      mutualFundTopHoldings: { ...PAYLOAD.mutualFundTopHoldings, newfund2: [] },
    });
  });

  it("publish flow calls publish with the change note", async () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-config-publish-toggle-btn"));
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "lower same-sector strength" } });
    fireEvent.click(screen.getByTestId("admin-config-publish-confirm-btn"));
    await waitFor(() => expect(hook.publish).toHaveBeenCalledWith("lower same-sector strength"));
  });

  it("toggling Simulate… opens the panel; Run calls runSimulation with the current payload", () => {
    useConfigDraft.mockReturnValue(makeHookValue());
    const simHook = makeSimHookValue();
    useSimulation.mockReturnValue(simHook);
    render(<LookthroughModel />);

    fireEvent.click(screen.getByTestId("admin-config-simulate-toggle-btn"));
    expect(screen.getByTestId("admin-config-simulation-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-config-simulation-run-btn"));
    expect(simHook.runSimulation).toHaveBeenCalledWith(PAYLOAD, 20); // default sample size
  });

  it("toggling History shows the history panel wired to rollback", () => {
    const hook = makeHookValue();
    useConfigDraft.mockReturnValue(hook);
    render(<LookthroughModel />);
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-rollback-btn-1"));
    expect(hook.rollback).toHaveBeenCalledWith(1);
  });
});
