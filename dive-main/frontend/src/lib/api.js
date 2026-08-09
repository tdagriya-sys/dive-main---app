import axios from "axios";

// REACT_APP_BACKEND_URL is baked in at build time (craco.config.js refuses
// to produce a production build without it — see the check there), so this
// should never actually be unset in a real build. This is a defense-in-depth
// check only, in case a build somehow bypasses that (e.g. `react-scripts
// build` run directly instead of `npm run build`/`craco build`) — a loud,
// specific console error beats every API call silently going to the literal
// URL "undefined/api" with no indication why the app is completely broken.
if (!process.env.REACT_APP_BACKEND_URL) {
  // eslint-disable-next-line no-console
  console.error(
    "[divve] REACT_APP_BACKEND_URL was not set when this build was created — every API call will fail. " +
      "Rebuild with it set (see frontend/.env.example and docs/SERVER_DEPLOYMENT_GUIDE.md Part 8)."
  );
}

export const API_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Access token is kept in memory only (never localStorage) — the refresh token
// that can mint a new one lives in an httpOnly cookie set by the backend.
let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

export const api = axios.create({ baseURL: API_BASE, withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise = null;

// Lets DiveContext register a callback for "the refresh token is dead, this
// session is really over" — without this, a session that expires mid-use
// (not just on the very first page load) just leaves every subsequent
// request silently rejecting forever, with whatever screen the user was on
// stuck showing stale/broken data and no path back to logging in.
let onSessionExpired = null;
export const setSessionExpiredHandler = (fn) => {
  onSessionExpired = fn;
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;
    const isAuthRoute = config?.url?.startsWith("/auth/");
    if (response?.status === 401 && !config._retried && !isAuthRoute) {
      config._retried = true;
      try {
        if (!refreshPromise) {
          refreshPromise = api.post("/auth/refresh").finally(() => {
            refreshPromise = null;
          });
        }
        const { data } = await refreshPromise;
        setAccessToken(data.accessToken);
        config.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(config);
      } catch (refreshError) {
        setAccessToken(null);
        if (onSessionExpired) onSessionExpired();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);
