import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiveProvider, useDive } from "./DiveContext";
import { api } from "../lib/api";
import { applyRemoteSuggestionConfig } from "../lib/diveEngine";

jest.mock("../lib/api", () => ({
  // post defaults to resolving — DiveContext fires a best-effort, unawaited
  // POST /usage/close-edit-sessions on every arrival at "home" (see its own
  // effect), which most tests below never explicitly mock; without a benign
  // default here that call returns `undefined` instead of a promise, and
  // its own `.catch()` throws a TypeError that crashes the render. Tests
  // that care about a SPECIFIC api.post call still override this via
  // `mockResolvedValueOnce`/`mockRejectedValueOnce`/`mockImplementation` as
  // today — `clearAllMocks()` (used throughout this file) resets call
  // history, not this base implementation.
  api: { get: jest.fn(), post: jest.fn().mockResolvedValue({ data: {} }), patch: jest.fn(), delete: jest.fn() },
  setAccessToken: jest.fn(),
  getAccessToken: jest.fn(),
  setSessionExpiredHandler: jest.fn(),
  setPlanLimitHandler: jest.fn(),
}));

// Everything else in diveEngine.js stays real (adaptHolding et al., used
// elsewhere in this file's rendering) — only applyRemoteSuggestionConfig is
// swapped for a spy, so these tests can assert DiveContext calls it with
// exactly what the backend returned without depending on that function's
// own (separately tested) mutation logic.
jest.mock("../lib/diveEngine", () => ({
  ...jest.requireActual("../lib/diveEngine"),
  applyRemoteSuggestionConfig: jest.fn(),
}));

// Exposes just enough of the context for these tests to drive and observe,
// mirroring how a real screen would consume useDive().
function TestHarness() {
  // Aliased to currentScreen — this file already imports testing-library's
  // own `screen` query object, and useDive()'s `screen` (the app's current
  // screen name) would otherwise shadow it.
  const { authLoading, holdings, holdingsError, loadHoldings, prefs, savePrefs, screen: currentScreen, setScreen, goBack, user, isImpersonating, exitImpersonation } = useDive();
  return (
    <div>
      <div data-testid="auth-loading">{String(authLoading)}</div>
      <div data-testid="holdings-count">{holdings.length}</div>
      <div data-testid="holdings-error">{String(holdingsError)}</div>
      <div data-testid="prefs-risk">{prefs.risk}</div>
      <div data-testid="current-screen">{currentScreen}</div>
      <div data-testid="user-name">{user?.name || ""}</div>
      <div data-testid="is-impersonating">{String(isImpersonating)}</div>
      <button onClick={() => loadHoldings()}>reload holdings</button>
      <button onClick={() => savePrefs({ ...prefs, risk: "Aggressive" })}>save prefs</button>
      <button onClick={() => setScreen("home")}>go home</button>
      <button onClick={() => setScreen("chooseMethod")}>go chooseMethod</button>
      <button onClick={() => setScreen("manualEntry")}>go manualEntry</button>
      <button onClick={goBack}>go back</button>
      <button onClick={exitImpersonation}>exit impersonation</button>
    </div>
  );
}

async function renderReady() {
  // The mount-time session-restore effect calls POST /auth/refresh — reject
  // it by default (no logged-in session) so authLoading settles quickly and
  // doesn't interfere with what each test actually exercises. api.get gets a
  // harmless default too, since loadHoldings() fires off loadScoreBreakdown()
  // (GET /score/breakdown) without awaiting it — without a default here that
  // second, untracked call resolves to undefined and its own state update
  // lands outside of any act() wrapping.
  api.post.mockRejectedValue(new Error("no session"));
  api.get.mockResolvedValue({ data: { holdings: [] } });
  render(
    <DiveProvider>
      <TestHarness />
    </DiveProvider>
  );
  await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
}

