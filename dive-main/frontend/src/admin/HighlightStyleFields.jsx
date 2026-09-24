import React from "react";

// Shared by any admin screen that lets staff configure an IHighlightStyle
// (backend/src/models/NotificationCategory.ts) for `==highlighted==` spans
// in a notification body — currently the renewal-reminder message
// templates (screens/Subscriptions.jsx) and the general notification
// template editor (screens/Notifications.jsx). Plain text inputs for
// color/size rather than a color-picker widget, matching how staff already
// type raw values elsewhere in this admin panel (e.g. the announcement
// banner has no color picker either) — every value here is validated
// server-side by validators/adminSetting.ts::highlightStyleSchema.
// A style whose every field has been emptied out is just "no style" (the
// renderer falls back to the default accent) — treated as absent when a
// payload is built, so a saved style can actually be cleared.
export function cleanHighlightStyle(style) {
  if (!style) return undefined;
  return Object.values(style).some(Boolean) ? style : undefined;
}

export default function HighlightStyleFields({ testIdPrefix, value, onChange }) {
  const style = value || {};
  function update(field, fieldValue) {
    onChange({ ...style, [field]: fieldValue || undefined });
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Color
        <input
          type="text"
          data-testid={`${testIdPrefix}-color-input`}
          value={style.color || ""}
          onChange={(e) => update("color", e.target.value)}
          placeholder="#D4AF37"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Font size
        <input
          type="text"
          data-testid={`${testIdPrefix}-fontsize-input`}
          value={style.fontSize || ""}
          onChange={(e) => update("fontSize", e.target.value)}
          placeholder="1.1em"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Gradient from <span className="normal-case text-[var(--text-tertiary)]">(optional, overrides color)</span>
        <input
          type="text"
          data-testid={`${testIdPrefix}-gradientfrom-input`}
          value={style.gradientFrom || ""}
          onChange={(e) => update("gradientFrom", e.target.value)}
          placeholder="#D4AF37"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Gradient to
        <input
          type="text"
          data-testid={`${testIdPrefix}-gradientto-input`}
          value={style.gradientTo || ""}
          onChange={(e) => update("gradientTo", e.target.value)}
          placeholder="#FF6B6B"
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Weight
        <select
          data-testid={`${testIdPrefix}-fontweight-select`}
          value={style.fontWeight || ""}
          onChange={(e) => update("fontWeight", e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        >
          <option value="">Default</option>
          <option value="normal">Normal</option>
          <option value="bold">Bold</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-[var(--text-tertiary)]">
        Style
        <select
          data-testid={`${testIdPrefix}-fontstyle-select`}
          value={style.fontStyle || ""}
          onChange={(e) => update("fontStyle", e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
        >
          <option value="">Default</option>
          <option value="normal">Normal</option>
          <option value="italic">Italic</option>
        </select>
      </label>
    </div>
  );
}
