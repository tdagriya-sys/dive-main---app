import { ContextConfigPayload } from "../models/ContextConfig";

/**
 * The exact values `contextEngine.ts` used as hardcoded constants before
 * Phase 2 of docs/ADMIN_PANEL_PLAN.md — extracted verbatim. See
 * docs/DIVE_SCORE_MODEL.md §15 for the reasoning behind each tier/bracket —
 * this file is just the numbers.
 *
 * The top corpus tier's `maxAmount` was `Infinity` in the original code —
 * not valid JSON, so it's stored here as `Number.MAX_SAFE_INTEGER`, which
 * behaves identically to Infinity for every `totalInvestedAmount <
 * maxAmount` comparison at any realistic portfolio value.
 */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

export const CONTEXT_CONFIG_DEFAULTS: ContextConfigPayload = {
  corpusTiers: [
    {
      id: "starter",
      label: "Starter",
      maxAmount: 25000,
      expectedClassCount: 1,
      reasoning:
        "Below ~₹25,000, splitting into even 2 classes means one gets well under ₹12,500 — below a single Sovereign Gold Bond unit (~₹6,000+) or a typical ULIP's minimum annual premium (₹12,000–24,000+), and thin enough elsewhere that brokerage/entry costs eat a large share of the ticket. One well-chosen, liquid, low-minimum class (equity, or a mutual fund SIP) is the complete, sensible picture at this size — not a shortfall.",
    },
    {
      id: "growing",
      label: "Growing",
      maxAmount: 200000,
      expectedClassCount: 3,
      reasoning:
        "₹25,000–₹2,00,000 comfortably supports 3 classes at ₹8,000+ each even at the low end — enough to clear practical minimums for equity, a mutual fund, and gold (digital/SGB) or a starter FD/RD, without any single slice being fee-inefficient.",
    },
    {
      id: "established",
      label: "Established",
      maxAmount: 1000000,
      expectedClassCount: 5,
      reasoning:
        "₹2,00,000–₹10,00,000 supports 5 classes at meaningful (₹20,000–40,000+) ticket sizes — room for a first ULIP/insurance commitment or a REIT/InvIT slice worth the lower liquidity, alongside equity, mutual funds, gold, and debt (bond/FD/RD).",
    },
    {
      id: "substantial",
      label: "Substantial",
      maxAmount: 5000000,
      expectedClassCount: 8,
      reasoning:
        "₹10,00,000–₹50,00,000 means even a 1/8th equal slice is ₹1.25L–6.25L, comfortably above every asset class's practical minimum — most of the 11-class universe becomes reasonable.",
    },
    {
      id: "large",
      label: "Large",
      maxAmount: UNBOUNDED,
      expectedClassCount: 12,
      reasoning:
        "Above ₹50,00,000, every one of the 12 classes is achievable at a meaningful ticket size — at this scale, skipping a class is a deliberate allocation choice, not a practical constraint, so the full spectrum is the sensible expectation.",
    },
  ],
  personaBrackets: [
    {
      id: "earlyCareer",
      label: "Early Career",
      minAge: 18,
      maxAge: 28,
      priorityClasses: ["EQUITY", "MUTUAL_FUND", "GOLD", "CRYPTO"],
      deprioritizedClasses: ["FD", "BOND", "ULIP_INSURANCE", "REIT", "INVIT", "PF"],
      volatilityWorstAt: 0.55,
      drawdownWorstAt: -0.7,
      reasoning:
        "Long time horizon and typically the fewest financial dependents of any life stage — the main resource this stage has is time, which growth assets (equity, funds) compound. Locking money into low-liquidity, preservation-first instruments trades away that advantage before it's needed. That same long horizon means more time to recover from a deep drawdown, so the volatility/drawdown level that counts as a failure is set further out than for later stages.",
    },
    {
      id: "buildingPhase",
      label: "Building Phase",
      minAge: 29,
      maxAge: 40,
      priorityClasses: ["EQUITY", "MUTUAL_FUND", "GOLD", "BOND", "PF"],
      deprioritizedClasses: ["ULIP_INSURANCE", "REIT", "INVIT"],
      volatilityWorstAt: 0.5,
      drawdownWorstAt: -0.65,
      reasoning:
        "Still growth-oriented, but rising responsibilities (loans, family) make a first slice of debt (bonds) a reasonable, not premature, addition. A first deliberate PPF/VPF top-up is a reasonable, tax-advantaged debt decision alongside it by this stage.",
    },
    {
      id: "peakEarning",
      label: "Peak Earning",
      minAge: 41,
      maxAge: 55,
      priorityClasses: ["EQUITY", "MUTUAL_FUND", "BOND", "PF", "FD", "GOLD", "REIT", "INVIT"],
      deprioritizedClasses: [],
      volatilityWorstAt: 0.45,
      drawdownWorstAt: -0.6,
      reasoning:
        "Typically the highest income and capacity of any stage — growth and preservation are both reasonable to expect side by side, across the broadest priority list of any persona. Treated as the baseline risk-capacity level (these were the model's original, persona-blind defaults).",
    },
    {
      id: "preRetirement",
      label: "Pre-Retirement",
      minAge: 56,
      maxAge: 64,
      priorityClasses: ["BOND", "FD", "MUTUAL_FUND", "PF", "GOLD", "ULIP_INSURANCE", "EQUITY"],
      deprioritizedClasses: ["CRYPTO"],
      volatilityWorstAt: 0.35,
      drawdownWorstAt: -0.45,
      reasoning:
        "Capital preservation rises sharply in importance as the investing horizon shortens — debt and insured instruments should meaningfully lift the score now, and their absence should be flagged more than it would be at 25. A shorter horizon to recover from a drawdown means the failure threshold moves in.",
    },
    {
      id: "retired",
      label: "Retired/Senior",
      minAge: 65,
      maxAge: null,
      priorityClasses: ["FD", "BOND", "ULIP_INSURANCE", "GOLD", "MUTUAL_FUND", "EQUITY"],
      deprioritizedClasses: ["CRYPTO"],
      volatilityWorstAt: 0.28,
      drawdownWorstAt: -0.35,
      reasoning:
        "Preservation and income dominate; a smaller equity sleeve remains reasonable since retirement itself can span decades, but growth is no longer the priority and crypto's volatility is actively deprioritized. Least tolerance for volatility/drawdown of any persona.",
    },
  ],
  defaultClassOrder: ["EQUITY", "MUTUAL_FUND", "GOLD", "BOND", "FD", "PF", "ETF", "SILVER", "REIT", "INVIT", "CRYPTO", "ULIP_INSURANCE"],
};

export { UNBOUNDED as CONTEXT_CONFIG_UNBOUNDED_SENTINEL };
