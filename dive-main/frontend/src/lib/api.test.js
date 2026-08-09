import { api, setAccessToken, getAccessToken, setSessionExpiredHandler } from "./api";

describe("access token storage", () => {
  it("get/set round-trips, staying in memory only (never persisted)", () => {
    setAccessToken("tok-123");
    expect(getAccessToken()).toBe("tok-123");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});

describe("request interceptor", () => {
  const originalAdapter = api.defaults.adapter;
  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    setAccessToken(null);
  });

  // Overriding the adapter (rather than adding a competing request
  // interceptor) captures `config` only after every REAL interceptor,
  // including api.js's own Authorization-setting one, has already run on it
  // — axios runs later-registered request interceptors *first* (it prepends
  // each one), so a second interceptor added here in the test would
  // actually run BEFORE the real one and see the header not yet set.
  async function captureOutgoingConfig(requestFn) {
    let captured;
    api.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve({ data: {}, status: 200, config, headers: {} });
    };
    await requestFn();
    return captured;
  }

  it("attaches an Authorization header when an access token is set", async () => {
    setAccessToken("secret-token");
    const config = await captureOutgoingConfig(() => api.get("/whatever"));
    expect(config.headers.Authorization).toBe("Bearer secret-token");
  });

  it("sends no Authorization header when no access token is set", async () => {
    setAccessToken(null);
    const config = await captureOutgoingConfig(() => api.get("/whatever"));
    expect(config.headers.Authorization).toBeUndefined();
  });
});

describe("response interceptor — 401 handling", () => {
  const originalAdapter = api.defaults.adapter;
  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    setAccessToken(null);
    setSessionExpiredHandler(null);
  });

  it("on a 401, refreshes the token and retries the original request once", async () => {
    let protectedCallCount = 0;
    api.defaults.adapter = (config) => {
      if (config.url === "/protected") {
        protectedCallCount += 1;
        if (!config._retried) {
          return Promise.reject({ response: { status: 401 }, config });
        }
        return Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} });
      }
      if (config.url === "/auth/refresh") {
        return Promise.resolve({ data: { accessToken: "fresh-token" }, status: 200, config, headers: {} });
      }
      throw new Error("unexpected url in test: " + config.url);
    };

    const res = await api.get("/protected");

    expect(res.data).toEqual({ ok: true });
    expect(protectedCallCount).toBe(2); // original 401 + one retry
    expect(getAccessToken()).toBe("fresh-token");
  });

  it("when the refresh itself fails, clears the access token and calls the session-expired handler", async () => {
    const sessionExpiredHandler = jest.fn();
    setSessionExpiredHandler(sessionExpiredHandler);
    setAccessToken("stale-token");

    api.defaults.adapter = (config) => {
      if (config.url === "/protected") {
        return Promise.reject({ response: { status: 401 }, config });
      }
      if (config.url === "/auth/refresh") {
        return Promise.reject({ response: { status: 401 }, config });
      }
      throw new Error("unexpected url in test: " + config.url);
    };

    await expect(api.get("/protected")).rejects.toBeTruthy();

    expect(getAccessToken()).toBeNull();
    expect(sessionExpiredHandler).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh loop for a 401 from an /auth/ route itself", async () => {
    let refreshCallCount = 0;
    api.defaults.adapter = (config) => {
      if (config.url === "/auth/refresh") {
        refreshCallCount += 1;
        return Promise.reject({ response: { status: 401 }, config });
      }
      throw new Error("unexpected url in test: " + config.url);
    };

    await expect(api.post("/auth/refresh")).rejects.toBeTruthy();
    // Only the one direct call — no nested "try to refresh the refresh" loop.
    expect(refreshCallCount).toBe(1);
  });
});
