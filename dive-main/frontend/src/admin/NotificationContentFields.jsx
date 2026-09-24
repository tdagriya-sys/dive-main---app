import React from "react";
import CalloutFields from "./CalloutFields";
import HighlightStyleFields from "./HighlightStyleFields";
import ButtonFields from "./ButtonFields";

// The full notification-content editor, shared by the new-campaign form, the
// draft-campaign "Edit content" card, and the landing pop-up form: an
// optional callout (above the subject), the subject/title, the body, the
// body's highlight style, and an optional button. `value` is
// `{ subject, bodyMarkdown, highlightStyle, callout, button }`; `onChange`
// gets the whole updated object. `testIdPrefix` produces
// `${p}-callout-*`, `${p}-subject-input`, `${p}-body-input`,
// `${p}-highlight-*`, and `${p}-button-*`.
export default function NotificationContentFields({ testIdPrefix, value, onChange, subjectLabel = "Subject", subjectHint = "Subject (supports {{name}}, {{first_name}}, {{email}})", showVariablesHint = true }) {
  const v = value || {};
  const set = (field) => (fieldValue) => onChange({ ...v, [field]: fieldValue });
  return (
    <>
      <CalloutFields testIdPrefix={`${testIdPrefix}-callout`} value={v.callout} onChange={set("callout")} />
      <input
        data-testid={`${testIdPrefix}-subject-input`}
        aria-label={subjectLabel}
        value={v.subject || ""}
        onChange={(e) => set("subject")(e.target.value)}
        placeholder={subjectHint}
        className="w-full mb-2 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
      />
      <textarea
        data-testid={`${testIdPrefix}-body-input`}
        aria-label="Body"
        value={v.bodyMarkdown || ""}
        onChange={(e) => set("bodyMarkdown")(e.target.value)}
        placeholder="Body markdown… (**bold**, ==highlighted==, ![alt](image-url), [words](link))"
        rows={4}
        className="w-full mb-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none resize-none"
      />
      <p className="text-[10px] text-[var(--text-tertiary)] mb-2" data-testid={`${testIdPrefix}-link-help`}>
        Links: <code>[words](link)</code> · a clickable image: <code>[![alt](image-url)](link)</code>. A link is a full https:// address or an app page like <code>/?go=login</code>.
        {showVariablesHint ? " Personalize with {{name}}, {{first_name}} and {{email}} in the subject, body and callout text." : " {{name}}/{{email}} aren't available here."}
      </p>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Highlight style — applies to every ==highlighted== span above. ==Highlights==, images, links, and the callout only show on email/pop-up; the bell (in-app) shows plain text with bold only.</p>
      <div className="mb-3">
        <HighlightStyleFields testIdPrefix={`${testIdPrefix}-highlight`} value={v.highlightStyle} onChange={set("highlightStyle")} />
      </div>
      <ButtonFields testIdPrefix={`${testIdPrefix}-button`} value={v.button} onChange={set("button")} />
    </>
  );
}
