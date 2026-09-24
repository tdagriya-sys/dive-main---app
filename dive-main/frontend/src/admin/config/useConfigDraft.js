import { useState, useEffect, useCallback, useRef } from "react";
import { configApiFor } from "./configApi";
import { isStepUpRequiredError } from "./stepUp";

// Shared lifecycle for all three admin config editors (Scoring/Context/
// Suggestion Model screens) — draft load/edit/save, live (debounced)
// validation, and publish/rollback with the shared step-up flow. Each screen
// only needs to render fields bound to `payload`/`setPayload` and the shared
// toolbar/history/step-up components using what this hook returns.
export function useConfigDraft(base) {
  const api = useRef(configApiFor(base)).current;

  const [draft, setDraft] = useState(null); // the server's draft document (incl. status/version)
  const [payload, setPayload] = useState(null); // local working copy being edited
  const [history, setHistory] = useState(null);
  const [validation, setValidation] = useState({ valid: true, errors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [stepUpRequest, setStepUpRequest] = useState(null); // { resolve, reject } while the modal is open

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, h] = await Promise.all([api.getDraft(), api.getHistory()]);
      setDraft(d);
      setPayload(d.payload);
      setHistory(h);
    } catch {
      setError("Couldn't load this config. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Debounced live validation as the admin edits — a dry run, nothing is
  // persisted (see the backend's validateDraft controllers).
  useEffect(() => {
    if (!payload) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.validateDraft(payload);
        if (!cancelled) setValidation(result);
      } catch {
        // A transient failure here just leaves the last known validation
        // standing — never block editing on it.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payload, api]);

  const dirty = Boolean(draft && payload && JSON.stringify(draft.payload) !== JSON.stringify(payload));
  const activeEntry = history?.find((h) => h.status === "active");

  async function saveDraft() {
    setSaving(true);
    try {
      const updated = await api.updateDraft(payload);
      setDraft(updated);
      setPayload(updated.payload);
      return updated;
    } finally {
      setSaving(false);
    }
  }

  function requestStepUpToken() {
    return new Promise((resolve, reject) => {
      setStepUpRequest({ resolve, reject });
    });
  }
  function resolveStepUp(token) {
    stepUpRequest?.resolve(token);
    setStepUpRequest(null);
  }
  function cancelStepUp() {
    stepUpRequest?.reject(new Error("Step-up cancelled"));
    setStepUpRequest(null);
  }

  // Runs a step-up-gated call, prompting for a password only if the cached
  // token (if any) is missing/expired, then retrying exactly once.
  async function runStepUpGated(call) {
    try {
      return await call();
    } catch (err) {
      if (!isStepUpRequiredError(err)) throw err;
      const token = await requestStepUpToken();
      return call(token);
    }
  }

  async function publish(changeNote) {
    setPublishing(true);
    try {
      if (dirty) await saveDraft(); // publish must reflect exactly what's on screen
      const version = await runStepUpGated((token) => api.publish(changeNote, token));
      await reload();
      return version;
    } finally {
      setPublishing(false);
    }
  }

  async function rollback(targetVersion) {
    setPublishing(true);
    try {
      const version = await runStepUpGated((token) => api.rollback(targetVersion, token));
      await reload();
      return version;
    } finally {
      setPublishing(false);
    }
  }

  return {
    draft,
    payload,
    setPayload,
    history,
    activeEntry,
    validation,
    loading,
    error,
    saving,
    publishing,
    dirty,
    saveDraft,
    publish,
    rollback,
    stepUpModalOpen: Boolean(stepUpRequest),
    resolveStepUp,
    cancelStepUp,
    // Forwarded so HistoryPanel can fetch a past version's full payload for
    // its version-diff view without needing its own configApi instance.
    getVersion: api.getVersion,
  };
}
