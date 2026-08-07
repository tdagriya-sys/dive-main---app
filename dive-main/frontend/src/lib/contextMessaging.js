// Layer D — reusable messaging rules for the Context Engine (see
// backend/src/services/contextEngine.ts and docs/DIVE_SCORE_MODEL.md §15).
// All context-aware copy shown to the user should come through here, not be
// written ad-hoc in individual screens, so the tone stays consistent and easy
// to update in one place as the model evolves.
import { ASSET_CLASS_LABELS, CORE_CATEGORIES } from "./diveEngine";

// Maps the backend's expectedAssetClasses (11-way asset-class enum) down to
// the 9 CORE_CATEGORIES labels the Suggestions screen operates on.
export function expectedCoreCategories(context) {
  const set = new Set();
  if (!context) return set;
  (context.expectedAssetClasses || []).forEach((c) => {
    const label = ASSET_CLASS_LABELS[c];
    if (label && CORE_CATEGORIES.includes(label)) set.add(label);
  });
  return set;
}

// Is this CORE_CATEGORY part of what's realistically expected for this user's
// corpus size and life stage right now? Fails OPEN (returns true) when there's
// no context yet, so the UI never silently suppresses a legitimate suggestion
// just because the score hasn't loaded.
export function isCategoryExpected(categoryLabel, context) {
  if (!context) return true;
  return expectedCoreCategories(context).has(categoryLabel);
}

// Short, reassuring "why we're not nudging you further" copy for the top of
// Suggestions — the direct fix for "₹10,000 in 3 equity stocks is not a
// problem worth flagging" needing a message, not just a fair number.
export function contextSummaryMessage(context) {
  if (!context) return null;
  const { corpusTier, persona, missingExpectedAssetClasses } = context;
  if (!corpusTier || !persona) return null;

  if (!missingExpectedAssetClasses || missingExpectedAssetClasses.length === 0) {
    return `At this stage — a ${corpusTier.label.toLowerCase()} portfolio, ${persona.label} — your current mix is a solid, complete starting point. As your corpus grows, we'll suggest when to branch out.`;
  }

  const names = missingExpectedAssetClasses.map((c) => ASSET_CLASS_LABELS[c] || c);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Given your ${corpusTier.label.toLowerCase()} portfolio and ${persona.label} stage, ${list} would be worth adding next — no need to chase every asset class at once.`;
}

// Copy shown in place of a generic "Add to X" nudge when a category isn't yet
// part of the user's expected set — explicitly reassuring, not silent.
export function deferredIncreaseNote(categoryLabel, context) {
  const stage = context?.persona?.label ? ` at your ${context.persona.label.toLowerCase()} stage` : "";
  return `${categoryLabel} isn't a priority${stage} yet — this isn't a problem, just not needed right now. We'll flag it once it makes sense for your corpus.`;
}

// Copy for the OPPOSITE case: a generic "Trim X" nudge fires because X is the
// user's only expected category and the model's ideal range assumes a
// multi-class split that isn't realistic yet — X itself isn't the problem,
// there's just nowhere sensible to move the money yet.
export function deferredReduceNote(categoryLabel, context) {
  const stage = context?.persona?.label ? ` at your ${context.persona.label.toLowerCase()} stage` : "";
  return `${categoryLabel} is exactly where your money should be${stage} — there's no other category worth splitting it into yet, so there's nothing to trim. We'll suggest a spread once your corpus grows.`;
}
