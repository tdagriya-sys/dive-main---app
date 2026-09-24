// Runs the REAL @sentry/react SDK (no mock) with a fake network transport, to
// prove what would actually be sent: the event carries the error, the request
// URL has no query string/fragment, and no user identity or cookies leak.

const DSN = "https://examplekey@o0.ingest.sentry.io/0";

describe("monitoring with the real Sentry SDK", () => {
  afterEach(() => {
    delete process.env.REACT_APP_SENTRY_DSN;
  });

  it("sends a scrubbed event for a captured error", async () => {
    jest.resetModules();
    process.env.REACT_APP_SENTRY_DSN = DSN;

    const sent = [];
    const Sentry = require("@sentry/react");
    // Swap the real HTTP transport for one that records envelopes.
    const realInit = Sentry.init;
    jest.spyOn(Sentry, "init").mockImplementation((opts) =>
      realInit({
        ...opts,
        transport: () => ({
          send: async (envelope) => {
            sent.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      })
    );

    const { initMonitoring, captureError } = require("./monitoring");
    expect(initMonitoring()).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // let the dynamic import + init finish

    // The page's own address carries a secret in its query string and fragment
    // (like a reset-password link); the browser SDK attaches that address to
    // every event as request.url.
    window.history.pushState({}, "", "/reset-password?token=SECRET#frag");
    captureError(new Error("render blew up"), { componentStack: "at Broken", boundary: "app" });
    await new Promise((r) => setTimeout(r, 50));
    await Sentry.flush(1000);

    expect(sent.length).toBeGreaterThan(0);
    const events = sent.flatMap((env) => env[1]).filter(([header]) => header.type === "event").map(([, payload]) => payload);
    expect(events).toHaveLength(1);
    const event = events[0];

    expect(event.exception.values[0].value).toBe("render blew up");
    expect(event.contexts.react).toEqual({ componentStack: "at Broken", boundary: "app" });
    // Not vacuous: the event really does carry the page URL — minus its secrets.
    expect(event.request.url).toBe("http://localhost/reset-password");
    expect(event.request.headers).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.user?.ip_address).toBeUndefined(); // no default PII
    expect(event.user?.email).toBeUndefined();

    const everything = JSON.stringify(event);
    expect(everything).not.toMatch(/SECRET|token=|#frag/);
  });
});
