import React from "react";
import HighlightStyleFields from "./HighlightStyleFields";
import LinkUrlInput from "./LinkUrlInput";

// A separate, optional headline block (image and/or a short line of
// always-highlighted text) rendered ABOVE the main body — see backend's
// models/NotificationCategory.ts::INotificationCallout. Unlike the body's
// own `==highlighted==` spans, this field's text needs no markers at all:
// the whole thing IS the highlight, styled by its own, independent
// highlightStyle (set via `value.highlightStyle`) — so e.g. a "New feature"
// banner can use a different accent than an inline mention in the body.
// Both `text` and `imageUrl` are optional; leaving both blank is the
// default (nothing renders).
// A callout with no text, image, or link is just "no callout" — its
// highlight style alone renders nothing — so it's treated as absent when a
// payload is built (and, for a saved template/pop-up, as an explicit clear).
export function cleanCallout(callout) {
  if (!callout) return undefined;
  return callout.text || callout.imageUrl || callout.linkUrl ? callout : undefined;
}

export default function CalloutFields({ testIdPrefix, value, onChange }) {
  const callout = value || {};
  function update(field, fieldValue) {
    onChange({ ...callout, [field]: fieldValue || undefined });
  }
  return (
    <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
      <p className="text-xs font-bold mb-1">Callout (optional)</p>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
        A headline image and/or a short line of text shown above the main body — always highlighted, no ==markers== needed here.
        Only shows on email and the pop-up card — never on the bell (in-app).
      </p>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2">
        Image or GIF URL
        <input
          type="text"
          data-testid={`${testIdPrefix}-image-input`}
          value={callout.imageUrl || ""}
          onChange={(e) => update("imageUrl", e.target.value)}
          placeholder="https://example.com/banner.gif"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2">
        Highlighted text
        <input
          type="text"
          data-testid={`${testIdPrefix}-text-input`}
          value={callout.text || ""}
          onChange={(e) => update("text", e.target.value)}
          placeholder="e.g. 50% off — today only!"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <div className="mb-2">
        <LinkUrlInput
          testIdPrefix={`${testIdPrefix}-link`}
          label="Link (optional — makes the whole callout, image and text, clickable)"
          value={callout.linkUrl}
          onChange={(v) => update("linkUrl", v)}
        />
      </div>
      <p className="text-[10px] text-[var(--text-secondary)] mb-1">Highlight style for the text above</p>
      <HighlightStyleFields testIdPrefix={`${testIdPrefix}-style`} value={callout.highlightStyle} onChange={(style) => update("highlightStyle", style)} />
    </div>
  );
}
