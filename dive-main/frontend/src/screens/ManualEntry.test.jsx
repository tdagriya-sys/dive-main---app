import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManualEntry from "./ManualEntry";
import { api } from "../lib/api";
import { useDive } from "../context/DiveContext";
import { PF_DECLARED_RATES } from "../lib/diveEngine";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("../context/DiveContext", () => ({
  useDive: jest.fn(),
}));

// PF (Provident Fund — PPF/EPF/VPF) is the newest of ManualEntry's special-
// cased asset classes, mirroring FD's own "distinct field set, not a plain
// instrument+value form" pattern (see holdings.ts's pfSchema/fdSchema on the
// backend). These tests exercise that path directly rather than assuming
// FD's existing coverage (there is none in this file — no prior test file
// existed for ManualEntry.jsx) generalizes to it.
describe("ManualEntry — PF (Provident Fund)", () => {
  const baseContext = {
    setScreen: jest.fn(),
    goBack: jest.fn(),
    loadHoldings: jest.fn().mockResolvedValue([]),
    updateHolding: jest.fn(),
    holdings: [],
    editingHolding: null,
    setEditingHolding: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue(baseContext);
  });

  it("shows the PF asset-class option and switches to PF-specific fields when selected", async () => {
    const user = userEvent.setup();
    render(<ManualEntry />);

    expect(screen.getByTestId("asset-class-PF")).toBeInTheDocument();
    await user.click(screen.getByTestId("asset-class-PF"));

    // PF-specific fields appear; the generic instrument-value form doesn't.
    expect(screen.getByTestId("pf-institution-input")).toBeInTheDocument();
    expect(screen.getByTestId("pf-opening-balance-input")).toBeInTheDocument();
    expect(screen.getByTestId("pf-rate-input")).toBeInTheDocument();
    expect(screen.queryByTestId("manual-invested-input")).not.toBeInTheDocument();
  });

  it("defaults to PPF and pre-fills the current government-declared PPF rate, then switches on EPF/VPF tap", async () => {
    const user = userEvent.setup();
    render(<ManualEntry />);
    await user.click(screen.getByTestId("asset-class-PF"));

    expect(screen.getByTestId("pf-rate-input")).toHaveValue(PF_DECLARED_RATES.PPF);

    await user.click(screen.getByTestId("pf-subtype-EPF"));
    expect(screen.getByTestId("pf-rate-input")).toHaveValue(PF_DECLARED_RATES.EPF);
  });

  it("submits a PF holding with the shape holdings.ts's pfSchema expects", async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValueOnce({ data: { holding: { _id: "h1" } } });
    render(<ManualEntry />);

    await user.click(screen.getByTestId("asset-class-PF"));
    await user.click(screen.getByTestId("pf-subtype-EPF"));
    await user.type(screen.getByTestId("pf-institution-input"), "EPFO (via Acme Corp)");
    await user.type(screen.getByTestId("pf-opening-balance-input"), "150000");
    await user.type(screen.getByTestId("pf-monthly-contribution-input"), "5000");

    await user.click(screen.getByTestId("manual-entry-save-btn"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/holdings/manual", expect.objectContaining({
      assetClass: "PF",
      subType: "EPF",
      institution: "EPFO (via Acme Corp)",
      openingBalance: 150000,
      monthlyContribution: 5000,
      interestRatePercent: PF_DECLARED_RATES.EPF,
    })));
  });

  it("pre-fills PF fields from extraFields when editing an existing PF holding", () => {
    useDive.mockReturnValue({
      ...baseContext,
      editingHolding: {
        id: "h1",
        assetClass: "PF",
        investedValue: 200000,
        extraFields: { subType: "PPF", institution: "SBI PPF", monthlyContribution: 1000, startMonth: 4, startYear: 2020, interestRatePercent: 7.1 },
      },
    });
    render(<ManualEntry />);

    expect(screen.getByTestId("pf-institution-input")).toHaveValue("SBI PPF");
    expect(screen.getByTestId("pf-opening-balance-input")).toHaveValue(200000);
    expect(screen.getByTestId("pf-rate-input")).toHaveValue(7.1);
  });
});

// The instrument directory doesn't cover every real-world security yet — a
// visible, honest heads-up here (and on Bot Scan/File Upload's own copies of
// this exact notice) rather than a silent "instrument not found" surprise
// mid-search.
describe("ManualEntry — market data coverage notice", () => {
  it("tells the user some instruments may not match our directory yet", () => {
    useDive.mockReturnValue({
      setScreen: jest.fn(), goBack: jest.fn(), loadHoldings: jest.fn().mockResolvedValue([]),
      updateHolding: jest.fn(), holdings: [], editingHolding: null, setEditingHolding: jest.fn(),
    });
    render(<ManualEntry />);
    expect(screen.getByTestId("market-data-notice")).toHaveTextContent(/limited access to market data/i);
  });
});
