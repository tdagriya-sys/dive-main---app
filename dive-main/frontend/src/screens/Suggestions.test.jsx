import React from "react";
import { render, screen, within } from "@testing-library/react";
import Suggestions from "./Suggestions";
import { useDive } from "../context/DiveContext";
import { CORE_CATEGORIES, IDEAL_RANGES } from "../lib/diveEngine";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const baseContext = {
  holdings: [{ id: "h1", name: "Test Equity Holding", segment: "Equity", amount: 100000, lookthrough: [{ company: "Test Co", pct: 100 }] }],
  holdingsLoading: false,
  holdingsError: false,
  loadHoldings: jest.fn(),
  ranges: IDEAL_RANGES,
  prefs: { risk: "Balanced", excluded: [], diversificationPriority: "Medium", preferred: [] },
  setScreen: jest.fn(),
  setAskInstrument: jest.fn(),
  sims: [],
  addSim: jest.fn(),
  resetSims: jest.fn(),
  scoreBreakdown: null,
};

// Feature: a "Tax: ..." strip on every category card in Suggestions,
// carrying real rates/exemption caps researched against current (Aug 2026)
// rules — see TAX_NOTES' header comment in Suggestions.jsx for sourcing.
describe("Suggestions — per-category tax note strip", () => {
  beforeEach(() => {
    useDive.mockReturnValue(baseContext);
  });

  it("shows a distinct, non-empty tax note on every one of the 9 category cards", () => {
    render(<Suggestions />);

    // buildSuggestions() always emits a row per CORE_CATEGORIES entry
    // regardless of holdings, so every category's card — and its tax
    // strip — should be present here.
    CORE_CATEGORIES.forEach((cat) => {
      const card = screen.getByTestId(`sugg-card-${cat}`);
      const note = within(card).getByTestId(`sugg-tax-note-${cat}`);
      expect(note).toHaveTextContent(/^Tax:/);
      expect(note.textContent.length).toBeGreaterThan(20);
    });

    // Sanity-check a few category notes actually differ from each other —
    // guards against a copy-paste bug that gave every category the same text.
    const equityNote = within(screen.getByTestId("sugg-card-Equity")).getByTestId("sugg-tax-note-Equity").textContent;
    const cryptoNote = within(screen.getByTestId("sugg-card-Crypto")).getByTestId("sugg-tax-note-Crypto").textContent;
    const fdNote = within(screen.getByTestId("sugg-card-FD")).getByTestId("sugg-tax-note-FD").textContent;
    expect(equityNote).not.toBe(cryptoNote);
    expect(equityNote).not.toBe(fdNote);
  });

  it("cites the specific researched numbers for Equity, Insurance (ULIP), Bonds, and Crypto", () => {
    render(<Suggestions />);

    const equityNote = within(screen.getByTestId("sugg-card-Equity")).getByTestId("sugg-tax-note-Equity");
    expect(equityNote).toHaveTextContent("20%"); // STCG
    expect(equityNote).toHaveTextContent("1.25 lakh"); // LTCG exemption
    expect(equityNote).toHaveTextContent("12.5%"); // LTCG rate

    const insuranceNote = within(screen.getByTestId("sugg-card-Insurance")).getByTestId("sugg-tax-note-Insurance");
    expect(insuranceNote).toHaveTextContent("Section 10(10D)");
    expect(insuranceNote).toHaveTextContent("2.5 lakh"); // ULIP premium cap, Budget 2021
    // Regression guard: the ₹2.5L cap is a cliff (crossing it disqualifies
    // the WHOLE policy from 10(10D), not just the amount over the cap) —
    // must not read as a marginal/partial exemption up to that amount.
    expect(insuranceNote).toHaveTextContent(/lost entirely, not just on the excess/);
    expect(insuranceNote).toHaveTextContent("1.25 lakh"); // the LTCG exemption still available WITHIN the taxable case

    const bondsNote = within(screen.getByTestId("sugg-card-Bonds")).getByTestId("sugg-tax-note-Bonds");
    expect(bondsNote).toHaveTextContent("Section 10(15)");

    const cryptoNote = within(screen.getByTestId("sugg-card-Crypto")).getByTestId("sugg-tax-note-Crypto");
    expect(cryptoNote).toHaveTextContent("30%"); // flat VDA rate, Sec 115BBH
    expect(cryptoNote).toHaveTextContent("115BBH");

    const fdNote = within(screen.getByTestId("sugg-card-FD")).getByTestId("sugg-tax-note-FD");
    expect(fdNote).toHaveTextContent("50,000"); // Budget 2025 TDS threshold
    expect(fdNote).toHaveTextContent("1,00,000"); // senior citizen TDS threshold
  });

  it("shows the tax strip on every card regardless of the card's own recommendation state (deferred/over-exposed/on-track/increase)", () => {
    // With a single heavily-concentrated Equity holding, the 9 cards land
    // across multiple different states (deferred, over-exposed or increase,
    // on-track) depending on Context Engine's read of this portfolio — the
    // tax fact is a property of the category itself, not of whichever state
    // a given card happens to be in, so it must show on all 9 regardless.
    useDive.mockReturnValue({
      ...baseContext,
      holdings: [{ id: "h1", name: "Big Equity Holding", segment: "Equity", amount: 900000, lookthrough: [{ company: "Test Co", pct: 100 }] }],
    });
    render(<Suggestions />);

    const states = new Set();
    CORE_CATEGORIES.forEach((cat) => {
      const card = screen.getByTestId(`sugg-card-${cat}`);
      expect(within(card).getByTestId(`sugg-tax-note-${cat}`)).toBeInTheDocument();
      if (within(card).queryByTestId(`sugg-deferred-note-${cat}`)) states.add("deferred");
      else if (within(card).queryByTestId(`sugg-overexposed-note-${cat}`)) states.add("overexposed");
      else states.add("other");
    });
    // Confirms this scenario actually exercises more than one card state —
    // otherwise the assertion above wouldn't prove much.
    expect(states.size).toBeGreaterThan(1);
  });

  it("shows a single shared disclaimer once, not repeated per card", () => {
    render(<Suggestions />);
    expect(screen.getByTestId("sugg-tax-disclaimer")).toHaveTextContent("Income-tax Act, 2025");
    expect(screen.getAllByTestId("sugg-tax-disclaimer")).toHaveLength(1);
  });
});

