// Deep links into this app. The main app has no URL routing of its own —
// everything outside /admin is one screen-state-navigated SPA at "/" (see
// App.js / DiveContext's `screen`) — so a notification, email, or pop-up that
// wants to send someone to "the login page" or "the subscription page" can't
// use a real path. Instead it links to `/?go=<name>`, and this module maps
// that name to a screen on load.
//
// The `key`/`path` list is also what the admin panel's link picker offers
// (admin/LinkUrlInput.jsx), so what staff can choose and what the app
// actually understands stay in one place.
export const DEEP_LINK_DESTINATIONS = [
  { key: "landing", label: "Landing page", path: "/", screen: null, requiresAuth: false },
  { key: "login", label: "Log in", path: "/?go=login", screen: "login", requiresAuth: false },
  { key: "signup", label: "Sign up", path: "/?go=signup", screen: "signup", requiresAuth: false },
  { key: "home", label: "Home (dashboard)", path: "/?go=home", screen: "home", requiresAuth: true },
  { key: "xray", label: "X-Ray", path: "/?go=xray", screen: "xray", requiresAuth: true },
  { key: "suggestions", label: "Suggestions", path: "/?go=suggestions", screen: "suggestions", requiresAuth: true },
  { key: "planner", label: "Divve Planner", path: "/?go=planner", screen: "planner", requiresAuth: true },
  { key: "subscription", label: "Subscription", path: "/?go=subscription", screen: "subscription", requiresAuth: true },
  { key: "profile", label: "Profile", path: "/?go=profile", screen: "profile", requiresAuth: true },
];

const PENDING_KEY = "dive:pendingGo";

function destinationFor(key) {
  return DEEP_LINK_DESTINATIONS.find((d) => d.key === key) || null;
}

function readPending() {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function writePending(key) {
  try {
    sessionStorage.setItem(PENDING_KEY, key);
  } catch {
    // sessionStorage unavailable (private mode etc.) — the deep link just won't survive a login redirect
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

// Reads `?go=` from the current URL, strips it (so a refresh or a shared URL
// doesn't re-trigger it), and remembers a VALID destination for the session
// — it may need to wait for the session-restore check or a login before it
// can be applied. An unknown value is ignored (but still stripped).
export function captureDeepLink() {
  let go = null;
  try {
    const url = new URL(window.location.href);
    go = url.searchParams.get("go");
    if (go === null) return;
    url.searchParams.delete("go");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    return;
  }
  if (destinationFor(go)) writePending(go);
}

// Which screen to land on once we know the visitor IS logged in (right after
// the session restores, or after a login). A members-only destination goes
// straight there; login/signup/landing are meaningless for someone already
// in, so they just land on Home like any other login.
export function screenAfterLogin() {
  const pending = readPending();
  if (!pending) return "home";
  clearPending();
  const dest = destinationFor(pending);
  return dest?.requiresAuth ? dest.screen : "home";
}

// Which screen to show when there's NO session. `login`/`signup` open that
// screen directly; `landing` is just the landing page (nothing to do); a
// members-only destination sends them to log in, and stays remembered so
// screenAfterLogin() can take them there afterwards. Returns null when
// there's nothing to apply.
export function screenWhenLoggedOut() {
  const pending = readPending();
  if (!pending) return null;
  const dest = destinationFor(pending);
  if (!dest) {
    clearPending();
    return null;
  }
  if (dest.requiresAuth) return "login";
  clearPending();
  return dest.screen;
}
