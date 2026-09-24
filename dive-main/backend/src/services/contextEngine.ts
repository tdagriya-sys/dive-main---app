import { AssetClass } from "../models/Instrument";
import { ContextConfigPayload, CorpusTierPayload, PersonaBracketPayload } from "../models/ContextConfig";
import { CONTEXT_CONFIG_DEFAULTS } from "../config/contextDefaults";

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
 *
 * As of Phase 2 of docs/ADMIN_PANEL_PLAN.md, the tiers/brackets/order below
 * are admin-configurable (see models/ContextConfig.ts + services/config/
 * contextConfigService.ts) rather than hardcoded — every function here takes
 * the active config as a parameter, defaulting to CONTEXT_CONFIG_DEFAULTS
 * (the exact values this file used to hardcode) so every existing caller
 * that doesn't pass one explicitly — tests included — is unaffected.
 */

export type CorpusTier = CorpusTierPayload;
export type PersonaBracket = PersonaBracketPayload;

export function resolveCorpusTier(totalInvestedAmount: number, tiers: CorpusTier[] = CONTEXT_CONFIG_DEFAULTS.corpusTiers): CorpusTier {
  return tiers.find((t) => totalInvestedAmount < t.maxAmount) || tiers[tiers.length - 1];
}

export function resolvePersona(age: number, brackets: PersonaBracket[] = CONTEXT_CONFIG_DEFAULTS.personaBrackets): PersonaBracket {
  return brackets.find((p) => age >= p.minAge && (p.maxAge === null || age <= p.maxAge)) || brackets[brackets.length - 1];
}

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
export function resolveContext(totalInvestedAmount: number, age: number, cfg: ContextConfigPayload = CONTEXT_CONFIG_DEFAULTS): ContextProfile {
  const corpusTier = resolveCorpusTier(totalInvestedAmount, cfg.corpusTiers);
  const persona = resolvePersona(age, cfg.personaBrackets);

  const ordered: AssetClass[] = [];
  const seen = new Set<AssetClass>();
  const push = (c: AssetClass) => {
    if (!seen.has(c)) {
      seen.add(c);
      ordered.push(c);
    }
  };

  persona.priorityClasses.forEach(push);
  cfg.defaultClassOrder.filter((c) => !persona.deprioritizedClasses.includes(c)).forEach(push);
  persona.deprioritizedClasses.forEach(push);

  return { corpusTier, persona, expectedAssetClasses: ordered.slice(0, corpusTier.expectedClassCount) };
}
