import React from "react";
import { render, screen, within, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Suggestions from "./Suggestions";
import { useDive } from "../context/DiveContext";
import { CORE_CATEGORIES, IDEAL_RANGES } from "../lib/diveEngine";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// Real, non-fabricated sub-scores a genuine /api/score/breakdown response
// would carry — used by the Market Stress Test (resilienceScore()) below.
// Hand-computed expected baseline: round((0.12*70 + 0.12*65 + 0.08*55 +
// 0.08*60 + 0.08*50) / 0.48) = round(29.4 / 0.48) = round(61.25) = 61.
const SCORE_BREAKDOWN_FIXTURE = {
  hasHoldings: true,
  compositeScore: 58,
  // Deliberately apparent != real (70 vs 69, matching a genuine user report)
  // so tests below can catch the "close the gap" card silently ignoring the
  // canonical backend numbers in favor of a local recompute.
  apparentDiversificationPct: 70,
  realDiversificationPct: 69,
  weights: { concentration: 0.17, volatility: 0.12, drawdown: 0.12, var: 0.08, liquidity: 0.12, beta: 0.08, correlation: 0.08, diversificationRatio: 0.04, contextFit: 0.11, stockCountFit: 0.08 },
  subScores: {
    concentration: { score: 40 }, volatility: { score: 70 }, drawdown: { score: 65 }, var: { score: 55 },
    liquidity: { score: 80 }, beta: { score: 60 }, correlation: { score: 50 }, diversificationRatio: { score: 60 },
    contextFit: { score: 90 }, stockCountFit: { score: 70 },
  },
};
const RESILIENCE_BASELINE = 61;

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
  scoreBreakdown: SCORE_BREAKDOWN_FIXTURE,
};

