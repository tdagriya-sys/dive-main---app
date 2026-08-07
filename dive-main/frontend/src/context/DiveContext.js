import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { api, setAccessToken } from "../lib/api";
import { adaptHolding, IDEAL_RANGES } from "../lib/diveEngine";

const DiveContext = createContext(null);
export const useDive = () => useContext(DiveContext);

export function DiveProvider({ children }) {
  const [screen, setScreenState] = useState("splash"); // onboarding + app screens
  // Tracks the single screen navigated FROM, so a generic "back" can return to
  // wherever the user actually arrived from. Several screens (Ask DIVE, My
  // Holdings) are reachable from more than one place — a back button that
  // hardcodes one fixed destination would silently strand a user who came in
  // from somewhere else.
  const previousScreenRef = useRef("home");
  const setScreen = useCallback((next) => {
    setScreenState((current) => {
      if (next !== current) previousScreenRef.current = current;
      return next;
    });
  }, []);
  const goBack = useCallback(() => setScreen(previousScreenRef.current), [setScreen]);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);

  const [holdings, setHoldings] = useState([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
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
  const [sims, setSims] = useState([]); // client-side "what-if" simulated allocations (not persisted per-user yet)

  // Divve Planner's inputs (mode + lumpsum amount + SIP fields) live here, not as
  // local useState inside Planner.jsx, because DiveShell's <AnimatePresence
  // key={screen}> unmounts a screen's component tree on every navigation away
  // from it — local state would silently reset to defaults each time the user
  // left and returned to the Planner tab. Lifting it here means it survives for
  // the rest of the session. Not yet synced to the backend (no endpoint/schema
  // field exists for it, unlike `prefs`), so a fresh login/session still starts
  // from these defaults — wire up a real save the same way `savePrefs` does once
  // Mongo-backed persistence for this is needed.
  const [plannerState, setPlannerStateRaw] = useState({
    mode: null, // null | "lumpsum" | "sip"
    lumpsumAmount: 50000,
    sipMonthly: 5000,
    sipStepUp: 10,
    sipYears: 10,
    sipExpandedMonthly: false,
  });
  const setPlannerState = useCallback((patch) => {
    setPlannerStateRaw((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  }, []);

  const addSim = (segment, amount) => {
    setSims((prev) => {
      const exists = prev.find((s) => s.segment === segment);
      return exists ? prev.map((s) => (s.segment === segment ? { ...s, amount } : s)) : [...prev, { segment, amount }];
    });
  };
  const resetSims = () => setSims([]);

  const loadHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    try {
      const { data } = await api.get("/holdings");
      const adapted = (data.holdings || []).map(adaptHolding);
      setHoldings(adapted);
      loadScoreBreakdown(); // refresh the one canonical score alongside holdings — fire and forget
      return adapted;
    } catch (e) {
      setHoldings([]);
      return [];
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
        const loaded = await loadHoldings();
        setScreen(loaded.length ? "home" : "chooseMethod");
      } catch (e) {
        // no valid session — stay on splash/onboarding
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [loadHoldings]);

  const signupStart = async (form) => {
    const { data } = await api.post("/auth/signup/start", form);
    return data; // { message, mobile, devOtp? }
  };

  const signupVerify = async (mobile, otp) => {
    const { data } = await api.post("/auth/signup/verify", { mobile, otp });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const login = async (identifier, password) => {
    const { data } = await api.post("/auth/login", { identifier, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setPrefs((p) => ({ ...p, ...(data.user.preferences || {}) }));
    const loaded = await loadHoldings();
    setScreen(loaded.length ? "home" : "chooseMethod");
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    setAccessToken(null);
    setUser(null);
    setHoldings([]);
    setScreen("splash");
  };

  const savePrefs = async (next) => {
    setPrefs(next);
    try { await api.patch("/users/me/preferences", next); } catch (e) { /* best-effort */ }
  };

  const deleteHolding = async (holdingId) => {
    await api.delete(`/holdings/${holdingId}`);
    await loadHoldings();
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
    holdings, holdingsLoading, loadHoldings, deleteHolding,
    scoreBreakdown, loadScoreBreakdown,
    ranges, prefs, setPrefs, savePrefs,
    askInstrument, setAskInstrument,
    sims, addSim, resetSims,
    plannerState, setPlannerState,
  };
  return <DiveContext.Provider value={value}>{children}</DiveContext.Provider>;
}
