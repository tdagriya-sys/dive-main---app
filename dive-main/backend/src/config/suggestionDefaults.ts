import { SuggestionConfigPayload } from "../models/SuggestionConfig";

/**
 * The exact values `frontend/src/lib/diveEngine.js` used as hardcoded
 * constants before Phase 2 of docs/ADMIN_PANEL_PLAN.md — this backend config
 * (served via GET /api/score/config) becomes the source of truth going
 * forward; diveEngine.js keeps these same literals as its OFFLINE fallback
 * only (used if that fetch hasn't completed yet, or fails).
 *
 * `diversificationCap.High` was `Infinity` in the original code — not valid
 * JSON, so it's `null` here (see diveEngine.js's own handling: `?? Infinity`
 * on the frontend side).
 */
export const SUGGESTION_CONFIG_DEFAULTS: SuggestionConfigPayload = {
  coreCategories: ["Equity", "Mutual Funds", "Bonds", "Gold/Silver", "REIT/InvIT", "FD/RD", "PF", "ETF", "Insurance", "Crypto"],
  idealRanges: {
    Conservative: {
      Equity: [20, 30],
      "Mutual Funds": [15, 25],
      Bonds: [20, 30],
      "Gold/Silver": [8, 12],
      "REIT/InvIT": [5, 10],
      "FD/RD": [10, 20],
      PF: [10, 18],
      ETF: [3, 8],
      Insurance: [5, 10],
      Crypto: [0, 2],
    },
    Balanced: {
      Equity: [25, 35],
      "Mutual Funds": [20, 30],
      Bonds: [15, 25],
      "Gold/Silver": [8, 12],
      "REIT/InvIT": [8, 12],
      "FD/RD": [8, 15],
      PF: [8, 14],
      ETF: [5, 10],
      Insurance: [3, 7],
      Crypto: [0, 5],
    },
    Aggressive: {
      Equity: [35, 50],
      "Mutual Funds": [20, 30],
      Bonds: [5, 15],
      "Gold/Silver": [5, 10],
      "REIT/InvIT": [8, 15],
      "FD/RD": [3, 8],
      PF: [3, 6],
      ETF: [5, 12],
      Insurance: [2, 5],
      Crypto: [2, 8],
    },
  },
  returnTier: {
    "FD/RD": "low",
    PF: "low",
    Bonds: "low",
    Insurance: "low",
    "Gold/Silver": "medium",
    "REIT/InvIT": "medium",
    "Mutual Funds": "medium",
    Equity: "high",
    ETF: "high",
    Crypto: "high",
  },
  returnBias: { Modest: -1, Moderate: 0, High: 1 },
  diversificationCap: { Low: 2, Medium: 3, High: null },
  fastPathBlend: { apparent: 0.65, real: 0.15, name: 0.2 },
};