// Feature: a "Tax: ..." strip on every category card in Suggestions,
// carrying real rates/exemption caps researched against current (Aug 2026)
// rules — see TAX_NOTES' header comment in Suggestions.jsx for sourcing.
describe("Suggestions — per-category tax note strip", () => {
  beforeEach(() => {
    useDive.mockReturnValue(baseContext);
  });

  it("shows a distinct, non-empty tax note on every one of the (now 10) category cards", () => {
    render(<Suggestions />);

    // buildSuggestions() always emits a row per CORE_CATEGORIES entry
    // regardless of holdings, so every category's card — and its tax
    // strip — should be present here. Deliberately NOT hard-coded to a
    // count: CORE_CATEGORIES itself is the source of truth (10 as of PF's
    // addition), so this test doesn't need editing again the next time a
    // category is added, only TAX_NOTES does.
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
    const pfNote = within(screen.getByTestId("sugg-card-PF")).getByTestId("sugg-tax-note-PF").textContent;
    expect(equityNote).not.toBe(cryptoNote);
    expect(equityNote).not.toBe(fdNote);
    expect(fdNote).not.toBe(pfNote); // PF ≠ FD despite both being "low return tier" — distinct tax treatment (EEE vs fully taxable)
  });

  it("cites the specific researched numbers for Equity, Insurance (ULIP), Bonds, Crypto, and PF", () => {
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

    const pfNote = within(screen.getByTestId("sugg-card-PF")).getByTestId("sugg-tax-note-PF");
    expect(pfNote).toHaveTextContent("1.5 lakh"); // Sec 80C contribution cap
    expect(pfNote).toHaveTextContent("2.5 lakh"); // EPF/VPF employee-contribution interest-taxability threshold
    expect(pfNote).toHaveTextContent("5 lakh"); // no-employer-contribution variant of the same threshold
    expect(pfNote).toHaveTextContent("7.5 lakh"); // rarer employer-contribution perquisite threshold
    // Regression guard mirroring the ULIP one above, but the OPPOSITE
    // conclusion: PF's EPF/VPF threshold is genuinely marginal (only
    // interest on the excess is taxed), not a cliff like ULIP's — must not
    // accidentally end up phrased the same way.
    expect(pfNote).toHaveTextContent(/only the interest earned on the excess/);
    expect(pfNote).not.toHaveTextContent(/lost entirely/);
  });

  it("shows the tax strip on every card regardless of the card's own recommendation state (deferred/over-exposed/on-track/increase)", () => {
    // With a single heavily-concentrated Equity holding, the cards land
    // across multiple different states (deferred, over-exposed or increase,
    // on-track) depending on Context Engine's read of this portfolio — the
    // tax fact is a property of the category itself, not of whichever state
    // a given card happens to be in, so it must show on all of them regardless.
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

// Feature: a green border on the TAX NOTE STRIP (not the whole card — moved
// there per explicit user request, 2026-09) for the 4 categories whose tax
// treatment is genuinely benefit-dominant (a real, headline tax-free
// outcome) — Insurance (ULIP, Sec 10(10D)), Bonds (specific tax-free PSU
// bonds, Sec 10(15)), Gold/Silver (Sovereign Gold Bond tax-free redemption),
// and PF (PPF's uncapped EEE status / EPF-VPF's EEE outside a narrow
// high-earner edge case). Every other category's tax note stays on a plain
// transparent border, even where its note mentions the boilerplate ₹1.25L
// LTCG exemption available to almost any capital asset — that's not a
// distinctive benefit of the category itself. The outer CARD's border is now
// independent of this entirely — it only ever reflects `s.prioritized`.
describe("Suggestions — tax-benefit highlight (on the tax note strip, not the card)", () => {
  const BENEFIT_CATEGORIES = ["Insurance", "Bonds", "Gold/Silver", "PF"];
  const LIABILITY_CATEGORIES = CORE_CATEGORIES.filter((c) => !BENEFIT_CATEGORIES.includes(c));

  it("puts a green border on exactly the tax note strip for Insurance, Bonds, Gold/Silver, and PF — never on the outer card", () => {
    useDive.mockReturnValue(baseContext); // prefs.preferred: [] — no prioritized-border interference
    render(<Suggestions />);

    BENEFIT_CATEGORIES.forEach((cat) => {
      expect(screen.getByTestId(`sugg-tax-note-${cat}`).className).toContain("border-[var(--green)]");
      expect(screen.getByTestId(`sugg-card-${cat}`).className).not.toContain("border-[var(--green)]");
    });
    LIABILITY_CATEGORIES.forEach((cat) => {
      const noteCls = screen.getByTestId(`sugg-tax-note-${cat}`).className;
      expect(noteCls).not.toContain("border-[var(--green)]");
      expect(noteCls).toContain("border-transparent");
    });
  });

  it("shows both highlights at once when a category is both prioritized AND tax-benefited — dive-blue on the card, green on the tax note strip, no competition", () => {
    useDive.mockReturnValue({ ...baseContext, prefs: { ...baseContext.prefs, preferred: ["Insurance"] } });
    render(<Suggestions />);

    expect(screen.getByTestId("sugg-card-Insurance").className).toContain("border-[var(--dive-blue)]");
    expect(screen.getByTestId("sugg-tax-note-Insurance").className).toContain("border-[var(--green)]");
  });
});

// Feature: the old single "Run Stress Test" button (which actually opened 3
// hypothetical PORTFOLIO-FIX scenarios, not a market-shock test) is now two
// distinct buttons — "What If" (left, unchanged content, restyled to a
// floating modal) and a genuine "Run Stress Test" (right, new market-stress
// feature, see below). 2026-09.
describe("Suggestions — What If / Run Stress Test button split", () => {
  beforeEach(() => useDive.mockReturnValue(baseContext));

  it("shows both buttons at once, correctly labeled, with the real-stress testid on the NEW button", () => {
    render(<Suggestions />);
    expect(screen.getByTestId("what-if-btn")).toHaveTextContent("What If");
    expect(screen.getByTestId("stress-test-btn")).toHaveTextContent("Run Stress Test");
  });

  it("restyles the What If sheet to a floating modal (SimulateSheet's pattern), not the old full-width bottom sheet", async () => {
    const user = userEvent.setup();
    render(<Suggestions />);
    await user.click(screen.getByTestId("what-if-btn"));

    const sheet = screen.getByTestId("what-if-sheet");
    expect(sheet.className).toContain("rounded-3xl");
    expect(sheet.className).toContain("max-w-md");
    // Regression guard: must NOT carry the old bottom-sheet's classes.
    expect(sheet.className).not.toContain("rounded-t-3xl");
    expect(sheet.className).not.toContain("bottom-0");
  });

  it("keeps the What If scenarios' content unchanged — a pure restyle, not a content change", async () => {
    const user = userEvent.setup();
    render(<Suggestions />);
    await user.click(screen.getByTestId("what-if-btn"));
    expect(screen.getByText("Cap single-issuer exposure at 30%")).toBeInTheDocument();
    expect(screen.getByText("Fill your missing categories")).toBeInTheDocument();
    expect(screen.getByText("Close the apparent-vs-real gap")).toBeInTheDocument();
  });

  it("shows the same Divve Score 'Now'/'If fixed' format as the other two cards, with the real apparent/real diversification % folded into the description instead of repeating Home's dashboard numbers as the headline", async () => {
    const user = userEvent.setup();
    render(<Suggestions />);
    await user.click(screen.getByTestId("what-if-btn"));

    const card = screen.getByTestId("what-if-close-lookthrough-gap");
    // Rendered uppercase via CSS (text-transform), so match the actual DOM text case — same labels the other two cards use.
    expect(within(card).getAllByText("Now")).toHaveLength(1);
    expect(within(card).getAllByText("If fixed")).toHaveLength(1);
    // Real diversification % now lives in the description, not the headline numbers.
    expect(card).toHaveTextContent("Real diversification is 69% versus an apparent 70% right now.");
    // The headline numbers are the Divve Score (compositeScore: 58), not raw diversification %.
    expect(within(card).queryByText(/^69%$|^70%$/)).not.toBeInTheDocument();
  });

  it("computes an EXACT (not fabricated) Divve Score delta from the real apparent/real diversification gap, per the documented concentration formula (§6.4): gap × 0.15 (real's weight inside concentration) × weights.concentration", async () => {
    const user = userEvent.setup();
    // Deliberately a bigger, easy-to-hand-verify gap than the default fixture's
    // 70/69: gapConcentrationDelta = (90-40)*0.15 = 7.5; gapScoreDelta = 7.5*0.17
    // = 1.275; after = round(58 + 1.275) = 59.
    useDive.mockReturnValue({
      ...baseContext,
      scoreBreakdown: { ...SCORE_BREAKDOWN_FIXTURE, apparentDiversificationPct: 90, realDiversificationPct: 40 },
    });
    render(<Suggestions />);
    await user.click(screen.getByTestId("what-if-btn"));

    const card = screen.getByTestId("what-if-close-lookthrough-gap");
    expect(card).toHaveTextContent("Real diversification is 40% versus an apparent 90% right now.");
    expect(within(card).getByText("58")).toBeInTheDocument(); // Now = canonicalScore, unchanged
    expect(within(card).getByText("59")).toBeInTheDocument(); // If fixed = exact hand-computed value above
  });

  it("falls back to the local apparent/real diversification calc when no canonical scoreBreakdown is available yet, and never lets the score move backwards when closing the gap", async () => {
    const user = userEvent.setup();
    // Deliberate cross-segment overlap so the LOCAL formula (diveEngine.js's
    // crossSegmentOverlaps, which matches on the HOLDING's own name, not
    // lookthrough) has something real to catch: "Reliance Industries"
    // (Equity) and "Reliance Industries Bonds" (Bonds) normalize to the same
    // issuer key.
    useDive.mockReturnValue({
      ...baseContext,
      scoreBreakdown: { hasHoldings: false },
      holdings: [
        { id: "h1", name: "Reliance Industries", segment: "Equity", amount: 50000, lookthrough: [{ company: "Reliance Industries", pct: 100 }] },
        { id: "h2", name: "Reliance Industries Bonds", segment: "Bonds", amount: 50000, lookthrough: [{ company: "Reliance Industries", pct: 100 }] },
      ],
    });
    render(<Suggestions />);
    await user.click(screen.getByTestId("what-if-btn"));

    const card = screen.getByTestId("what-if-close-lookthrough-gap");
    expect(card).toHaveTextContent("Real diversification is 0% versus an apparent 50% right now."); // full overlap -> real 0, 2 even segments -> apparent 50
    const values = within(card).getAllByText(/^\d+$/).map((el) => Number(el.textContent));
    expect(values).toHaveLength(2);
    const [now, ifFixed] = values;
    expect(ifFixed).toBeGreaterThanOrEqual(now); // closing a real gap can only hold or raise the score, never lower it
  });

  it("opens/closes the two sheets independently", async () => {
    const user = userEvent.setup();
    render(<Suggestions />);

    await user.click(screen.getByTestId("what-if-btn"));
    expect(screen.getByTestId("what-if-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("market-stress-sheet")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("what-if-close-btn"));
    // AnimatePresence's exit animation keeps the node mounted (mid-fade)
    // for a moment after the close click — wait for it to actually leave
    // the DOM rather than asserting immediately.
    await waitForElementToBeRemoved(() => screen.queryByTestId("what-if-sheet"));

    await user.click(screen.getByTestId("stress-test-btn"));
    expect(screen.getByTestId("market-stress-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("what-if-sheet")).not.toBeInTheDocument();
  });
});

// Feature: the NEW "Run Stress Test" button — a genuine market-shock
// estimate (Geopolitical Tension / Rate Hike / Sector Crash), computed from
// real scoreBreakdown sub-scores + cited, reasoned per-category sensitivity
// tables — never fabricated. See MARKET_STRESS_SENSITIVITY's own header
// comment in Suggestions.jsx for the full citations.
describe("Suggestions — Run Stress Test (market shock)", () => {
  async function openMarketStress(context) {
    useDive.mockReturnValue(context);
    const user = userEvent.setup();
    render(<Suggestions />);
    await user.click(screen.getByTestId("stress-test-btn"));
    return user;
  }

  // sc.before/sc.after render as sibling elements separated only by an
  // <ArrowRight> SVG icon (no text content of its own) — reading the whole
  // card's textContent would glue adjacent numbers together (e.g. "61" next
  // to "26" reads as "6126"), so each value gets its own testid instead.
  function beforeAfter(id) {
    return [
      Number(screen.getByTestId(`market-stress-${id}-before`).textContent),
      Number(screen.getByTestId(`market-stress-${id}-after`).textContent),
    ];
  }

  it("shows the same real, hand-computed resilience baseline on all 3 cards", async () => {
    await openMarketStress(baseContext);
    ["geopolitical", "rate-hike", "sector-crash"].forEach((id) => {
      expect(beforeAfter(id)[0]).toBe(RESILIENCE_BASELINE);
    });
  });

  it("keeps every scenario's 'after' bounded to [0, 100]", async () => {
    await openMarketStress(baseContext);
    ["geopolitical", "rate-hike", "sector-crash"].forEach((id) => {
      const [, after] = beforeAfter(id);
      expect(after).toBeGreaterThanOrEqual(0);
      expect(after).toBeLessThanOrEqual(100);
    });
  });

  it("shows a real decline for a Bonds-heavy portfolio under Rate Hike (duration risk)", async () => {
    await openMarketStress({
      ...baseContext,
      holdings: [{ id: "h1", name: "G-Sec Fund", segment: "Bonds", amount: 100000, lookthrough: [{ company: "Govt / Bank", pct: 100 }] }],
    });
    const [before, after] = beforeAfter("rate-hike");
    expect(before).toBe(RESILIENCE_BASELINE);
    expect(after).toBeLessThan(before);
  });

  it("shows no move at all for an FD/PF-only portfolio under Geopolitical Tension or Rate Hike — neither is marked-to-market (confirmed consistent with the main Divve Score's FD/PF beta: 0)", async () => {
    await openMarketStress({
      ...baseContext,
      holdings: [{ id: "h1", name: "SBI PPF", segment: "PF", amount: 100000, lookthrough: [{ company: "EPFO / Govt", pct: 100 }] }],
    });
    const [geoBefore, geoAfter] = beforeAfter("geopolitical");
    const [rateBefore, rateAfter] = beforeAfter("rate-hike");
    expect(geoAfter).toBe(geoBefore);
    expect(rateAfter).toBe(rateBefore);
  });

  it("lets a Gold/Silver-heavy portfolio genuinely IMPROVE under Geopolitical Tension (real safe-haven benefit, not a bug) — but shows NO fall under Sector Crash (gold has no single-issuer collapse risk, per the crashable-categories design)", async () => {
    await openMarketStress({
      ...baseContext,
      holdings: [{ id: "h1", name: "Sovereign Gold Bond", segment: "Gold/Silver", amount: 100000, lookthrough: [{ company: "Gold", pct: 100 }] }],
    });
    const [geoBefore, geoAfter] = beforeAfter("geopolitical");
    const [sectorBefore, sectorAfter] = beforeAfter("sector-crash");
    expect(geoAfter).toBeGreaterThanOrEqual(geoBefore);
    expect(sectorAfter).toBe(sectorBefore); // NOT a fall
  });

  it("Sector Crash worsens as single-company concentration rises, restricted to real business-risk categories", async () => {
    // Two equity holdings, evenly split between different companies.
    const split = {
      ...baseContext,
      holdings: [
        { id: "h1", name: "Company A", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company A", pct: 100 }] },
        { id: "h2", name: "Company B", segment: "Equity", amount: 50000, lookthrough: [{ company: "Company B", pct: 100 }] },
      ],
    };
    useDive.mockReturnValue(split);
    const { unmount } = render(<Suggestions />);
    const user1 = userEvent.setup();
    await user1.click(screen.getByTestId("stress-test-btn"));
    const [, splitAfter] = beforeAfter("sector-crash");
    unmount();

    // One holding, 100% in a single company.
    const concentrated = {
      ...baseContext,
      holdings: [{ id: "h1", name: "Company A", segment: "Equity", amount: 100000, lookthrough: [{ company: "Company A", pct: 100 }] }],
    };
    useDive.mockReturnValue(concentrated);
    render(<Suggestions />);
    const user2 = userEvent.setup();
    await user2.click(screen.getByTestId("stress-test-btn"));
    const [, concentratedAfter] = beforeAfter("sector-crash");

    expect(concentratedAfter).toBeLessThanOrEqual(splitAfter);
  });

  it("shows a graceful empty state, never a fabricated number, when resilience data isn't ready", async () => {
    await openMarketStress({ ...baseContext, scoreBreakdown: { hasHoldings: false } });
    expect(screen.getByTestId("market-stress-not-ready")).toBeInTheDocument();
    expect(screen.queryByTestId("market-stress-geopolitical")).not.toBeInTheDocument();
  });
});
