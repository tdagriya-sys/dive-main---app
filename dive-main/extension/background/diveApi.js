// Thin fetch-based client for the existing Dive backend REST API. Runs only
// in the background service worker (never the content script) — that's what
// lets it call across origins without any backend CORS change: an MV3
// service worker's fetches are governed by the extension's declared
// host_permissions, not the page's CORS policy, as long as no page/content
// script is doing the fetching itself.
//
// login/refresh/logout send `clientType: "extension"`, an additive flag
// backend/src/controllers/authController.ts checks to hand the refresh token
// back in the JSON body (alongside its usual httpOnly cookie, which this
// background service worker can't use — see tryRefresh below). Every
// endpoint here is otherwise unmodified:
//   POST /api/auth/login    -> { accessToken, user, refreshToken }
//   POST /api/auth/refresh  -> { accessToken, user, refreshToken }
//   POST /api/auth/logout   -> { message }
//   GET  /api/auth/me                -> { user }
//   GET  /api/holdings               -> { holdings }
//   GET  /api/score/breakdown        -> DiveScoreBreakdown
//   GET  /api/instruments/search?q=  -> { instruments }

import { DEFAULT_API_BASE, STORAGE_KEYS } from "../shared/config.js";

const EXTENSION_CLIENT_TYPE = "extension";

export async function getApiBase() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiBase);
  return stored[STORAGE_KEYS.apiBase] || DEFAULT_API_BASE;
}

export async function getAccessToken() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.accessToken);
  return stored[STORAGE_KEYS.accessToken] || null;
}

async function getRefreshToken() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.refreshToken);
  return stored[STORAGE_KEYS.refreshToken] || null;
}

async function storeSession({ accessToken, refreshToken }) {
  const toSet = {};
  if (accessToken) toSet[STORAGE_KEYS.accessToken] = accessToken;
  if (refreshToken) toSet[STORAGE_KEYS.refreshToken] = refreshToken;
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

export async function clearSession() {
  await chrome.storage.local.remove([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken, STORAGE_KEYS.userEmail]);
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function rawFetch(apiBase, path, { method, headers, body }) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body,
    // Needed for /auth/refresh's httpOnly cookie — harmless on every other
    // (Bearer-token-authed) call, which doesn't rely on cookies at all.
    credentials: "include",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { res, data };
}

// Refreshes using the extension's OWN stored refresh token (see
// authController.ts's wantsRefreshTokenInBody) rather than the httpOnly
// cookie the web app relies on — that cookie is SameSite=Lax and browsers
// don't attach it to a background service worker's cross-site fetch the way
// they would a top-level page navigation, so relying on it here would fail
// silently almost every time. This is a real, working refresh: single-use
// rotation on the backend means each call both consumes and replaces the
// stored refresh token, so it must always be re-persisted here even on
// success, not just the access token.
//
// De-duplicated across concurrent callers via refreshInFlight — critical,
// not just an optimization: background.js's loadPortfolioSnapshot() fires
// getHoldings/getScoreBreakdown/getMe in parallel (Promise.all), so an
// expired access token means all three hit a 401 within the same tick. Since
// the refresh token is SINGLE-USE, without this guard each of the three
// would independently read the same stored token and race to redeem it —
// the first succeeds, but the second and third then present a token the
// backend has already rotated away, which its reuse-detection (
// authController.ts's REFRESH_TOKEN_REUSED handling) treats as a possible
// theft signal and responds to by revoking EVERY live refresh token for the
// account, including the one the first call just legitimately obtained.
// That kills the whole session — which is exactly what an expired access
// token would otherwise trigger every ~15 minutes without this fix. Same
// "share one in-flight promise" pattern frontend/src/lib/api.js already
// uses for the web app's own refresh calls.
let refreshInFlight = null;
async function tryRefresh(apiBase) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    const { res, data } = await rawFetch(apiBase, "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientType: EXTENSION_CLIENT_TYPE, refreshToken }),
    });
    if (!res.ok || !data?.refreshToken) {
      // A dead/reused/revoked refresh token can't be salvaged — clear it so
      // the next attempt doesn't keep retrying with a token the backend has
      // already permanently rejected.
      if (res.status === 401) await clearSession();
      return null;
    }
    await storeSession(data);
    return data.accessToken;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const apiBase = await getApiBase();
  const headers = { "Content-Type": "application/json" };
  const bodyStr = body ? JSON.stringify(body) : undefined;
  if (auth) {
    const token = await getAccessToken();
    if (!token) throw new ApiError(401, { error: "NOT_LOGGED_IN", message: "Log in to Divve Bot from the extension popup first." });
    headers.Authorization = `Bearer ${token}`;
  }

  let { res, data } = await rawFetch(apiBase, path, { method, headers, body: bodyStr });

  if (auth && res.status === 401) {
    const newToken = await tryRefresh(apiBase).catch(() => null);
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      ({ res, data } = await rawFetch(apiBase, path, { method, headers, body: bodyStr }));
    }
    if (res.status === 401) {
      // The access token is dead and refresh didn't save it (expected — see
      // tryRefresh above) — clear it now so the popup/overlay both read back
      // "logged out" immediately instead of retrying a call that can never
      // succeed until the user logs in again.
      await clearSession();
      throw new ApiError(401, { error: "SESSION_EXPIRED", message: "Your Divve session expired — log in again from the extension popup." });
    }
  }

  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function login(identifier, password) {
  const data = await request("/auth/login", {
    method: "POST",
    body: { identifier, password, clientType: EXTENSION_CLIENT_TYPE },
    auth: false,
  });
  await storeSession(data);
  return data.user;
}

// Best-effort server-side revocation — logging out from the extension
// shouldn't leave a still-valid 30-day refresh token sitting in the backend
// (RefreshToken.ts) if this device is later compromised. Failure here (e.g.
// already offline) doesn't block clearing the LOCAL session either way.
export async function logout() {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    const apiBase = await getApiBase();
    await rawFetch(apiBase, "/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientType: EXTENSION_CLIENT_TYPE, refreshToken }),
    }).catch(() => {});
  }
  await clearSession();
}

export async function getMe() {
  return (await request("/auth/me")).user;
}

export async function getHoldings() {
  return (await request("/holdings")).holdings;
}

export async function getScoreBreakdown() {
  return request("/score/breakdown");
}

export async function searchInstruments(q) {
  return (await request(`/instruments/search?q=${encodeURIComponent(q)}`)).instruments;
}

export { ApiError };
