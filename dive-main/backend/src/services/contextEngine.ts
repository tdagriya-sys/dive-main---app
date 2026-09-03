import { AssetClass } from "../models/Instrument";

/**
 * Layer D — Context Engine. Given how much money someone has and how old
 * they are, decides which of the 12 asset classes it's actually SENSIBLE to
 * expect them to hold RIGHT NOW — so the score and its messaging never treat
 * "not diversified yet" as a problem when, for this person's corpus and life
 * stage, it isn't one. See docs/DIVE_SCORE_MODEL.md §15 for the full writeup.
 *
 * Two independent dimensions, deliberately kept separate:
 *   - Corpus tier decides the COUNT of classes expected (a practicality/
 *     minimums question — you can't meaningfully split a small amount many
 *     ways).
 *   - Persona (age-derived) decides the ORDER/COMPOSITION of which classes
 *     count first (a suitability question — a 25-year-old and a 70-year-old
 *     with the same corpus should be nudged toward different mixes).
 */

export interface CorpusTier {
  id: "starter" | "growing" | "established" | "substantial" | "large";
  label: string;
  maxAmount: number; // exclusive upper bound; Infinity for the top tier
  expectedClassCount: number;
  reasoning: string;
}

export const CORPUS_TIERS: CorpusTier[] = [
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
    maxAmount: Infinity,
    expectedClassCount: 12,
    reasoning:
      "Above ₹50,00,000, every one of the 12 classes is achievable at a meaningful ticket size — at this scale, skipping a class is a deliberate allocation choice, not a practical constraint, so the full spectrum is the sensible expectation.",
  },
];

export function resolveCorpusTier(totalInvestedAmount: number): CorpusTier {
  return CORPUS_TIERS.find((t) => totalInvestedAmount < t.maxAmount) || CORPUS_TIERS[CORPUS_TIERS.length - 1];
}

export interface PersonaBracket {
  id: string;
  label: string;
  minAge: number;
  maxAge: number | null; // null = no upper bound
  priorityClasses: AssetClass[]; // checked/filled first, in this order
  deprioritizedClasses: AssetClass[]; // filled last — only reached if the corpus tier's count needs that many
  // Risk CAPACITY (not just preference) scales with time horizon — the same
  // volatility/drawdown that's a normal, recoverable part of a 25-year-old's
  // journey is a much bigger deal for someone retiring soon. These are the
  // annualized-vol / max-drawdown levels that score 0 (the "worst" end of
  // scoreFromRange) for this persona — the "best" end (low vol/drawdown is
  // good for everyone) stays the same across all personas; only how much
  // downside counts as a failure shifts.
  volatilityWorstAt: number;
  drawdownWorstAt: number;
  reasoning: string;
}

export const PERSONA_BRACKETS: PersonaBracket[] = [
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
      "Long time horizon and typically the fewest financial dependents of any life stage — the main resource this stage has is time, which growth assets (equity, funds) compound. Locking money into low-liquidity, preservation-first instruments trades away that advantage before it's needed. That same long horizon means more time to recover from a deep drawdown, so the volatility/drawdown level that counts as a failure is set further out than for later stages. PF is deprioritized alongside every other lock-in class here even though EPF is often already accruing passively via payroll at this age — that existing balance still gets entered and scored regardless of this ordering; deprioritizing it just means the app doesn't actively nudge toward a NEW voluntary PPF/VPF commitment this early.",
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
      "Typically the highest income and capacity of any stage — growth and preservation are both reasonable to expect side by side, across the broadest priority list of any persona. Treated as the baseline risk-capacity level (these were the model's original, persona-blind defaults). PF sits ahead of FD/RD here specifically: this bracket is most likely to be in the highest tax slab, where PF's EEE edge over FD/RD's fully-taxable interest matters most.",
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
      "Capital preservation rises sharply in importance as the investing horizon shortens — debt and insured instruments should meaningfully lift the score now, and their absence should be flagged more than it would be at 25. Equity remains present (a multi-decade retirement still needs growth) but sits behind preservation in priority; crypto's volatility no longer suits this stage. A shorter horizon to recover from a drawdown means the failure threshold moves in. PF is deliberately placed AFTER MUTUAL_FUND, not before: a fresh PPF opened at 56-64 doesn't mature for 15 years — a real mismatch for this persona's shortening horizon — so it shouldn't outrank more liquid, immediately-practical preservation options, even though PF's tax treatment is otherwise attractive here too.",
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
      "Preservation and income dominate; a smaller equity sleeve remains reasonable since retirement itself can span decades, but growth is no longer the priority and crypto's volatility is actively deprioritized. Least tolerance for volatility/drawdown of any persona — often already drawing down the corpus for income, with the least time to recover before that withdrawal need arrives. PF is deliberately left off both lists here (falls through to DEFAULT_CLASS_ORDER instead) — no new payroll EPF at this stage for most users, and a fresh 15-year PPF lock is a poor fit for a retirement-drawdown horizon; any existing EPF balance still gets entered and scored regardless.",
  },
];

export function resolvePersona(age: number): PersonaBracket {
  return (
    PERSONA_BRACKETS.find((p) => age >= p.minAge && (p.maxAge === null || age <= p.maxAge)) ||
    PERSONA_BRACKETS[PERSONA_BRACKETS.length - 1]
  );
}

// Fallback ordering for classes a persona doesn't explicitly prioritize or
// deprioritize — keeps every class reachable once a large-enough corpus tier
// asks for more classes than a persona's explicit lists cover.
const DEFAULT_CLASS_ORDER: AssetClass[] = [
  "EQUITY",
  "MUTUAL_FUND",
  "GOLD",
  "BOND",
  "FD",
  "PF",
  "ETF",
  "SILVER",
  "REIT",
  "INVIT",
  "CRYPTO",
  "ULIP_INSURANCE",
];

export interface ContextProfile {
  corpusTier: CorpusTier;
  persona: PersonaBracket;
  expectedAssetClasses: AssetClass[];
}

/**
 * Builds the "Expected Asset Class Set" — which of the 12 classes it's
 * reasonable to expect a portfolio like this one to hold right now. Corpus
 * tier governs the COUNT; persona governs the ORDER. A large-enough corpus
 * tier count will eventually pull in even a persona's deprioritized classes
 * (matching "large corpus + any age → expected set approaches all 12") —
 * deprioritization only affects ordering, never permanent exclusion.
 */
export function resolveContext(totalInvestedAmount: number, age: number): ContextProfile {
  const corpusTier = resolveCorpusTier(totalInvestedAmount);
  const persona = resolvePersona(age);

  const ordered: AssetClass[] = [];
  const seen = new Set<AssetClass>();
  const push = (c: AssetClass) => {
    if (!seen.has(c)) {
      seen.add(c);
      ordered.push(c);
    }
  };

  persona.priorityClasses.forEach(push);
  DEFAULT_CLASS_ORDER.filter((c) => !persona.deprioritizedClasses.includes(c)).forEach(push);
  persona.deprioritizedClasses.forEach(push);

  return { corpusTier, persona, expectedAssetClasses: ordered.slice(0, corpusTier.expectedClassCount) };
}