// Flushes microtasks (pending .then() chains, including fire-and-forget
// calls like loadScoreBreakdown that loadHoldings doesn't await) so their
// state updates land inside this act() instead of warning about updates
// outside of it after the test has already moved on.
async function clickAndFlush(el) {
  await act(async () => {
    await userEvent.click(el);
    // A macrotask tick (not just a microtask) — a rejected-promise catch
    // branch's own state update can land a tick later than a resolved one.
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Regression test for a real bug found live: React StrictMode
// (index.js wraps the whole app in it) deliberately double-invokes effects
// in development — mount, cleanup, mount again. Without a guard, that fires
// TWO concurrent POST /auth/refresh calls sharing the same refresh cookie;
// the backend's single-use rotation treats the second one presenting an
// already-consumed token as theft and revokes the WHOLE session
// (authController.ts's refresh()). The first call still wins and this page
// load renders logged in, so nothing looks wrong yet — it's the refresh
// cookie's replacement that's silently dead, which only surfaces as a hard
// logout on the NEXT reload. Reported as "reload right after login works,
// reload later logs me out" and reproduced live against the real dev server
// (StrictMode is on in `npm start`) before this guard existed — the very
// next reload after a clean one landed back on the splash screen, logged
// out. Mirrors the identical guard/test already in admin/AdminAuthContext.jsx.
describe("DiveContext — StrictMode double-invoke guard", () => {
  it("calls /auth/refresh only ONCE even when the effect is invoked twice (StrictMode)", async () => {
    api.post.mockResolvedValue({ data: { accessToken: "tok", user: { id: "u1", name: "Test", age: 30, preferences: {} } } });
    api.get.mockResolvedValue({ data: { holdings: [] } });
    render(
      <React.StrictMode>
        <DiveProvider>
          <TestHarness />
        </DiveProvider>
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
    // Exactly one /auth/refresh call is the actual regression this test
    // guards — a second, unrelated call now legitimately happens once the
    // restored session lands on "home" (POST /usage/close-edit-sessions,
    // see DiveContext.js's own effect), so this can't assert total call
    // count anymore.
    expect(api.post.mock.calls.filter(([url]) => url === "/auth/refresh")).toHaveLength(1);
    expect(screen.getByTestId("user-name")).toHaveTextContent("Test");
  });
});

describe("DiveContext — loadHoldings error handling", () => {
  beforeEach(() => jest.clearAllMocks());

  it("populates holdings on a successful load", async () => {
    await renderReady();
    api.get.mockResolvedValueOnce({ data: { holdings: [{ _id: "1", name: "TCS", assetClass: "EQUITY", currentValue: 1000 }] } });

    await clickAndFlush(screen.getByText("reload holdings"));

    expect(screen.getByTestId("holdings-count")).toHaveTextContent("1");
    expect(screen.getByTestId("holdings-error")).toHaveTextContent("false");
  });

  it("does NOT clear a real portfolio to empty when a later load fails — the P1 #13 regression", async () => {
    await renderReady();

    // First, a real successful load establishes non-empty holdings.
    api.get.mockResolvedValueOnce({ data: { holdings: [{ _id: "1", name: "TCS", assetClass: "EQUITY", currentValue: 1000 }] } });
    await clickAndFlush(screen.getByText("reload holdings"));
    expect(screen.getByTestId("holdings-count")).toHaveTextContent("1");

    // Then a transient failure (network blip / expired session) on a later load.
    api.get.mockRejectedValueOnce(new Error("network error"));
    await clickAndFlush(screen.getByText("reload holdings"));

    // The real holding must still be there — this is exactly the bug that
    // used to make a working portfolio look like it "vanished".
    expect(screen.getByTestId("holdings-count")).toHaveTextContent("1");
    expect(screen.getByTestId("holdings-error")).toHaveTextContent("true");
  });
});

describe("DiveContext — goBack", () => {
  beforeEach(() => jest.clearAllMocks());

  // Regression test for a real user report: Home -> "Add investments"
  // (chooseMethod) -> pick a method (manualEntry) -> back -> "Skip for now"
  // on chooseMethod looped back to manualEntry instead of returning home. A
  // single "previous screen" slot (instead of a real stack) got overwritten
  // by the FIRST back-navigation itself, so the second back-navigation had
  // nowhere correct left to go.
  it("unwinds the actual path taken, not just the last two screens, across repeated back-navigation", async () => {
    await renderReady();
    // Screen starts at "splash" (pre-login) — establish "home" as the known
    // starting point for this navigation sequence, same as where a real
    // user lands post-login.
    await userEvent.click(screen.getByText("go home"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("home");

    await userEvent.click(screen.getByText("go chooseMethod"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("chooseMethod");

    await userEvent.click(screen.getByText("go manualEntry"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("manualEntry");

    // First back: manualEntry -> chooseMethod.
    await userEvent.click(screen.getByText("go back"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("chooseMethod");

    // Second back (the reported bug): must reach home, not loop back to
    // manualEntry.
    await userEvent.click(screen.getByText("go back"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("home");
  });

  it("falls back to home when the history stack is empty", async () => {
    await renderReady();
    await userEvent.click(screen.getByText("go back"));
    expect(screen.getByTestId("current-screen")).toHaveTextContent("home");
  });
});

// Phase 6a of docs/ADMIN_PANEL_PLAN.md §3.4, extended — the signal that
// closes whichever portfolio_edit/bot_scan "edit sessions" are open
// (usageService.ts::enforceEditSessionUsage), so a batch of edits across
// Manage Holdings + Add Investments consumes exactly one quota unit the
// moment the user actually reaches Home to see their updated score, not
// before and not per-mutation.
describe("DiveContext — closes edit sessions on reaching Home", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls POST /usage/close-edit-sessions when the screen becomes home", async () => {
    await renderReady();
    api.post.mockResolvedValueOnce({ data: { ok: true } });

    await userEvent.click(screen.getByText("go home"));

    expect(api.post).toHaveBeenCalledWith("/usage/close-edit-sessions");
  });

  it("does not call it when navigating to a non-home screen", async () => {
    await renderReady();
    jest.clearAllMocks();

    await userEvent.click(screen.getByText("go chooseMethod"));

    expect(api.post).not.toHaveBeenCalledWith("/usage/close-edit-sessions");
  });
});

describe("DiveContext — savePrefs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("applies the change immediately and keeps it on a successful save", async () => {
    await renderReady();
    api.patch.mockResolvedValueOnce({ data: { preferences: {} } });

    await clickAndFlush(screen.getByText("save prefs"));

    expect(screen.getByTestId("prefs-risk")).toHaveTextContent("Aggressive");
  });

  it("rolls back to the previous value when the save fails", async () => {
    await renderReady();
    expect(screen.getByTestId("prefs-risk")).toHaveTextContent("Balanced");
    api.patch.mockRejectedValueOnce(new Error("server error"));

    await clickAndFlush(screen.getByText("save prefs"));

    // Applied optimistically, then rolled back — must end up back at the
    // original value, not stuck showing a change that never actually saved.
    expect(screen.getByTestId("prefs-risk")).toHaveTextContent("Balanced");
  });
});

// Phase 2 of docs/ADMIN_PANEL_PLAN.md — picking up an admin-published
// Suggestion methodology config at app startup.
describe("DiveContext — remote Suggestion config fetch", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches /score/config on mount and applies the returned suggestion config", async () => {
    api.post.mockRejectedValue(new Error("no session"));
    api.get.mockImplementation((url) => {
      if (url === "/holdings") return Promise.resolve({ data: { holdings: [] } });
      if (url === "/score/config") return Promise.resolve({ data: { context: {}, suggestion: { coreCategories: ["Equity"] } } });
      return Promise.reject(new Error("unexpected " + url));
    });

    render(
      <DiveProvider>
        <TestHarness />
      </DiveProvider>
    );
    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));

    await waitFor(() => expect(applyRemoteSuggestionConfig).toHaveBeenCalledWith({ coreCategories: ["Equity"] }));
  });

  it("does not throw or block the rest of app startup when the fetch fails", async () => {
    api.post.mockRejectedValue(new Error("no session"));
    api.get.mockImplementation((url) => {
      if (url === "/holdings") return Promise.resolve({ data: { holdings: [] } });
      if (url === "/score/config") return Promise.reject(new Error("network down"));
      return Promise.reject(new Error("unexpected " + url));
    });

    render(
      <DiveProvider>
        <TestHarness />
      </DiveProvider>
    );

    // Auth/holdings startup still completes normally...
    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
    // ...and the failed config fetch is swallowed, never reaching apply.
    expect(applyRemoteSuggestionConfig).not.toHaveBeenCalled();
  });
});

// Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8 — read-only impersonation.
// admin/screens/UserDetail.jsx stashes {accessToken, expiresAt, user} in
// sessionStorage just before opening this app in a new tab; DiveContext's
// mount effect must find and use it INSTEAD of the normal cookie-based
// /auth/refresh restore.
describe("DiveContext — impersonation session restore", () => {
  afterEach(() => sessionStorage.clear());

  it("restores the session from sessionStorage, never calling /auth/refresh", async () => {
    sessionStorage.setItem(
      "divve_impersonation",
      JSON.stringify({ accessToken: "imp-token", expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), user: { id: "u1", name: "Impersonated User", age: 30, preferences: {} } })
    );
    api.get.mockResolvedValue({ data: { holdings: [] } });

    render(
      <DiveProvider>
        <TestHarness />
      </DiveProvider>
    );

    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user-name")).toHaveTextContent("Impersonated User");
    expect(screen.getByTestId("is-impersonating")).toHaveTextContent("true");
    expect(api.post).not.toHaveBeenCalledWith("/auth/refresh");
  });

  it("ignores an expired impersonation hand-off and falls back to the normal restore", async () => {
    sessionStorage.setItem(
      "divve_impersonation",
      JSON.stringify({ accessToken: "imp-token", expiresAt: new Date(Date.now() - 1000).toISOString(), user: { id: "u1", name: "Impersonated User", age: 30, preferences: {} } })
    );
    api.post.mockRejectedValue(new Error("no session"));
    api.get.mockResolvedValue({ data: { holdings: [] } });

    render(
      <DiveProvider>
        <TestHarness />
      </DiveProvider>
    );

    await waitFor(() => expect(screen.getByTestId("auth-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("is-impersonating")).toHaveTextContent("false");
    expect(sessionStorage.getItem("divve_impersonation")).toBeNull();
  });

  it("exitImpersonation clears the hand-off and returns to the splash screen", async () => {
    sessionStorage.setItem(
      "divve_impersonation",
      JSON.stringify({ accessToken: "imp-token", expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), user: { id: "u1", name: "Impersonated User", age: 30, preferences: {} } })
    );
    api.get.mockResolvedValue({ data: { holdings: [] } });

    render(
      <DiveProvider>
        <TestHarness />
      </DiveProvider>
    );
    await waitFor(() => expect(screen.getByTestId("is-impersonating")).toHaveTextContent("true"));

    await userEvent.click(screen.getByText("exit impersonation"));
    expect(screen.getByTestId("is-impersonating")).toHaveTextContent("false");
    expect(screen.getByTestId("user-name")).toHaveTextContent("");
    expect(sessionStorage.getItem("divve_impersonation")).toBeNull();
  });
});
