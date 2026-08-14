// Shared constants for the Divve Bot extension. Pure config — no DOM/chrome.*
// APIs here so this file can be imported from background, content, and popup
// contexts alike.

// Matches backend/src/config/env.ts's default PORT (8000) — override from the
// popup's settings panel for a non-local deployment.
export const DEFAULT_API_BASE = "http://localhost:8000/api";

export const STORAGE_KEYS = {
  apiBase: "divve_api_base",
  accessToken: "divve_access_token",
  // Only ever populated when the backend was told clientType: "extension"
  // (see backend/src/controllers/authController.ts's wantsRefreshTokenInBody)
  // — the web app never receives this, it stays on its httpOnly cookie.
  refreshToken: "divve_refresh_token",
  userEmail: "divve_user_email",
};

// Illustrative, not fitted to a dataset — same spirit as the "Fit for you"
// concentration guardrail already used in frontend/src/screens/AskDive.jsx's
// wouldBeTopHolding check. A single issuer at/above this share of the
// portfolio counts as "already maxed" for the same-instrument warning.
export const SINGLE_NAME_MAX_PCT = 20;

// Rounded scores/percentages below this delta count as "practically
// unchanged" rather than a real up/down move, so the message logic doesn't
// flip-flop on +/-1 rounding noise.
export const FLAT_EPSILON = 1;
