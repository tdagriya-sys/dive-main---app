import React from "react";
import LinkUrlInput from "./LinkUrlInput";

// Turns the form's working value into what's sent to the API: a button only
// counts once BOTH its text and its link are filled in (the backend requires
// both), otherwise it's simply left off.
export function cleanButton(button) {
  const label = (button?.label || "").trim();
  const url = (button?.url || "").trim();
  return label && url ? { label, url } : undefined;
}

// An optional call-to-action button under the message — a styled button on
// email and the pop-up card, and a simple "Label →" text link on the bell.
export default function ButtonFields({ testIdPrefix, value, onChange }) {
  const button = value || {};
  const half = Boolean((button.label || "").trim()) !== Boolean((button.url || "").trim());
  function update(field, fieldValue) {
    const next = { ...button, [field]: fieldValue };
    onChange(next.label || next.url ? next : undefined);
  }
  return (
    <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
      <p className="text-xs font-bold mb-1">Button (optional)</p>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
        A button under the message that sends people to a page. On the bell (in-app) it shows as a simple text link.
      </p>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2">
        Button text
        <input
          type="text"
          data-testid={`${testIdPrefix}-label-input`}
          value={button.label || ""}
          onChange={(e) => update("label", e.target.value)}
          maxLength={40}
          placeholder="e.g. Get started"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <LinkUrlInput testIdPrefix={`${testIdPrefix}-url`} label="Button link" value={button.url} onChange={(v) => update("url", v)} />
      {half && (
        <p className="text-[10px] text-[var(--red)] mt-2" data-testid={`${testIdPrefix}-incomplete-warning`}>
          The button won't be added until both its text and its link are filled in.
        </p>
      )}
    </div>
  );
}
