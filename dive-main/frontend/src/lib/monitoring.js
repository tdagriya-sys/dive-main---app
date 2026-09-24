/*
 * Browser-side error reporting (Sentry) — the frontend twin of the backend's
 * SENTRY_DSN. Until now a crash in a user's browser only showed them the
 * ErrorBoundary's fallback screen; nobody on the team ever heard about it.
 *
 * Fully OFF unless REACT_APP_SENTRY_DSN is set at BUILD time (CRA bakes
 * REACT_APP_* into the bundle — put it in frontend/.env.production). With no
 * DSN nothing is loaded, nothing is sent, and every function here is a no-op,
 * so dev machines and tests are unaffected.
 *
 * Deliberately conservative about what leaves the browser:
 *  - sendDefaultPii is off (no IP address / user identity attached);
 *  - no user id/email is ever set on events;
 *  - URLs are stripped of their query string and #fragment before sending
 *    (a reset-password or share link can carry a token there), in the event
 *    itself and in navigation/fetch/xhr breadcrumbs; cookies and request
 *    headers are dropped;
 *  - no performance tracing and no session replay (a replay would record
 *    what's on screen — holdings, balances).
 *
 * Sentry itself is loaded with a dynamic import() so it lands in its own
 * chunk and never delays first paint; an error reported while it's still
 * loading simply waits for it.
 */

let sentryPromise = null;

// Strips query string and #fragment: https://divve.in/reset?token=abc#x -> https://divve.in/reset
export function scrubUrl(url) {
  if (typeof url !== "string" || !url) return url;
  // A relative path (or anything that isn't an absolute URL): just cut at the
  // first ? or #.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url.split(/[?#]/)[0];
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

export function scrubEvent(event) {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb) {
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
    }
  }
  return breadcrumb;
}

// Noise that says nothing about a real bug in this app.
const IGNORE_ERRORS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "Non-Error promise rejection captured",
];
// Errors thrown by browser extensions, not by our code.
const DENY_URLS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-extension:\/\//i];

// Call once, first thing at startup. Returns whether reporting is enabled.
export function initMonitoring() {
  const dsn = (process.env.REACT_APP_SENTRY_DSN || "").trim();
  if (!dsn) return false;
  if (sentryPromise) return true;
  sentryPromise = import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        release: process.env.REACT_APP_RELEASE || undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        ignoreErrors: IGNORE_ERRORS,
        denyUrls: DENY_URLS,
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      });
      return Sentry;
    })
    // Monitoring must never be the thing that breaks the app.
    .catch(() => null);
  return true;
}

// Report a caught error (used by the ErrorBoundary). `extra` is optional
// context, e.g. the React component stack. A no-op when monitoring is off.
export function captureError(error, extra) {
  if (!sentryPromise) return;
  sentryPromise
    .then((Sentry) => {
      if (!Sentry) return;
      Sentry.withScope((scope) => {
        if (extra) scope.setContext("react", extra);
        Sentry.captureException(error);
      });
    })
    .catch(() => {});
}
