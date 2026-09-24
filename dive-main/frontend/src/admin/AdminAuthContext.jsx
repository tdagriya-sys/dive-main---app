import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { api, setAccessToken, setSessionExpiredHandler, API_BASE } from "../lib/api";

const AdminAuthContext = createContext(null);
export const useAdminAuth = () => useContext(AdminAuthContext);

// The staff-2FA endpoints (/auth/staff/totp/*) are called with a short-lived
// PENDING token (see backend/src/controllers/staffAuthController.ts) — not
// the real, already-established session `lib/api.js`'s shared axios instance
// injects automatically. Deliberately a plain, interceptor-free axios call
// (not the shared `api` instance) so that instance's request interceptor —
// which unconditionally overwrites `Authorization` with whatever real access
// token happens to already be in memory — can never clobber the pending
// token, e.g. if a staff member reaches /admin via an in-app navigation from
// an already-logged-in normal-user session in the same tab.
//
// `withCredentials: true` is NOT optional here even though this call never
// SENDS a cookie of its own (only the Bearer pending token) — totp/confirm
// and totp/verify are exactly where the backend completes the login and
// Set-Cookies the real httpOnly refresh token (staffAuthController.ts calls
// issueRefreshToken there). Without withCredentials, the browser silently
// DISCARDS that Set-Cookie response header (cross-origin/cross-port fetch
// rules), so the cookie is never actually stored — the staff member looks
// fully logged in (the in-memory access token from the response body still
// works), right up until that access token's own TTL expires, at which
// point lib/api.js's refresh-and-retry finds no cookie at all and hard-logs
// them out. Live-reproduced: every staff session died exactly at
// STAFF_ACCESS_TTL after login, no exceptions, `POST /auth/refresh` coming
// back `401 NO_REFRESH_TOKEN` — not a rotation/race failure, the cookie
// genuinely never existed.
function pendingTokenPost(path, body, pendingToken) {
  return axios.post(`${API_BASE}${path}`, body, { headers: { Authorization: `Bearer ${pendingToken}` }, withCredentials: true });
}

/**
 * Admin-panel auth (Phase 0.4 of docs/ADMIN_PANEL_PLAN.md). Deliberately a
 * separate context from the main app's DiveContext — a staff session and a
 * normal user session are different identities with different rules
 * (mandatory 2FA, no onboarding/holdings/etc. concepts), and the two contexts
 * are never mounted at the same time (see src/AppRoot.jsx's route split).
 *
 * The underlying refresh-token COOKIE is still shared per browser (this app
 * has always had one session per browser context, staff or not) — logging
 * into one identity replaces the other's cookie, same as any single-session
 * web app. This context only avoids adopting a session that resolves to a
 * non-staff account; it doesn't (and can't) support two identities open at
 * once in one browser.
 */
export function AdminAuthProvider({ children }) {
  const [authLoading, setAuthLoading] = useState(true);
  const [staffUser, setStaffUser] = useState(null);
  // Guards against React StrictMode's deliberate double-invoke of this effect
  // in development (mount -> cleanup -> mount again). Without this, TWO
  // concurrent POST /auth/refresh calls go out sharing the SAME refresh
  // cookie — the backend's single-use rotation treats the second one
  // presenting an already-consumed token as theft and revokes every live
  // token for the account (see authController.ts's refresh()), which
  // reliably killed the just-established session on the very next page
  // load. Confirmed live against the real dev server before this fix.
  const restoreAttemptedRef = useRef(false);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    (async () => {
      try {
        const { data } = await api.post("/auth/refresh");
        // A normal user's refresh cookie resolves fine here too — that's not
        // an admin session, so it's deliberately NOT adopted (no
        // setAccessToken/setStaffUser) rather than granting access on a
        // technicality. The admin login screen renders either way.
        if (data.user?.staffRole) {
          setAccessToken(data.accessToken);
          setStaffUser(data.user);
        }
      } catch {
        // No session at all — nothing to restore.
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  // lib/api.js's response interceptor calls this ONE shared handler when a
  // 401 survives its own refresh-and-retry attempt (session genuinely over —
  // refresh token expired/revoked). DiveContext (the "/" tree) registers its
  // own version of this same hook; since the two trees are never mounted at
  // the same time (src/AppRoot.jsx's route split), whichever is currently
  // active is also the one whose handler is live. Without this, a staff
  // session that expires mid-use while deep in /admin left every subsequent
  // request failing silently with no path back to the login screen.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setStaffUser(null);
    });
  }, []);

  // Step 1 of staff sign-in: password check. On success, the account is
  // ALWAYS staff (a non-staff account's real tokens are deliberately not
  // surfaced here — see the thrown error below) and the caller moves on to
  // the mandatory TOTP step with the returned pendingToken.
  const loginWithPassword = useCallback(async (identifier, password) => {
    const { data } = await api.post("/auth/login", { identifier, password });
    if (data.staffAuthRequired) {
      return { pendingToken: data.pendingToken, totpEnrolled: data.totpEnrolled };
    }
    const err = new Error("This account doesn't have admin access.");
    err.code = "NOT_STAFF";
    throw err;
  }, []);

  // First-time enrolment: fetch (or re-fetch, if setup was started but never
  // confirmed) the QR code + manual-entry secret. Does not establish a
  // session by itself.
  const totpSetup = useCallback(async (pendingToken) => {
    const { data } = await pendingTokenPost("/auth/staff/totp/setup", {}, pendingToken);
    return data; // { otpauthUrl, qrDataUrl, secret }
  }, []);

  // Confirms enrolment. Deliberately does NOT set the session itself — it
  // hands back { accessToken, user, recoveryCodes } and lets the caller
  // (AdminLogin) call completeLogin() only once the staff member has
  // acknowledged their one-time recovery codes, so the shell never renders
  // out from under that acknowledgement step.
  const totpConfirm = useCallback(async (pendingToken, code) => {
    const { data } = await pendingTokenPost("/auth/staff/totp/confirm", { code }, pendingToken);
    return data;
  }, []);

  // Regular sign-in once already enrolled — accepts a TOTP code or a
  // recovery code (see staffAuthController.ts). No acknowledgement gate
  // needed here, but kept symmetric with totpConfirm (returns data, doesn't
  // set state) for one consistent completeLogin() call site.
  const totpVerify = useCallback(async (pendingToken, code) => {
    const { data } = await pendingTokenPost("/auth/staff/totp/verify", { code }, pendingToken);
    return data;
  }, []);

  const completeLogin = useCallback((accessToken, user) => {
    setAccessToken(accessToken);
    setStaffUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Cookie already gone / expired — nothing more a retry would fix.
    }
    setAccessToken(null);
    setStaffUser(null);
  }, []);

  const value = { authLoading, staffUser, loginWithPassword, totpSetup, totpConfirm, totpVerify, completeLogin, logout };
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}