// Feature: a green border on the 3 category cards whose tax treatment is
// genuinely benefit-dominant (a real, headline tax-free outcome) — Insurance
// (ULIP, Sec 10(10D)), Bonds (specific tax-free PSU bonds, Sec 10(15)), and
// Gold/Silver (Sovereign Gold Bond tax-free redemption). Every other
// category stays on the plain default border, unchanged, even where its note
// mentions the boilerplate ₹1.25L LTCG exemption available to almost any
// capital asset — that's not a distinctive benefit of the category itself.
describe("Suggestions — tax-benefit card border", () => {
  const BENEFIT_CATEGORIES = ["Insurance", "Bonds", "Gold/Silver"];
  const LIABILITY_CATEGORIES = CORE_CATEGORIES.filter((c) => !BENEFIT_CATEGORIES.includes(c));

  it("puts a green border on exactly Insurance, Bonds, and Gold/Silver", () => {
    useDive.mockReturnValue(baseContext); // prefs.preferred: [] — no prioritized-border interference
    render(<Suggestions />);

    BENEFIT_CATEGORIES.forEach((cat) => {
      expect(screen.getByTestId(`sugg-card-${cat}`).className).toContain("border-[var(--green)]");
    });
    LIABILITY_CATEGORIES.forEach((cat) => {
      const cls = screen.getByTestId(`sugg-card-${cat}`).className;
      expect(cls).not.toContain("border-[var(--green)]");
      expect(cls).toContain("border-[var(--border)]"); // left exactly as it was
    });
  });

  it("still lets the user's own 'prioritized' preference (dive-blue border) win over the green tax-benefit border", () => {
    useDive.mockReturnValue({ ...baseContext, prefs: { ...baseContext.prefs, preferred: ["Insurance"] } });
    render(<Suggestions />);

    const cls = screen.getByTestId("sugg-card-Insurance").className;
    expect(cls).toContain("border-[var(--dive-blue)]");
    expect(cls).not.toContain("border-[var(--green)]");
  });
});
