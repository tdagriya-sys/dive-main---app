import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import { adaptHolding, IDEAL_RANGES } from "../lib/diveEngine";

const DiveContext = createContext(null);
export const useDive = () => useContext(DiveContext);

// Must match backend/src/models/User.ts's plannerStateSchema defaults
// exactly — this is what a brand-new account (or any account whose
// plannerState was never saved) starts from, both here and on the server.
const DEFAULT_PLANNER_STATE = {
  mode: null, // null | "lumpsum" | "sip"
  lumpsumAmount: 50000,
  sipMonthly: 5000,
  sipStepUp: 10,
  sipYears: 10,
  sipExpandedMonthly: false,
};

export function DiveProvider({ children }) {
  const [screen, setScreenState] = useState("splash"); // onboarding + app screens
  // A real navigation STACK, not just a single "previous screen" slot — the
  // single-slot version broke as soon as a back-navigation itself became the
  // "previous" for the next one. Concretely: Home -> chooseMethod (previous
  // <- home) -> manualEntry (previous <- chooseMethod) -> back (goBack sets
  // screen to chooseMethod, but ALSO overwrites previous <- manualEntry,
  // since it's implemented as just another setScreen call) -> "Skip for now"
  // on chooseMethod now goes BACK to manualEntry instead of home, a 2-cycle
  // loop that never actually returns where the user started. A stack fixes
  // this the same way browser history does: every real navigation PUSHES
  // the screen being left, and goBack POPs — never pushes — so unwinding
  // repeatedly retraces the actual path taken, however deep, instead of
  // bouncing between the last two screens. Several screens (Ask DIVE, My
  // Holdings) are reachable from more than one place, which is exactly why
  // this needs to be a stack and not a fixed hardcoded destination either.
  const screenHistoryRef = useRef([]);
  const setScreen = useCallback((next) => {
    setScreenState((current) => {
      if (next !== current) screenHistoryRef.current.push(current);
      return next;
    });
  }, []);
  const goBack = useCallback(() => {
    setScreenState(() => screenHistoryRef.current.pop() ?? "home");
  }, []);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);

  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  // Distinguishes "the backend really has no holdings for this user" from "we
  // couldn't reach the backend" — without this, a network blip or expired
  // session makes loadHoldings() resetting to [] look identical to a
  // genuinely empty portfolio, and the UI would show the "add your first
  // holding" empty state over a real, non-empty portfolio.
  const [holdingsError, setHoldingsError] = useState(false);
  // Mirrors `holdings` so loadHoldings' catch block can return the
  // last-known-good list on failure without needing `holdings` itself in its
  // useCallback deps (which would recreate the callback — and re-run any
  // effect depending on it — on every successful load).
  const holdingsRef = useRef(holdings);
  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);
  // The ONE canonical Dive Score (composite + apparent/real diversification +
  // full resilience breakdown), computed server-side. Home/X-Ray/Insights all
  // read this when no simulation is active, instead of each independently
  // recomputing a score client-side — there is one calculator, not two.
  const [scoreBreakdown, setScoreBreakdown] = useState(null);
  const loadScoreBreakdown = useCallback(async () => {
    try {
      const { data } = await api.get("/score/breakdown");
      setScoreBreakdown(data);
      return data;
    } catch (e) {
      setScoreBreakdown(null);
      return null;
    }
  }, []);
  const ranges = IDEAL_RANGES;
  const [prefs, setPrefs] = useState({
    risk: "Balanced", returnExpectation: "Moderate", diversificationPriority: "High",
    preferred: [], excluded: [],
  });
  const [askInstrument, setAskInstrument] = useState(null);
  // The holding ManualEntry should pre-fill and PATCH instead of POST when
  // it's opened for editing — same "selected item lives in context, target
  // screen reads it" pattern as askInstrument above. Cleared once the edit
  // is saved or abandoned so a later plain "add a holding" doesn't
  // accidentally reopen in edit mode.
  const [editingHolding, setEditingHolding] = useState(null);
  const [sims, setSims] = useState([]); // client-side "what-if" simulated allocations (not persisted per-user yet)

  // Divve Planner's inputs (mode + lumpsum amount + SIP fields) live here, not as
  // local useState inside Planner.jsx, because DiveShell's <AnimatePresence
  // key={screen}> unmounts a screen's component tree on every navigation away
  // from it — local state would silently reset to defaults each time the user
  // left and returned to the Planner tab. Lifting it here means it survives for
  // the rest of the session. Persisted server-side via PATCH /users/me/planner
  // (debounced below) so a returning user sees their real last-entered values,
  // not just the defaults — the demo phone frame and the logged-in app share
  // this same context instance without a remount between them, so on login/
  // signup this also has to explicitly load (or reset to defaults) the new
  // identity's own value; it's never automatic on its own.
  const [plannerState, setPlannerStateRaw] = useState(DEFAULT_PLANNER_STATE);
  const setPlannerState = useCallback((patch) => {
    setPlannerStateRaw((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  }, []);
  const loadPlannerStateFrom = (u) => setPlannerStateRaw({ ...DEFAULT_PLANNER_STATE, ...(u?.plannerState || {}) });

  // Debounced save — Planner's slider/number inputs fire on every drag tick
  // or keystroke, and PATCHing on each one would spam the backend. Waits for
  // 800ms of no further changes before actually saving. `skipNextSaveRef`
  // suppresses the save that would otherwise fire right after loadPlannerStateFrom
  // itself changes plannerState (login/signup/session-restore) — that's a
  // load, not a user edit, and re-saving the identical value back is pure
  // waste. Best-effort: a failed save just gets superseded by the next real
  // edit, and a slider drag isn't worth interrupting with an error toast.
  const plannerSaveTimerRef = useRef(null);
  const skipNextPlannerSaveRef = useRef(true);
  useEffect(() => {
    if (skipNextPlannerSaveRef.current) {
      skipNextPlannerSaveRef.current = false;
      return undefined;
    }
    if (!user) return undefined;
    if (plannerSaveTimerRef.current) clearTimeout(plannerSaveTimerRef.current);
    plannerSaveTimerRef.current = setTimeout(() => {
      api.patch("/users/me/planner", plannerState).catch(() => {});
    }, 800);
    return () => clearTimeout(plannerSaveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerState, user]);

  const addSim = (segment, amount) => {
    setSims((prev) => {
      const exists = prev.find((s) => s.segment === segment);
      return exists ? prev.map((s) => (s.segment === segment ? { ...s, amount } : s)) : [...prev, { segment, amount }];
    });
  };
  const resetSims = () => setSims([]);

  const loadHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    setHoldingsError(false);
    try {
      const { data } = await api.get("/holdings");
      const adapted = (data.holdings || []).map(adaptHolding);
      setHoldings(adapted);
      loadScoreBreakdown(); // refresh the one canonical score alongside holdings — fire and forget
      return adapted;
    } catch (e) {
      // Deliberately does NOT clear holdings to [] — a transient failure
      // (network blip, expired session) must not make a real portfolio look
      // like it vanished. Keep whatever was last successfully loaded and let
      // the UI show a distinct "couldn't load" state instead (see Home.jsx).
      setHoldingsError(true);
      return holdingsRef.current;
    } finally {
      setHoldingsLoading(false);
    }
  }, [loadScoreBreakdown]);

  // On mount: try to restore a session from the httpOnly refresh cookie.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post("/auth/refresh");
        setAccessToken(data.accessToken);
        setUser(data.user);
        setPrefs((p) => ({
          ...p,
          ...(data.user.preferences || {}),
          // Backend stores these under different field names (diversificationGoal,
          // preferredCategories, excludedCategories) than the frontend's prefs
          // shape expects — the spread above only updates same-named fields
          // (risk, returnExpectation); without this, diversification priority
          // and preferred/excluded categories silently reset to defaults on
          // every reload/login despite having saved correctly.
          diversificationPriority: data.user.preferences?.diversificationGoal ?? p.diversificationPriority,
          preferred: data.user.preferences?.preferredCategories ?? p.preferred,
          excluded: data.user.preferences?.excludedCategories ?? p.excluded,
        }));
        skipNextPlannerSaveRef.current = true;
        loadPlannerStateFrom(data.user);
        const loaded = await loadHoldings();
        setScreen(loaded.length ? "home" : "chooseMethod");
      } catch (e) {
        // no valid session — stay on splash/onboarding
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [loadHoldings]);

  // Registers the one global handler for "the refresh token is dead mid-
  // session" (lib/api.js's response interceptor calls this after its own
  // refresh attempt fails on a 401 from some other endpoint) — without this,
  // only the very first page-load session check could ever send a user back
  // to onboarding; every later expiry just left requests failing silently
  // against whatever screen was already open.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
      setHoldings([]);
      setScreen("splash");
    });
  }, [setScreen]);

  const signupStart = async (form) => {
    const { data } = await api.post("/auth/signup/start", form);
    return data; // { message, mobile, devOtp? }
  };

  // The demo phone frame and the real logged-in app share this same
  // long-lived context (deliberately never remounted on login — see
  // App.js/PhoneFrame), so anything a logged-out visitor played with in the
  // demo (Ask DIVVE's "what-if" simulation — never persisted, unlike
  // plannerState now) would otherwise survive straight into their real
  // account the moment they sign up or log in, in the same tab. Planner
  // itself is handled by loadPlannerStateFrom (loads the new identity's real
  // saved value, or its defaults if it has none) rather than a blind reset.
  // Also matters for logout→a different person logging in on the same
  // shared/kiosk browser.
  const resetClientOnlyScratchState = () => {
    skipNextPlannerSaveRef.current = true;
    setPlannerStateRaw(DEFAULT_PLANNER_STATE);
    setSims([]);
  };

  const signupVerify = async (mobile, otp) => {
    const { data } = await api.post("/auth/signup/verify", { mobile, otp });
    setAccessToken(data.accessToken);
    setUser(data.user);
    skipNextPlannerSaveRef.current = true;
    loadPlannerStateFrom(data.user);
    setSims([]);
    return data.user;
  };

  const login = async (identifier, password) => {
    const { data } = await api.post("/auth/login", { identifier, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setPrefs((p) => ({ ...p, ...(data.user.preferences || {}) }));
    skipNextPlannerSaveRef.current = true;
    loadPlannerStateFrom(data.user);
    setSims([]);
    const loaded = await loadHoldings();
    setScreen(loaded.length ? "home" : "chooseMethod");
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    setAccessToken(null);
    setUser(null);
    setHoldings([]);
    resetClientOnlyScratchState();
    setScreen("splash");
  };

  // Applies optimistically (instant UI feedback), but rolls back and reports
  // failure to the caller on error — previously this was a silent no-op on
  // failure, so the UI kept showing a "saved" change that never reached the
  // backend and would be quietly lost on the next real reload/login.
  const savePrefs = async (next) => {
    const previous = prefs;
    setPrefs(next);
    try {
      await api.patch("/users/me/preferences", next);
      return true;
    } catch (e) {
      setPrefs(previous);
      return false;
    }
  };

  const deleteHolding = async (holdingId) => {
    await api.delete(`/holdings/${holdingId}`);
    await loadHoldings();
  };

  const updateHolding = async (holdingId, payload) => {
    await api.patch(`/holdings/${holdingId}`, payload);
    await loadHoldings();
  };

  const updateProfile = async (payload) => {
    const { data } = await api.patch("/users/me/profile", payload);
    setUser(data.user);
    // Age drives the backend's persona/life-stage context (contextEngine.ts),
    // which scoreBreakdown.context carries into Suggestions/Home's messaging
    // — without this, a changed age wouldn't show up there until some other
    // action (adding/deleting a holding) happened to refetch scoreBreakdown,
    // or the page was reloaded.
    if (holdings.length) loadScoreBreakdown();
    return data.user;
  };

  // Unlike savePrefs/updateProfile, this is never optimistic — there's
  // nothing locally cached to update either way, and a wrong current-password
  // guess needs to surface as a real error, not something to silently retry.
  const changePassword = async (payload) => {
    const { data } = await api.patch("/users/me/password", payload);
    return data.message;
  };

  const deleteAccount = async () => {
    await api.delete("/users/me");
    setAccessToken(null);
    setUser(null);
    setHoldings([]);
    setScreen("splash");
  };

  const value = {
    screen, setScreen, goBack, authLoading, user,
    signupStart, signupVerify, login, logout, deleteAccount,
    updateProfile, changePassword,
    holdings, holdingsLoading, holdingsError, loadHoldings, deleteHolding, updateHolding,
    scoreBreakdown, loadScoreBreakdown,
    ranges, prefs, setPrefs, savePrefs,
    askInstrument, setAskInstrument,
    editingHolding, setEditingHolding,
    sims, addSim, resetSims,
    plannerState, setPlannerState,
  };
  return <DiveContext.Provider value={value}>{children}</DiveContext.Provider>;
}
