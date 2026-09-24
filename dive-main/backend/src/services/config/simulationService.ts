import { Holding } from "../../models/Holding";
import { User } from "../../models/User";
import { ScoringConfigPayload } from "../../models/ScoringConfig";
import { ContextConfigPayload } from "../../models/ContextConfig";
import { LookthroughConfigPayload } from "../../models/LookthroughConfig";
import { computeDiveScoreBreakdownUncached } from "../diveScoreService";
import { getActiveScoringConfig } from "./scoringConfigService";
import { getActiveContextConfig } from "./contextConfigService";
import { getActiveLookthroughConfig } from "./lookthroughConfigService";

/**
 * The admin config simulation sandbox (Phase 2 of docs/ADMIN_PANEL_PLAN.md
 * §5.2/§7 — "simulate button + results" on the Scoring/Context/Lookthrough
 * Model editors). Deliberately synchronous and bounded to a small sample, per
 * the plan's own resolved decision — no BullMQ/queue infra for this: an admin
 * clicks Simulate, waits a few seconds, sees the result. A real
 * "recompute every user's score" job is a different, much heavier feature
 * this deliberately is NOT.
 *
 * Runs `computeDiveScoreBreakdownUncached` TWICE per sampled user — once
 * with the currently ACTIVE configs (baseline), once with the admin's
 * CANDIDATE config swapped in (candidate) — and reports how the composite
 * score would shift. Never touches computeDiveScoreBreakdown's per-user
 * cache (deliberately using the uncached form for both runs) and never
 * writes anything — this is a read-only preview, not a real recompute.
 *
 * Suggestion config has no simulate endpoint: it doesn't feed this scoring
 * function at all (see SuggestionConfig.ts's own comment) — it only affects
 * the frontend's fast-path allocation-range display, which this backend
 * sandbox has no way to preview.
 */

const DEFAULT_SAMPLE_SIZE = 20;
const MAX_SAMPLE_SIZE = 100;

function clampSampleSize(requested?: number): number {
  if (!Number.isFinite(requested) || !requested || requested < 1) return DEFAULT_SAMPLE_SIZE;
  return Math.min(MAX_SAMPLE_SIZE, Math.floor(requested as number));
}

// Real (non-staff) users who actually hold something — scoring an empty
// portfolio would only ever produce two identical zero breakdowns, telling
// the admin nothing about the config change. Bounded by `limit` up front
// (not sliced after fetching everyone) so this stays cheap regardless of
// how large the user base grows.
async function pickSampleUserIds(limit: number): Promise<string[]> {
  const holdingUserIds = await Holding.distinct("userId");
  if (holdingUserIds.length === 0) return [];
  const users = await User.find({ _id: { $in: holdingUserIds }, staffRole: null }).limit(limit).select("_id").lean();
  return users.map((u) => String(u._id));
}

export interface SimulationResult {
  requestedSampleSize: number;
  sampleSize: number; // how many real users with holdings were actually found/scored
  avgBaselineScore: number;
  avgCandidateScore: number;
  avgDelta: number;
  minDelta: number;
  maxDelta: number;
  improvedCount: number;
  worsenedCount: number;
  unchangedCount: number;
  // Just the deltas, not which user they belong to — an admin comparing a
  // config change has no legitimate need to tie a specific score shift back
  // to a specific person; this is an aggregate impact preview, not a
  // per-user audit tool.
  sampleDeltas: number[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A named bundle rather than three positional params each — with Lookthrough
// joining Scoring/Context as a third simulatable config, threading each one
// through runSimulation/computeDiveScoreBreakdownUncached as its own
// parameter would make every call site an unreadable wall of positional
// scoring/context/lookthrough args in a row.
export interface ConfigSet {
  scoring: ScoringConfigPayload;
  context: ContextConfigPayload;
  lookthrough: LookthroughConfigPayload;
}

async function runSimulation(baseline: ConfigSet, candidate: ConfigSet, requestedSampleSize?: number): Promise<SimulationResult> {
  const limit = clampSampleSize(requestedSampleSize);
  const userIds = await pickSampleUserIds(limit);

  const sampleDeltas: number[] = [];
  let baselineTotal = 0;
  let candidateTotal = 0;

  for (const userId of userIds) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential: a
    // bounded, occasional admin action, not a hot path worth the complexity
    // of parallelizing against shared price-history fetches.
    const [baselineResult, candidateResult] = await Promise.all([
      computeDiveScoreBreakdownUncached(userId, baseline.scoring, baseline.context, baseline.lookthrough),
      computeDiveScoreBreakdownUncached(userId, candidate.scoring, candidate.context, candidate.lookthrough),
    ]);
    baselineTotal += baselineResult.compositeScore;
    candidateTotal += candidateResult.compositeScore;
    sampleDeltas.push(candidateResult.compositeScore - baselineResult.compositeScore);
  }

  const sampleSize = sampleDeltas.length;
  if (sampleSize === 0) {
    return {
      requestedSampleSize: limit,
      sampleSize: 0,
      avgBaselineScore: 0,
      avgCandidateScore: 0,
      avgDelta: 0,
      minDelta: 0,
      maxDelta: 0,
      improvedCount: 0,
      worsenedCount: 0,
      unchangedCount: 0,
      sampleDeltas: [],
    };
  }

  return {
    requestedSampleSize: limit,
    sampleSize,
    avgBaselineScore: round2(baselineTotal / sampleSize),
    avgCandidateScore: round2(candidateTotal / sampleSize),
    avgDelta: round2(sampleDeltas.reduce((s, d) => s + d, 0) / sampleSize),
    minDelta: Math.min(...sampleDeltas),
    maxDelta: Math.max(...sampleDeltas),
    improvedCount: sampleDeltas.filter((d) => d > 0).length,
    worsenedCount: sampleDeltas.filter((d) => d < 0).length,
    unchangedCount: sampleDeltas.filter((d) => d === 0).length,
    sampleDeltas,
  };
}

async function getActiveConfigSet(): Promise<ConfigSet> {
  const [scoring, context, lookthrough] = await Promise.all([getActiveScoringConfig(), getActiveContextConfig(), getActiveLookthroughConfig()]);
  return { scoring, context, lookthrough };
}

// Candidate SCORING config vs. the active one — context/lookthrough held
// constant (the active ones) on both sides, so only the scoring change is
// isolated.
export async function simulateScoringConfigChange(candidatePayload: ScoringConfigPayload, sampleSize?: number): Promise<SimulationResult> {
  const active = await getActiveConfigSet();
  return runSimulation(active, { ...active, scoring: candidatePayload }, sampleSize);
}

// Candidate CONTEXT config vs. the active one — scoring/lookthrough held constant.
export async function simulateContextConfigChange(candidatePayload: ContextConfigPayload, sampleSize?: number): Promise<SimulationResult> {
  const active = await getActiveConfigSet();
  return runSimulation(active, { ...active, context: candidatePayload }, sampleSize);
}

// Candidate LOOKTHROUGH config vs. the active one — scoring/context held constant.
export async function simulateLookthroughConfigChange(candidatePayload: LookthroughConfigPayload, sampleSize?: number): Promise<SimulationResult> {
  const active = await getActiveConfigSet();
  return runSimulation(active, { ...active, lookthrough: candidatePayload }, sampleSize);
}
