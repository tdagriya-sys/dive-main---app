import React, { useState } from "react";
import { Loader2 } from "lucide-react";

// Shared by every config editor's "Publish…" flow — a change note is
// required (matches the backend's publish controllers rejecting an empty
// one), and Confirm is disabled while the draft still fails validation.
export default function PublishPanel({ open, onCancel, onConfirm, publishing, disabled }) {
  const [changeNote, setChangeNote] = useState("");
  if (!open) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-config-publish-panel">
      <p className="text-sm font-bold mb-2">Publish this draft</p>
      <textarea
        data-testid="admin-config-changenote-input"
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
        placeholder="Describe what changed and why (required)"
        rows={3}
        className="w-full rounded-xl border border-[var(--border)] bg-transparent px-4 py-2.5 text-sm outline-none mb-3"
      />
      <div className="flex items-center justify-end gap-3">
        <button type="button" data-testid="admin-config-publish-cancel-btn" onClick={onCancel} className="text-sm font-bold text-[var(--text-tertiary)]">
          Cancel
        </button>
        <button
          type="button"
          data-testid="admin-config-publish-confirm-btn"
          disabled={publishing || disabled || !changeNote.trim()}
          onClick={() => onConfirm(changeNote.trim())}
          className="gold-btn flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          {publishing && <Loader2 size={14} className="animate-spin" />} Publish
        </button>
      </div>
    </div>
  );
}
