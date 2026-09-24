import { api } from "../../lib/api";
import { getStepUpToken } from "./stepUp";

// Thin wrapper over the three near-identical admin config lifecycles
// (/api/admin/{scoring,context,suggestion}-config — see
// backend/src/routes/admin.routes.ts's mountConfigRoutes). One shared module
// so ScoringModel.jsx/ContextModel.jsx/SuggestionModel.jsx don't each
// reinvent the same 8 calls.
export function configApiFor(base) {
  return {
    getActive: () => api.get(`${base}/active`).then((r) => r.data.payload),
    getDraft: () => api.get(`${base}/draft`).then((r) => r.data.draft),
    updateDraft: (payload) => api.patch(`${base}/draft`, { payload }).then((r) => r.data.draft),
    validateDraft: (payload) => api.post(`${base}/draft/validate`, { payload }).then((r) => r.data),
    publish: (changeNote, stepUpToken = getStepUpToken()) =>
      api.post(`${base}/publish`, { changeNote }, { headers: { "x-step-up-token": stepUpToken } }).then((r) => r.data.version),
    rollback: (targetVersion, stepUpToken = getStepUpToken()) =>
      api.post(`${base}/rollback`, { targetVersion }, { headers: { "x-step-up-token": stepUpToken } }).then((r) => r.data.version),
    getHistory: () => api.get(`${base}/history`).then((r) => r.data.history),
    getVersion: (version) => api.get(`${base}/versions/${version}`).then((r) => r.data.version),
    // Scoring/Context only — see simulationService.ts's own comment on why
    // Suggestion has no simulate route. Read-only, no step-up needed.
    simulate: (payload, sampleSize) => api.post(`${base}/simulate`, { payload, sampleSize }).then((r) => r.data),
  };
}
