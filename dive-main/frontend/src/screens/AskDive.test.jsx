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
