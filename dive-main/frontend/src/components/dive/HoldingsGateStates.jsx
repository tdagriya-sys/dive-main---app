import React, { useState } from "react";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

// Shared across every nav'd screen that can't render without holdings
// (Home, Suggestions, X-Ray) — three distinct states, not one blank screen:
// actively loading, failed to load (retryable), or genuinely empty (nothing
// saved yet — e.g. a freshly signed-up account before its first holding).
// A bare `return null` looks identical to a broken app in every one of these
// cases — there's no way to tell "still working" from "dead end" from "this
// screen crashed" without some visible content.

export function HoldingsLoadingState({ testId }) {
  return (
    <div className="flex flex-col h-full px-7 items-center justify-center text-center dive-app-surface" data-testid={testId}>
      <Loader2 size={28} className="text-[var(--dive-blue)] animate-spin mb-4" />
      <p className="text-[var(--text-secondary)] font-semibold">Loading your portfolio…</p>
    </div>
  );
}

export function HoldingsLoadErrorState({ onRetry, testId, retryTestId }) {
  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="flex flex-col h-full px-7 items-center justify-center text-center dive-app-surface" data-testid={testId}>
      <AlertTriangle size={32} className="text-[var(--red)] mb-4" />
      <h1 className="font-heading font-black text-2xl mb-3">Couldn't load your portfolio</h1>
      <p className="text-[var(--text-secondary)] mb-8">This looks like a connection issue, not an empty portfolio — your holdings are still there. Try again.</p>
      <button data-testid={retryTestId} onClick={handleRetry} disabled={retrying}
        className="w-full gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
        {retrying ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}

// `secondaryLabel`/`onSecondary`/`secondaryTestId` are optional — only
// Suggestions.jsx passes them (for its "Ask DIVVE about a stock or fund"
// escape hatch, so a zero-holdings user can still look something up without
// adding a holding first); Home.jsx/XRay.jsx call this without them and get
// the plain single-CTA layout unchanged.
export function HoldingsEmptyState({ setScreen, title, body, ctaLabel, testId, ctaTestId, secondaryLabel, secondaryTestId, onSecondary }) {
  return (
    <div className="flex flex-col h-full px-7 items-center justify-center text-center dive-app-surface" data-testid={testId}>
      <h1 className="font-heading font-black text-2xl mb-3">{title}</h1>
      <p className="text-[var(--text-secondary)] mb-8">{body}</p>
      <button data-testid={ctaTestId} onClick={() => setScreen("chooseMethod")}
        className="w-full md:max-w-xs gold-btn rounded-full py-4 font-bold hover:bg-[var(--dive-blue-hover)] transition-colors">
        {ctaLabel}
      </button>
      {secondaryLabel && (
        <button data-testid={secondaryTestId} onClick={onSecondary}
          className="w-full md:max-w-xs mt-3 rounded-full py-4 font-bold border border-[var(--border)] hover:bg-[var(--surface-card)] transition-colors">
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
