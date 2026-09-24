import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import axios from "axios";
import { api, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import { AdminAuthProvider, useAdminAuth } from "./AdminAuthContext";

jest.mock("../lib/api", () => ({
  api: { post: jest.fn() },
  setAccessToken: jest.fn(),
  setSessionExpiredHandler: jest.fn(),
  API_BASE: "http://localhost:8000/api",
}));

jest.mock("axios");

function Harness() {
  const { authLoading, staffUser, loginWithPassword, totpSetup, totpConfirm, totpVerify, completeLogin, logout } = useAdminAuth();
  const [result, setResult] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  const run = (fn) => async () => {
    setErrorMsg("");
    try {
      setResult(await fn());
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div>
      <div data-testid="auth-loading">{String(authLoading)}</div>
      <div data-testid="staff-email">{staffUser?.email || "none"}</div>
      <div data-testid="result">{result ? JSON.stringify(result) : "none"}</div>
      <div data-testid="error">{errorMsg}</div>
      <button onClick={run(() => loginWithPassword("staff@divve.in", "pw"))}>login</button>
      <button onClick={run(() => totpSetup("pending-tok"))}>setup</button>
      <button onClick={run(() => totpConfirm("pending-tok", "123456"))}>confirm</button>
      <button onClick={run(() => totpVerify("pending-tok", "123456"))}>verify</button>
      <button onClick={() => completeLogin("real-token", { email: "staff@divve.in", staffRole: "admin" })}>complete</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

async function renderReady(refreshResolution) {
  if (refreshResolution?.reject) {
    api.post.mockRejectedValueOnce(new Error("no session"));
  } else {
    api.post.mockResolvedValueOnce({ data: refreshResolution });
  }
  render(
    <AdminAuthProvider>
      <Harness />
    </AdminAuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
}

describe("AdminAuthContext — StrictMode double-invoke guard", () => {
  afterEach(() => jest.clearAllMocks());

  // Regression test for a real bug found live: React StrictMode
  // (index.js wraps the whole app in it) deliberately double-invokes effects
  // in development — mount, cleanup, mount again. Without a guard, that fires
  // TWO concurrent POST /auth/refresh calls sharing the same refresh cookie;
  // the backend's single-use rotation treats the second one presenting an
  // already-consumed token as theft and revokes the WHOLE session
  // (authController.ts's refresh()) — reliably killing a just-established
  // staff session on the very next page load. Reproduced against the real
  // dev server before this guard existed.
  it("calls /auth/refresh only ONCE even when the effect is invoked twice (StrictMode)", async () => {
    api.post.mockResolvedValue({ data: { accessToken: "tok", user: { email: "boss@divve.in", staffRole: "superadmin" } } });
    render(
      <React.StrictMode>
        <AdminAuthProvider>
          <Harness />
        </AdminAuthProvider>
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("staff-email")).toHaveTextContent("boss@divve.in");
  });
});

describe("AdminAuthContext — session restore", () => {
  afterEach(() => jest.clearAllMocks());

  it("adopts a session whose refreshed user IS staff", async () => {
    await renderReady({ accessToken: "tok-1", user: { email: "boss@divve.in", staffRole: "superadmin" } });
    expect(screen.getByTestId("staff-email")).toHaveTextContent("boss@divve.in");
    expect(setAccessToken).toHaveBeenCalledWith("tok-1");
  });

  it("does NOT adopt a session whose refreshed user is a normal (non-staff) account", async () => {
    await renderReady({ accessToken: "tok-2", user: { email: "user@divve.in", staffRole: null } });
    expect(screen.getByTestId("staff-email")).toHaveTextContent("none");
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it("shows the login screen (no staff user) when there's no session at all", async () => {
    await renderReady({ reject: true });
    expect(screen.getByTestId("staff-email")).toHaveTextContent("none");
  });
});

describe("AdminAuthContext — login flow", () => {
  afterEach(() => jest.clearAllMocks());

  it("loginWithPassword returns the pending challenge for a staff account", async () => {
    await renderReady({ reject: true });
    api.post.mockResolvedValueOnce({ data: { staffAuthRequired: true, pendingToken: "ptok", totpEnrolled: false } });
    await act(async () => screen.getByText("login").click());
    expect(screen.getByTestId("result")).toHaveTextContent(JSON.stringify({ pendingToken: "ptok", totpEnrolled: false }));
  });

  it("loginWithPassword throws NOT_STAFF for a normal account's otherwise-successful login", async () => {
    await renderReady({ reject: true });
    api.post.mockResolvedValueOnce({ data: { accessToken: "real", user: { staffRole: null } } });
    await act(async () => screen.getByText("login").click());
    expect(screen.getByTestId("error")).toHaveTextContent("This account doesn't have admin access.");
  });

  it("totpSetup calls the pending-token endpoint via a plain axios call (bypassing the shared interceptor)", async () => {
    await renderReady({ reject: true });
    axios.post.mockResolvedValueOnce({ data: { otpauthUrl: "otpauth://x", qrDataUrl: "data:image/png;base64,x", secret: "SECRET" } });
    await act(async () => screen.getByText("setup").click());
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/staff/totp/setup",
      {},
      { headers: { Authorization: "Bearer pending-tok" }, withCredentials: true }
    );
    expect(screen.getByTestId("result")).toHaveTextContent("SECRET");
  });

  // Regression: this call is exactly where the backend Set-Cookies the real
  // refresh token to complete the login (staffAuthController.ts's
  // totpConfirm calls issueRefreshToken) — without withCredentials, the
  // browser silently discards that Set-Cookie (cross-port fetch rules), so
  // the cookie never actually gets stored. The staff member looked fully
  // logged in (the access token in the response body still works) right up
  // until it expired, at which point there was no refresh cookie at all and
  // they were hard-logged-out — live-reproduced as "every staff session dies
  // exactly at STAFF_ACCESS_TTL after login, every time."
  it("totpConfirm sends withCredentials:true so the backend's Set-Cookie refresh token is actually stored", async () => {
    await renderReady({ reject: true });
    axios.post.mockResolvedValueOnce({
      data: { accessToken: "real-tok", user: { email: "boss@divve.in", staffRole: "superadmin" }, recoveryCodes: ["AAAA-BBBB"] },
    });
    await act(async () => screen.getByText("confirm").click());
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/staff/totp/confirm",
      { code: "123456" },
      { headers: { Authorization: "Bearer pending-tok" }, withCredentials: true }
    );
  });

  it("totpConfirm returns the session data WITHOUT establishing the session itself", async () => {
    await renderReady({ reject: true });
    axios.post.mockResolvedValueOnce({
      data: { accessToken: "real-tok", user: { email: "boss@divve.in", staffRole: "superadmin" }, recoveryCodes: ["AAAA-BBBB"] },
    });
    await act(async () => screen.getByText("confirm").click());
    expect(setAccessToken).not.toHaveBeenCalled();
    expect(screen.getByTestId("staff-email")).toHaveTextContent("none");
    expect(screen.getByTestId("result")).toHaveTextContent("AAAA-BBBB");
  });

  it("totpVerify also returns data without establishing the session", async () => {
    await renderReady({ reject: true });
    axios.post.mockResolvedValueOnce({ data: { accessToken: "real-tok", user: { staffRole: "admin" } } });
    await act(async () => screen.getByText("verify").click());
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it("completeLogin is the only thing that actually sets the session", async () => {
    await renderReady({ reject: true });
    await act(async () => screen.getByText("complete").click());
    expect(setAccessToken).toHaveBeenCalledWith("real-token");
    expect(screen.getByTestId("staff-email")).toHaveTextContent("staff@divve.in");
  });

  it("logout clears the session and calls the real logout endpoint", async () => {
    await renderReady({ reject: true });
    await act(async () => screen.getByText("complete").click());
    expect(screen.getByTestId("staff-email")).toHaveTextContent("staff@divve.in");

    api.post.mockResolvedValueOnce({ data: { message: "Logged out." } });
    await act(async () => screen.getByText("logout").click());
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
    expect(setAccessToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("staff-email")).toHaveTextContent("none");
  });

  it("registers a session-expired handler that clears the session when the shared axios interceptor invokes it", async () => {
    await renderReady({ reject: true });
    await act(async () => screen.getByText("complete").click());
    expect(screen.getByTestId("staff-email")).toHaveTextContent("staff@divve.in");

    expect(setSessionExpiredHandler).toHaveBeenCalledWith(expect.any(Function));
    const handler = setSessionExpiredHandler.mock.calls[setSessionExpiredHandler.mock.calls.length - 1][0];
    await act(async () => handler());
    expect(screen.getByTestId("staff-email")).toHaveTextContent("none");
  });
});
