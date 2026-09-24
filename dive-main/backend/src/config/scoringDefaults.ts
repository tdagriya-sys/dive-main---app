import { ScoringConfigPayload } from "../models/ScoringConfig";

/**
 * The exact values `diveScoreService.ts` used as hardcoded constants before
 * Phase 2 of docs/ADMIN_PANEL_PLAN.md — extracted verbatim, not re-derived, so
 * publishing nothing (or rolling back to version 1) reproduces the model's
 * original behaviour exactly. See docs/DIVE_SCORE_MODEL.md for the reasoning
 * behind each of these — this file is just the numbers.
 */
export const SCORING_CONFIG_DEFAULTS: ScoringConfigPayload = {
  compositeWeights: {
    concentration: 0.17,
    volatility: 0.12,
    drawdown: 0.12,
    var: 0.08,
    liquidity: 0.12,
    beta: 0.08,
    correlation: 0.08,
    diversificationRatio: 0.04,
    contextFit: 0.11,
    stockCountFit: 0.08,
  },
  subScoreBestAt: {
    volatilityBestAt: 0.03,
    drawdownBestAt: -0.02,
    varWorstAt: -0.08,
    varBestAt: -0.005,
    betaWorstAt: 1.8,
    betaBestAt: 0.2,
    correlationWorstAt: 1,
    correlationBestAt: -0.2,
    diversificationRatioWorstAt: 1.0,
    diversificationRatioBestAt: 2.2,
  },
  concentrationSubWeights: {
    apparent: 0.5,
    real: 0.15,
    name: 0.2,
    withinClass: 0.15,
  },
  liquidityTiers: {
    CRYPTO: 95,
    EQUITY: 95,
    ETF: 90,
    MUTUAL_FUND: 70,
    GOLD: 75,
    SILVER: 65,
    REIT: 60,
    INVIT: 55,
    BOND: 50,
    ULIP_INSURANCE: 20,
    FD: 15,
    PF: 8,
  },
  stockCountBreakpoints: [
    [1, 10],
    [3, 25],
    [8, 60],
    [12, 90],
    [15, 100],
    [30, 100],
    [40, 75],
    [50, 60],
    [75, 45],
    [100, 40],
  ],
  cryptoWithinClassCap: 70,
  equitySectorSpreadTarget: 5,
  singleClassCorrelationScores: {
    whenExpectedClassesLE1: 50,
    otherwise: 20,
  },
  drawdownUnrecoveredPenalty: 15,
};
