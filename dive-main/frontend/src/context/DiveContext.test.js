import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiveProvider, useDive } from "./DiveContext";
import { api } from "../lib/api";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  setAccessToken: jest.fn(),
  setSessionExpiredHandler: jest.fn(),
}));

function Harness() {
  const { plannerState, setPlannerState, sims, addSim, login, user } = useDive();
  return (
    <div>
      <span data-testid="lumpsum">{plannerState.lumpsumAmount}</span>
      <span data-testid="sims-count">{sims.length}</span>
      <span data-testid="logged-in">{String(!!user)}</span>
      <button data-testid="set-planner" onClick={() => setPlannerState({ lumpsumAmount: 999999, mode: "lumpsum" })}>set</button>
      <button data-testid="add-sim" onClick={() => addSim("Gold", 5000)}>sim</button>
      <button data-testid="do-login" onClick={() => login("test@example.com", "pw")}>login</button>
    </div>
  );
}

// Bug report: Planner inputs (lumpsum/SIP amounts) set while browsing the
// marketing landing page's logged-out demo showed up again after logging in
// for real, in the same tab. Root cause: the demo phone frame and the real
// logged-in app deliberately share one long-lived DiveProvider instance (see
// App.js/PhoneFrame — never remounted across the login transition), so
// plannerState/sims never got reset unless login()/signupVerify()/logout()
// explicitly did it.
describe("DiveContext — demo scratch state (Planner inputs, Ask DIVVE sims) resets on login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.post.mockImplementation((url) => {
      if (url === "/auth/refresh") return Promise.reject(new Error("no session"));
      if (url === "/auth/login") {
        return Promise.resolve({ data: { accessToken: "tok", user: { id: "u1", name: "Test", age: 30, preferences: {} } } });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    api.get.mockImplementation((url) => {
      if (url === "/holdings") return Promise.resolve({ data: { holdings: [] } });
      if (url === "/score/breakdown") return Promise.resolve({ data: {} });
      return Promise.reject(new Error("unexpected " + url));
    });
  });

  it("resets Planner amounts and Ask DIVVE sims set while logged out once a real login succeeds", async () => {
    const user = userEvent.setup();
    render(
      <DiveProvider>
        <Harness />
      </DiveProvider>
    );

    // Initial session-restore check (no session) has resolved and defaults are showing.
    await waitFor(() => expect(screen.getByTestId("lumpsum")).toHaveTextContent("50000"));
    expect(screen.getByTestId("sims-count")).toHaveTextContent("0");

    // Play with Planner and a simulation as a logged-out demo visitor would.
    await user.click(screen.getByTestId("set-planner"));
    await user.click(screen.getByTestId("add-sim"));
    expect(screen.getByTestId("lumpsum")).toHaveTextContent("999999");
    expect(screen.getByTestId("sims-count")).toHaveTextContent("1");

    // The actual bug: these must NOT still be there after a real login.
    await user.click(screen.getByTestId("do-login"));

    await waitFor(() => expect(screen.getByTestId("lumpsum")).toHaveTextContent("50000"));
    expect(screen.getByTestId("sims-count")).toHaveTextContent("0");
  });
});

// Follow-up feature request: Planner amounts should persist per-account (via
// PATCH /users/me/planner, mirroring how prefs already work), not just reset
// to the same hardcoded defaults on every login.
describe("DiveContext — Divve Planner persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === "/holdings") return Promise.resolve({ data: { holdings: [] } });
      if (url === "/score/breakdown") return Promise.resolve({ data: {} });
      return Promise.reject(new Error("unexpected " + url));
    });
  });

  it("loads the user's real saved plannerState on login, not just the hardcoded defaults", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/auth/refresh") return Promise.reject(new Error("no session"));
      if (url === "/auth/login") {
        return Promise.resolve({
          data: {
            accessToken: "tok",
            user: {
              id: "u1", name: "Test", age: 30, preferences: {},
              plannerState: { mode: "sip", lumpsumAmount: 50000, sipMonthly: 12345, sipStepUp: 10, sipYears: 10, sipExpandedMonthly: false },
            },
          },
        });
      }
      return Promise.reject(new Error("unexpected " + url));
    });

    function SipHarness() {
      const { plannerState, login } = useDive();
      return (
        <div>
          <span data-testid="sip-monthly">{plannerState.sipMonthly}</span>
          <button data-testid="do-login" onClick={() => login("test@example.com", "pw")}>login</button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(
      <DiveProvider>
        <SipHarness />
      </DiveProvider>
    );

    // Defaults first (no session on mount).
    await waitFor(() => expect(screen.getByTestId("sip-monthly")).toHaveTextContent("5000"));

    await user.click(screen.getByTestId("do-login"));

    // The actual feature: the account's own real saved value, not 5000.
    await waitFor(() => expect(screen.getByTestId("sip-monthly")).toHaveTextContent("12345"));
  });

  it("debounces a save to /users/me/planner when a logged-in user edits Planner", async () => {
    jest.useFakeTimers();
    api.post.mockImplementation((url) => {
      if (url === "/auth/refresh") return Promise.reject(new Error("no session"));
      if (url === "/auth/login") {
        return Promise.resolve({ data: { accessToken: "tok", user: { id: "u1", name: "Test", age: 30, preferences: {} } } });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    api.patch.mockResolvedValue({ data: { plannerState: {} } });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: null });
    render(
      <DiveProvider>
        <Harness />
      </DiveProvider>
    );

    await waitFor(() => expect(screen.getByTestId("lumpsum")).toHaveTextContent("50000"));
    await user.click(screen.getByTestId("do-login"));
    await waitFor(() => expect(screen.getByTestId("logged-in")).toHaveTextContent("true"));

    await user.click(screen.getByTestId("set-planner"));
    // Not yet — a save shouldn't fire on every single keystroke/drag tick.
    expect(api.patch).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(800);
    });

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/users/me/planner", expect.objectContaining({ lumpsumAmount: 999999, mode: "lumpsum" }))
    );

    jest.useRealTimers();
  });
});
