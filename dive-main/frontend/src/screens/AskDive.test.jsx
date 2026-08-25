import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskDive from "./AskDive";
import { api } from "../lib/api";
import { useDive } from "../context/DiveContext";
import * as diveEngine from "../lib/diveEngine";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn() },
}));

jest.mock("../context/DiveContext", () => ({
  useDive: jest.fn(),
}));

// Only apparentDiversification/realDiversification are mocked — everything
// else (effectiveHoldings, totalInvested, topExposure, diveScore, etc.) keeps
// its real implementation, matching what the component actually imports.
jest.mock("../lib/diveEngine", () => {
  const actual = jest.requireActual("../lib/diveEngine");
  return { ...actual, apparentDiversification: jest.fn(), realDiversification: jest.fn() };
});

const existingHolding = { id: "h1", name: "Reliance Industries", segment: "Equity", amount: 50000, source: "MANUAL", lookthrough: [] };

describe("AskDive — Fit for you diversification figures (bug report: real showed 50% instead of 44%)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({
      goBack: jest.fn(),
      holdings: [existingHolding],
      sims: [],
      user: { id: "u1", name: "Test", age: 30 },
      // The canonical backend figures — this is what Home/X-Ray show, and
      // what the "before" numbers in Fit for you must match.
      scoreBreakdown: {
        hasHoldings: true,
        compositeScore: 62,
        weights: { concentration: 0.17 },
        apparentDiversificationPct: 50,
        realDiversificationPct: 44,
      },
    });

    // The lightweight client-side formula disagreeing with the canonical
    // figures is exactly the real-world condition that caused the bug — its
    // own "base" reading here (55) is deliberately different from the
    // canonical 50/44 above, and adding the coin moves its raw reading by a
    // known amount so the delta application can be checked precisely.
    diveEngine.apparentDiversification.mockImplementation((_h, extra) => (extra ? 60 : 55));
    diveEngine.realDiversification.mockImplementation((_h, extra) => (extra ? 58 : 55));

    api.get.mockImplementation((url) => {
      if (url === "/instruments/search") {
        return Promise.resolve({ data: { instruments: [{ _id: "coin1", name: "Bitcoin", assetClass: "CRYPTO", symbol: "BTC" }] } });
      }
      if (url === "/instruments/coin1/detail") {
        return Promise.resolve({ data: { detail: { available: false } } });
      }
      return Promise.reject(new Error("unexpected url " + url));
    });
  });

  it("anchors the 'before' figures on the canonical scoreBreakdown values, not the client formula's own reading", async () => {
    render(<AskDive />);
    await userEvent.type(screen.getByTestId("ask-search-input"), "Bitcoin");
    await waitFor(() => expect(screen.getByTestId("ask-item-coin1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("ask-item-coin1"));

    await waitFor(() => expect(screen.getByTestId("ask-fit-for-you-card")).toBeInTheDocument());

    // "Before" apparent must be the canonical 50%, not the client formula's own 55%.
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "50% → 55%")).toBeInTheDocument();
    // "Before" real must be the canonical 44%, not 55% (the actual bug) and
    // not the client formula's own 58% either — 44 + (58-55) = 47, clamped
    // to be no higher than the new apparent figure (55).
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "44% → 47%")).toBeInTheDocument();
  });
});

// Bug report: a brand-new user with zero holdings searching any instrument
// got a red "this would become your single largest exposure" warning — true
// of literally every instrument when there's nothing else to be concentrated
// against, so it's not a meaningful signal for someone just starting out.
describe("AskDive — 'top holding' concentration warning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    diveEngine.apparentDiversification.mockImplementation(() => 0);
    diveEngine.realDiversification.mockImplementation(() => 0);
    api.get.mockImplementation((url) => {
      if (url === "/instruments/search") {
        return Promise.resolve({ data: { instruments: [{ _id: "eq1", name: "Reliance Industries", assetClass: "EQUITY", symbol: "RELIANCE" }] } });
      }
      if (url === "/instruments/eq1/detail") {
        return Promise.resolve({ data: { detail: { available: false } } });
      }
      return Promise.reject(new Error("unexpected url " + url));
    });
  });

  async function searchAndSelect() {
    render(<AskDive />);
    await userEvent.type(screen.getByTestId("ask-search-input"), "Reliance");
    await waitFor(() => expect(screen.getByTestId("ask-item-eq1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("ask-item-eq1"));
    await waitFor(() => expect(screen.getByTestId("ask-fit-for-you-card")).toBeInTheDocument());
  }

  it("does NOT show the warning for a user with zero existing holdings — everything is trivially 100% otherwise", async () => {
    useDive.mockReturnValue({
      goBack: jest.fn(), holdings: [], sims: [], user: { id: "u1", name: "Test", age: 30 },
      scoreBreakdown: { hasHoldings: false },
    });
    await searchAndSelect();
    expect(screen.queryByTestId("ask-fit-concentration-warning")).not.toBeInTheDocument();
  });

  it("still shows the warning once the user has a real portfolio for the new pick to be concentrated against", async () => {
    useDive.mockReturnValue({
      goBack: jest.fn(),
      holdings: [{ id: "h1", name: "Reliance Industries", segment: "Equity", amount: 50000, source: "MANUAL", lookthrough: [] }],
      sims: [], user: { id: "u1", name: "Test", age: 30 },
      scoreBreakdown: { hasHoldings: true, compositeScore: 60, weights: { concentration: 0.17 }, apparentDiversificationPct: 100, realDiversificationPct: 100 },
    });
    await searchAndSelect();
    expect(screen.getByTestId("ask-fit-concentration-warning")).toBeInTheDocument();
  });
});
