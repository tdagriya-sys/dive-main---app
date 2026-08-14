// The "fit for you" verdict: given the user's current holdings, their
// canonical Divve Score breakdown, their risk profile, and a hypothetical
// purchase (instrument name/asset class/amount read off the order page),
// produce a tone + title + message the same way frontend/src/screens/
// AskDive.jsx's FitForYouCard computes its before/after numbers, but taking
// the extra step of turning those numbers into the dynamic verdict copy this
// extension actually needs to show.
//
// This module is pure (no chrome.*/DOM) so it's independently testable.

import {
  ASSET_CLASS_LABELS,
  IDEAL_RANGES,
  apparentDiversification,
  realDiversification,
  diveScore,
  totalInvested,
  normalizeIssuer,
  segmentBreakdown,
} from "./diveEngine.js";
import { SINGLE_NAME_MAX_PCT, FLAT_EPSILON } from "./config.js";

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

// -1 / 0 / 1 — deltas smaller than FLAT_EPSILON count as "practically
// unchanged" so the message logic doesn't flip-flop on rounding noise.
function sign(delta) {
  if (delta > FLAT_EPSILON) return 1;
  if (delta < -FLAT_EPSILON) return -1;
  return 0;
}

/**
 * @param {object} params
 * @param {Array}  params.holdings   Adapted holdings (see diveEngine.adaptHolding) — the user's CURRENT portfolio, before this trade.
 * @param {object|null} params.scoreBreakdown  Canonical DiveScoreBreakdown from GET /api/score/breakdown, or null/hasHoldings:false if the user has none yet.
 * @param {"Conservative"|"Balanced"|"Aggressive"} params.riskProfile
 * @param {{ segment: string, assetClass: string, name: string, amount: number }} params.extra  The hypothetical purchase, read off the order page.
 * @param {boolean} [params.assetClassConfident]  False when neither the Dive instrument master nor the page itself actually confirmed this instrument's asset class (background.js's resolveInstrument) — extra.assetClass is then just the Equity default, not a verified fact.
 */
