import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiveProvider, useDive } from "./DiveContext";
import { api } from "../lib/api";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  setAccessToken: jest.fn(),
  getAccessToken: jest.fn(),
  setSessionExpiredHandler: jest.fn(),
}));

// Exposes just enough of the context for these tests to drive and observe,
// mirroring how a real screen would consume useDive().
function TestHarness() {
  // Aliased to currentScreen — this file already imports testing-library's
  // own `screen` query object, and useDive()'s `screen` (the app's current
  // screen name) would otherwise shadow it.
  const { authLoading, holdings, holdingsError, loadHoldings, prefs, savePrefs, screen: currentScreen, setScreen, goBack } = useDive();
  return (
    <div>
      <div data-testid="auth-loading">{String(authLoading)}</div>
      <div data-testid="holdings-count">{holdings.length}</div>
      <div data-testid="holdings-error">{String(holdingsError)}</div>
      <div data-testid="prefs-risk">{prefs.risk}</div>
      <div data-testid="current-screen">{currentScreen}</div>
      <button onClick={() => loadHoldings()}>reload holdings</button>
      <button onClick={() => savePrefs({ ...prefs, risk: "Aggressive" })}>save prefs</button>
      <button onClick={() => setScreen("home")}>go home</button>
      <button onClick={() => setScreen("chooseMethod")}>go chooseMethod</button>
      <button onClick={() => setScreen("manualEntry")}>go manualEntry</button>
      <button onClick={goBack}>go back</button>
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
