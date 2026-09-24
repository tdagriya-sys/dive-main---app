import { api } from "../../lib/api";

// A step-up token proves the staff member re-confirmed their password
// recently (backend/src/middleware/auth.ts::requireStepUp) — required for
// publishing/rolling back a config, on top of an already-valid session. Kept
// in memory only, like the access token in lib/api.js, and reused across
// actions until it expires or a request tells us it's no longer accepted.
let stepUpToken = null;

export function getStepUpToken() {
  return stepUpToken;
}

export function setStepUpToken(token) {
  stepUpToken = token;
}

export function isStepUpRequiredError(err) {
  return err?.response?.status === 401 && err?.response?.data?.error === "STEP_UP_REQUIRED";
}

// Re-confirms the current staff member's password and stores the resulting
// step-up token for reuse. Throws (with the backend's own message) on a
// wrong password.
export async function requestStepUp(password) {
  const { data } = await api.post("/auth/staff/step-up", { password });
  stepUpToken = data.stepUpToken;
  return stepUpToken;
}
