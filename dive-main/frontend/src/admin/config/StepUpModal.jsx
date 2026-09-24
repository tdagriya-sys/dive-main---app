import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { requestStepUp } from "./stepUp";

// Shared by every publish/rollback action across the three config editors
// (Scoring/Context/Suggestion Model screens) — collects a fresh password
// confirmation and hands the resulting step-up token back to the caller via
// onSuccess, which is expected to retry whatever it was doing.
export default function StepUpModal({ open, onCancel, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const token = await requestStepUp(password);
      setPassword("");
      onSuccess(token);
    } catch (err) {
      setError(err?.response?.data?.message || "Incorrect password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="admin-stepup-modal">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <h2 className="font-heading font-black text-lg mb-1">Confirm your password</h2>
        <p className="text-sm text-[var(--text-secondary)] mb-4">This action needs a fresh password confirmation.</p>
        <input
          type="password"
          autoFocus
          data-testid="admin-stepup-password-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-[var(--border)] bg-transparent px-4 py-2.5 text-sm font-semibold mb-3 outline-none"
        />
        {error && (
          <p className="text-sm text-[var(--red)] mb-3" data-testid="admin-stepup-error">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button type="button" data-testid="admin-stepup-cancel-btn" onClick={onCancel} className="text-sm font-bold text-[var(--text-tertiary)]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !password}
            data-testid="admin-stepup-submit-btn"
            className="gold-btn flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />} Confirm
          </button>
        </div>
      </form>
    </div>
  );
}
