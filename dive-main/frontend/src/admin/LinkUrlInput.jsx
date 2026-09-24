import React from "react";
import { DEEP_LINK_DESTINATIONS } from "../lib/deepLink";

// A redirect-link field: type any https:// address, or pick one of the app's
// own pages from the dropdown (which fills in an app-relative link like
// `/?go=login` — see lib/deepLink.js for how the app resolves those, and
// backend notificationEmailService.ts::sanitizeLinkUrl for what's allowed).
// The dropdown is an action menu, not a stored value — it always snaps back
// to its placeholder after filling the input.
export default function LinkUrlInput({ testIdPrefix, label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
      {label}
      <div className="flex gap-2">
        <input
          type="text"
          data-testid={`${testIdPrefix}-input`}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/page"
          className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <select
          data-testid={`${testIdPrefix}-picker`}
          aria-label="Pick an app page"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          className="shrink-0 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs outline-none"
        >
          <option value="">App page…</option>
          {DEEP_LINK_DESTINATIONS.map((d) => (
            <option key={d.key} value={d.path}>{d.label}</option>
          ))}
        </select>
      </div>
    </label>
  );
}