export function buildFitVerdict({ holdings, scoreBreakdown, riskProfile, extra, assetClassConfident = true }) {
  const baseHoldings = holdings || [];

  // ---- Anchor on the canonical score/diversification (same number the app
  // shows on Home/X-Ray) and apply the fast concentration-only formula's
  // ESTIMATED DELTA on top — identical pattern to AskDive.jsx's
  // FitForYouCard, so this extension's numbers never quietly disagree with
  // what the user sees inside the actual Dive app. ----
  const hasCanonical = !!scoreBreakdown?.hasHoldings;
  const baseScore = hasCanonical ? scoreBreakdown.compositeScore : diveScore(baseHoldings);
  const rawDelta = diveScore(baseHoldings, extra) - diveScore(baseHoldings);
  const concentrationWeight = scoreBreakdown?.weights?.concentration ?? 0.17;
  const newScore = clamp(baseScore + rawDelta * concentrationWeight);
  const scoreDelta = newScore - baseScore;

  const baseAppRaw = apparentDiversification(baseHoldings);
  const newAppRaw = apparentDiversification(baseHoldings, extra);
  const baseRealRaw = realDiversification(baseHoldings);
  const newRealRaw = realDiversification(baseHoldings, extra);
  const baseApp = hasCanonical ? scoreBreakdown.apparentDiversificationPct : baseAppRaw;
  const baseReal = hasCanonical ? scoreBreakdown.realDiversificationPct : baseRealRaw;
  const newApp = clamp(baseApp + (newAppRaw - baseAppRaw));
  // Real can never exceed apparent — same invariant the backend composite enforces.
  const newReal = Math.min(newApp, clamp(baseReal + (newRealRaw - baseRealRaw)));
  const appDelta = newApp - baseApp;
  const realDelta = newReal - baseReal;

  // ---- Context checks ----
  const segmentLabel = ASSET_CLASS_LABELS[extra.assetClass] || extra.segment;
  const isNewAssetClass = !baseHoldings.some((h) => h.segment === segmentLabel && h.amount > 0);

  const totalBefore = totalInvested(baseHoldings);
  const segTotalBefore = segmentBreakdown(baseHoldings).find((s) => s.name === segmentLabel)?.amount || 0;
  const segPctBefore = totalBefore > 0 ? (segTotalBefore / totalBefore) * 100 : 0;
  const [, hiBound] = IDEAL_RANGES[riskProfile]?.[segmentLabel] || IDEAL_RANGES.Balanced[segmentLabel] || [0, 100];
  const isAssetClassOverexposed = !isNewAssetClass && segPctBefore > hiBound;

  const issuerKey = normalizeIssuer(extra.name) || extra.name.trim().toLowerCase();
  const existingSameIssuer = baseHoldings.filter((h) => (normalizeIssuer(h.name) || h.name.trim().toLowerCase()) === issuerKey);
  const issuerAmountBefore = existingSameIssuer.reduce((s, h) => s + h.amount, 0);
  const issuerPctBefore = totalBefore > 0 ? (issuerAmountBefore / totalBefore) * 100 : 0;
  const totalAfter = totalBefore + extra.amount;
  const issuerPctAfter = totalAfter > 0 ? ((issuerAmountBefore + extra.amount) / totalAfter) * 100 : 0;
  const isSameInstrumentAlreadyMaxed = existingSameIssuer.length > 0 && issuerPctBefore >= SINGLE_NAME_MAX_PCT;
  const isSameInstrumentWouldMax = !isSameInstrumentAlreadyMaxed && existingSameIssuer.length > 0 && issuerPctAfter >= SINGLE_NAME_MAX_PCT;

  const nums = {
    baseScore, newScore, scoreDelta,
    baseApp, newApp, appDelta,
    baseReal, newReal, realDelta,
    segPctBefore: Math.round(segPctBefore), hiBound,
    issuerPctBefore: Math.round(issuerPctBefore), issuerPctAfter: Math.round(issuerPctAfter),
  };

  // ---- Priority-ordered classification. Specific, explainable red flags
  // first; the general score/diversification movement matrix as the
  // fallback once none of those apply. ----
  let caseId, tone, title, message;

  if (isSameInstrumentAlreadyMaxed) {
    caseId = "SAME_INSTRUMENT_ALREADY_MAXED";
    tone = "danger";
    title = "You're already heavily into this one";
    message = `${extra.name} already makes up ${nums.issuerPctBefore}% of your portfolio — well past a healthy single-name share. Adding ₹${Math.round(extra.amount).toLocaleString("en-IN")} more concentrates you further rather than diversifying you.`;
  } else if (isSameInstrumentWouldMax) {
    caseId = "SAME_INSTRUMENT_WOULD_MAX";
    tone = "warn";
    title = "This would push one name too far";
    message = `You already hold ${extra.name}. This purchase would take it to ${nums.issuerPctAfter}% of your portfolio — above a healthy single-name share (${SINGLE_NAME_MAX_PCT}%).`;
  } else if (isAssetClassOverexposed) {
    caseId = "ASSET_CLASS_OVEREXPOSED";
    tone = "warn";
    title = `${segmentLabel} is already over its ideal range`;
    message = `${segmentLabel} is already ${nums.segPctBefore}% of your portfolio, above the ${hiBound}% band that fits your ${riskProfile.toLowerCase()} profile. This adds more to a class you're already overexposed to.`;
  } else if (isNewAssetClass) {
    caseId = "NEW_ASSET_CLASS";
    tone = "good";
    title = "A category you haven't touched yet";
    message = `You currently hold ₹0 in ${segmentLabel}. This is a genuine step into new territory — Divve Score ${baseScore}→${newScore}, diversification ${Math.round(baseApp)}%→${Math.round(newApp)}%.`;
  } else {
    const sScore = sign(scoreDelta);
    const sApp = sign(appDelta);
    const sReal = sign(realDelta);

    if (sApp === 1 && sReal <= 0) {
      caseId = "APPARENT_ONLY";
      tone = "warn";
      title = "Looks more diversified than it is";
      message = `Apparent diversification would rise to ${Math.round(newApp)}%, but real diversification stays around ${Math.round(newReal)}% — this likely overlaps with something you already hold, so it doesn't reduce your real concentration as much as it looks.`;
    } else if (sScore === 1 && sApp === 1 && sReal === 1) {
      caseId = "BOTH_IMPROVING";
      tone = "good";
      title = "This is a good fit";
      message = `Both your Divve Score (${baseScore}→${newScore}) and your diversification (apparent ${Math.round(baseApp)}%→${Math.round(newApp)}%, real ${Math.round(baseReal)}%→${Math.round(newReal)}%) improve with this trade.`;
    } else if (sScore === 1 && sApp === 0 && sReal === 0) {
      caseId = "PARTIAL_IMPROVEMENT";
      tone = "good";
      title = "A small step up";
      message = `Your Divve Score edges up (${baseScore}→${newScore}), though it doesn't meaningfully change how diversified you are.`;
    } else if (sScore === 0 && (sApp === 1 || sReal === 1)) {
      caseId = "PARTIAL_IMPROVEMENT";
      tone = "good";
      title = "Diversification improves, score holds steady";
      message = `This doesn't move your headline Divve Score much yet (${baseScore}→${newScore}), but it does genuinely diversify you further (apparent ${Math.round(baseApp)}%→${Math.round(newApp)}%, real ${Math.round(baseReal)}%→${Math.round(newReal)}%).`;
    } else if (sScore === 0 && sApp === 0 && sReal === 0) {
      caseId = "ALL_FLAT";
      tone = "neutral";
      title = "Roughly a wash";
      message = `This doesn't move your Divve Score or your diversification either way (score ${baseScore}→${newScore}).`;
    } else {
      caseId = "DECLINING";
      tone = "danger";
      title = "This pulls you in the wrong direction";
      message = `This would take your Divve Score from ${baseScore} to ${newScore} and diversification from ${Math.round(baseApp)}% to ${Math.round(newApp)}% apparent / ${Math.round(baseReal)}% to ${Math.round(newReal)}% real — you'd be concentrating rather than diversifying.`;
    }
  }

  if (!assetClassConfident) {
    // Every case above assumes extra.assetClass/segment is correct — when
    // it's actually just the unverified Equity default (see background.js's
    // resolveInstrument), a specific claim like "Equity is already over its
    // ideal range" would be stated as fact when it might be entirely wrong
    // (e.g. an ETF the Dive instrument master hasn't ingested yet, shown as
    // an Equity-overexposure warning). Flag that plainly rather than let a
    // guess read as a verified fact.
    message = `${message} (Couldn't confirm ${extra.name}'s exact asset class from Angel One's page or your Divve instrument list — this estimate assumes Equity, so treat the specifics with caution.)`;
  }

  return { caseId, tone, title, message, numbers: nums, assetClassConfident };
}

export const TONE_BADGE = {
  good: "APPROVES",
  warn: "HEADS UP",
  neutral: "NEUTRAL",
  danger: "WARNING",
};
