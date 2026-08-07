import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/*
 * A render-time error anywhere below this boundary (a malformed API payload,
 * a chart-library edge case, a bad property access) previously unmounted the
 * WHOLE app with no recovery — see docs/PRODUCTION_READINESS_AUDIT.md P0 #3.
 * Error boundaries can only be class components (no hooks equivalent for
 * getDerivedStateFromError/componentDidCatch) — this is the one place in the
 * app that has to be one for that reason.
 *
 * Two boundaries are mounted (see index.js + App.js): an outer one around the
 * whole app as a last-resort catch-all, and an inner one around just
 * <DiveShell/> inside the phone frame, so a bug in one screen shows a
 * contained "something broke" state inside the phone rather than blanking
 * the entire landing page (header, marketing copy) around it too.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // No error-tracking service (Sentry/APM) is wired up in this app yet
    // (docs/PRODUCTION_READINESS_AUDIT.md P3 #24) — this console.error is the
    // one place that call would go once one exists.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught a render error:", error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return this.props.variant === "phone" ? (
      <PhoneFallback onRetry={this.handleRetry} />
    ) : (
      <FullPageFallback onRetry={this.handleRetry} />
    );
  }
}

function FullPageFallback({ onRetry }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--wrapper-bg)] px-6" data-testid="error-boundary-fullpage">
      <div className="max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--red)]/10 border border-[var(--red)]/20 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle size={26} className="text-[var(--red)]" />
        </div>
        <h1 className="font-heading font-black text-2xl text-[var(--text-primary)] mb-2">Something went wrong</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-7 leading-relaxed">
          Divve hit an unexpected error. Your data is safe — this was just a display problem. Try again, or reload the page if that doesn't help.
        </p>
        <div className="flex flex-col gap-3">
          <button data-testid="error-boundary-retry-btn" onClick={onRetry}
            className="gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]">
            <RefreshCw size={16} /> Try again
          </button>
          <button data-testid="error-boundary-reload-btn" onClick={() => window.location.reload()}
            className="text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors py-2">
            Reload the page
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneFallback({ onRetry }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--app-bg)] px-6" data-testid="error-boundary-phone">
      <div className="text-center">
        <div className="w-11 h-11 rounded-xl bg-[var(--red)]/10 border border-[var(--red)]/20 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={20} className="text-[var(--red)]" />
        </div>
        <h2 className="font-heading font-black text-lg text-[var(--text-primary)] mb-1.5">This screen hit a snag</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-5 leading-relaxed">
          Your data is safe — just a display problem here.
        </p>
        <button data-testid="error-boundary-phone-retry-btn" onClick={onRetry}
          className="gold-btn rounded-full px-6 py-3 font-bold text-sm flex items-center justify-center gap-2 mx-auto transition-transform hover:scale-[1.02]">
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    </div>
  );
}
