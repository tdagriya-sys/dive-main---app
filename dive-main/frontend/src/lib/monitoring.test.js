// Browser error reporting must be inert without a DSN, and — when on — must
// never send a URL's query string/fragment, cookies, headers or user identity.

const DSN = "https://examplekey@o0.ingest.sentry.io/0";
let sentry;

function loadMonitoring() {
  jest.resetModules();
  sentry = {
    init: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((cb) => cb({ setContext: sentry.setContext })),
    setContext: jest.fn(),
  };
  jest.doMock("@sentry/react", () => sentry);
  return require("./monitoring");
}

// The dynamic import() resolves on a later microtask.
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete process.env.REACT_APP_SENTRY_DSN;
  delete process.env.REACT_APP_RELEASE;
});

describe("monitoring — off by default", () => {
  it("without a DSN, initMonitoring does nothing and reports false", async () => {
    const m = loadMonitoring();
    expect(m.initMonitoring()).toBe(false);
    await flush();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("without a DSN, captureError is a silent no-op", async () => {
    const m = loadMonitoring();
    m.initMonitoring();
    expect(() => m.captureError(new Error("boom"), { a: 1 })).not.toThrow();
    await flush();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("a blank/whitespace DSN counts as unset", async () => {
    process.env.REACT_APP_SENTRY_DSN = "   ";
    const m = loadMonitoring();
    expect(m.initMonitoring()).toBe(false);
  });
});

describe("monitoring — with a DSN", () => {
  it("initialises Sentry once, privacy-first: no default PII, no tracing", async () => {
    process.env.REACT_APP_SENTRY_DSN = DSN;
    process.env.REACT_APP_RELEASE = "2026.09.24";
    const m = loadMonitoring();
    expect(m.initMonitoring()).toBe(true);
    expect(m.initMonitoring()).toBe(true); // second call doesn't re-init
    await flush();

    expect(sentry.init).toHaveBeenCalledTimes(1);
    const opts = sentry.init.mock.calls[0][0];
    expect(opts).toMatchObject({ dsn: DSN, sendDefaultPii: false, tracesSampleRate: 0, release: "2026.09.24" });
    expect(opts.beforeSend).toBe(m.scrubEvent);
    expect(opts.beforeBreadcrumb).toBe(m.scrubBreadcrumb);
    expect(opts.ignoreErrors).toContain("ResizeObserver loop limit exceeded");
    expect(opts.denyUrls.some((re) => re.test("chrome-extension://abc/x.js"))).toBe(true);
    expect(opts.denyUrls.some((re) => re.test("https://divve.in/static/js/main.js"))).toBe(false);
    // No session replay / tracing integrations are added.
    expect(opts.integrations).toBeUndefined();
  });

  it("captureError forwards the error with its React context, even if called while Sentry is still loading", async () => {
    process.env.REACT_APP_SENTRY_DSN = DSN;
    const m = loadMonitoring();
    m.initMonitoring();
    const err = new Error("render blew up");
    m.captureError(err, { componentStack: "at Foo", boundary: "phone" }); // before the import resolved
    await flush();

    expect(sentry.setContext).toHaveBeenCalledWith("react", { componentStack: "at Foo", boundary: "phone" });
    expect(sentry.captureException).toHaveBeenCalledWith(err);
  });

  it("reporting never throws back into the app, even if Sentry fails to load or to capture", async () => {
    process.env.REACT_APP_SENTRY_DSN = DSN;
    let m = loadMonitoring();
    sentry.init.mockImplementation(() => {
      throw new Error("init failed");
    });
    m.initMonitoring();
    expect(() => m.captureError(new Error("x"))).not.toThrow();
    await flush();
    expect(sentry.captureException).not.toHaveBeenCalled();

    m = loadMonitoring();
    sentry.captureException.mockImplementation(() => {
      throw new Error("capture failed");
    });
    m.initMonitoring();
    expect(() => m.captureError(new Error("y"))).not.toThrow();
    await flush();
  });
});

describe("monitoring — what's scrubbed before anything leaves the browser", () => {
  const { scrubUrl, scrubEvent, scrubBreadcrumb } = require("./monitoring");

  it("scrubUrl drops the query string and fragment (tokens can live there), keeps origin + path", () => {
    expect(scrubUrl("https://divve.in/reset-password?token=SECRET#x")).toBe("https://divve.in/reset-password");
    expect(scrubUrl("https://divve.in/?go=login")).toBe("https://divve.in/");
    expect(scrubUrl("/admin/users?email=a@b.com")).toBe("/admin/users");
    expect(scrubUrl("https://divve.in/plain")).toBe("https://divve.in/plain");
  });

  it("scrubUrl leaves non-strings alone and copes with junk", () => {
    expect(scrubUrl(undefined)).toBeUndefined();
    expect(scrubUrl("")).toBe("");
    expect(scrubUrl("not a url?x=1")).toBe("not a url");
  });

  it("scrubEvent strips the request URL's query and removes cookies, headers and query_string", () => {
    const event = scrubEvent({
      message: "m",
      request: { url: "https://divve.in/p?token=SECRET", cookies: { session: "s" }, headers: { Authorization: "Bearer x" }, query_string: "token=SECRET" },
    });
    expect(event.request).toEqual({ url: "https://divve.in/p" });
    expect(JSON.stringify(event)).not.toMatch(/SECRET|Bearer|session/);
  });

  it("scrubEvent copes with an event that has no request", () => {
    expect(scrubEvent({ message: "m" })).toEqual({ message: "m" });
  });

  it("scrubBreadcrumb cleans navigation and fetch/xhr URLs", () => {
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/b?token=SECRET" } }).data).toEqual({ from: "/a", to: "/b" });
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "https://divve.in/api/x?token=SECRET", method: "GET" } }).data).toEqual({ url: "https://divve.in/api/x", method: "GET" });
    expect(scrubBreadcrumb({ category: "console", message: "hi" })).toEqual({ category: "console", message: "hi" });
  });
});
