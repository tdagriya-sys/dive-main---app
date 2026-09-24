import { captureDeepLink, screenAfterLogin, screenWhenLoggedOut, DEEP_LINK_DESTINATIONS } from "./deepLink";

function visit(pathAndQuery) {
  window.history.pushState({}, "", pathAndQuery);
}

beforeEach(() => {
  sessionStorage.clear();
  visit("/");
});

describe("captureDeepLink", () => {
  it("strips ?go= from the URL (so a refresh doesn't re-trigger it) and remembers a valid destination", () => {
    visit("/?go=login");
    captureDeepLink();
    expect(window.location.search).toBe("");
    expect(screenWhenLoggedOut()).toBe("login");
  });

  it("keeps any other query params and the hash intact while removing only go", () => {
    visit("/?utm_source=email&go=signup#top");
    captureDeepLink();
    expect(window.location.search).toBe("?utm_source=email");
    expect(window.location.hash).toBe("#top");
  });

  it("ignores an unknown destination but still strips it", () => {
    visit("/?go=not-a-page");
    captureDeepLink();
    expect(window.location.search).toBe("");
    expect(screenWhenLoggedOut()).toBeNull();
    expect(screenAfterLogin()).toBe("home");
  });

  it("does nothing when there is no go param", () => {
    visit("/?foo=bar");
    captureDeepLink();
    expect(window.location.search).toBe("?foo=bar");
    expect(screenWhenLoggedOut()).toBeNull();
  });
});

describe("screenWhenLoggedOut", () => {
  it("opens the login or signup screen directly", () => {
    visit("/?go=signup");
    captureDeepLink();
    expect(screenWhenLoggedOut()).toBe("signup");
    // consumed — asking again returns nothing
    expect(screenWhenLoggedOut()).toBeNull();
  });

  it("treats 'landing' as nothing to do (the landing page is already what a logged-out visitor sees)", () => {
    visit("/?go=landing");
    captureDeepLink();
    expect(screenWhenLoggedOut()).toBeNull();
    expect(screenAfterLogin()).toBe("home");
  });

  it("sends a members-only destination to login, and remembers it for after login", () => {
    visit("/?go=subscription");
    captureDeepLink();
    expect(screenWhenLoggedOut()).toBe("login");
    // still pending — the login flow will consume it
    expect(screenAfterLogin()).toBe("subscription");
    expect(screenAfterLogin()).toBe("home");
  });
});

describe("screenAfterLogin", () => {
  it("lands on Home by default", () => {
    expect(screenAfterLogin()).toBe("home");
  });

  it("goes straight to a members-only destination", () => {
    visit("/?go=xray");
    captureDeepLink();
    expect(screenAfterLogin()).toBe("xray");
  });

  it("lands on Home for login/signup deep links once already logged in", () => {
    visit("/?go=login");
    captureDeepLink();
    expect(screenAfterLogin()).toBe("home");
  });
});

describe("DEEP_LINK_DESTINATIONS", () => {
  it("every path round-trips through captureDeepLink to the same destination", () => {
    for (const dest of DEEP_LINK_DESTINATIONS) {
      sessionStorage.clear();
      visit(dest.path);
      captureDeepLink();
      const applied = dest.requiresAuth ? screenAfterLogin() : screenWhenLoggedOut();
      if (dest.key === "landing") expect(applied).toBeNull();
      else expect(applied).toBe(dest.screen);
    }
  });
});
