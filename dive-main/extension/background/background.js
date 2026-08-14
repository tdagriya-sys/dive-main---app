// MV3 background service worker — the ONLY place in this extension that
// talks to the Dive backend. Content scripts never fetch directly; they send
// a runtime message here and get a plain-data reply. Keeping all network I/O
// in one place is what lets the manifest avoid needing backend CORS changes
// (see diveApi.js's header) and keeps auth tokens out of the page context
// entirely (chrome.storage.local set here is not reachable from the
// content-script's page world).

import { STORAGE_KEYS } from "../shared/config.js";
import { adaptHolding, ASSET_CLASS_LABELS } from "../shared/diveEngine.js";
import { buildFitVerdict } from "../shared/fitMessage.js";
import * as diveApi from "./diveApi.js";

// Short-lived in-memory cache so rapid quantity-field keystrokes on the order
// page don't each trigger a fresh /holdings + /score/breakdown round trip.
// Rebuilt automatically whenever the service worker restarts — that's fine,
// the underlying calls are cheap (score/breakdown is itself cached server-
// side for 5 minutes per diveScoreService.ts).
const CACHE_TTL_MS = 90 * 1000;
let cache = { at: 0, holdings: null, scoreBreakdown: null, me: null };

async function loadPortfolioSnapshot() {
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.holdings) return cache;
  const [holdings, scoreBreakdown, me] = await Promise.all([
    diveApi.getHoldings(),
    diveApi.getScoreBreakdown(),
    diveApi.getMe(),
  ]);
  cache = { at: Date.now(), holdings, scoreBreakdown, me };
  return cache;
}

function invalidateCache() {
  cache = { at: 0, holdings: null, scoreBreakdown: null, me: null };
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// assetClassHint comes from siteAdapters.js's extractAssetClassHint — a
// keyword read off the instrument's own descriptive name/page text ("...
// ETF", "... Fund", "... REIT", etc). It's the fallback when the Dive
// instrument master doesn't have this exact instrument seeded (e.g. an
// Angel One house ETF), so an unmatched non-equity instrument doesn't
// silently get mislabeled Equity — which is what happened before this was
// added (an "AONETOTAL" ETF purchase showed an Equity-overexposure warning
// because "EQUITY" was the only fallback that existed).
// `confident: false` means neither the Dive instrument master NOR the
// page-derived keyword hint could identify this instrument's real asset
// class — it's landed on the Equity default purely because that's the most
// common case, not because anything actually confirmed it. This matters:
// Divve's instrument master is only as complete as whatever backend/src/
// services/instrumentService.ts's live NSE/AMFI/CoinGecko refresh has
// ingested (e.g. dev instances running on the default in-memory MongoDB
// re-fetch it fresh on every restart, and a failed/rate-limited fetch there
// silently leaves gaps) — a confidently-worded "X is already over its ideal
// range" message built on an unconfirmed guess would be actively misleading
// rather than just imprecise, so buildFitVerdict (fitMessage.js) appends a
// visible caveat whenever this is false instead of asserting the guess.
async function resolveInstrument(rawName, assetClassHint) {
  const trimmed = (rawName || "").trim();
  const fallbackAssetClass = assetClassHint || "EQUITY";
  const confident = !!assetClassHint; // the page itself told us — trust that even without a DB match
  if (!trimmed) return { name: rawName, assetClass: fallbackAssetClass, confident };
  try {
    const matches = await diveApi.searchInstruments(trimmed);
    const target = norm(trimmed);
    if (matches && matches.length > 0 && target) {
      const exact = matches.find((m) => norm(m.symbol) === target || norm(m.name) === target);
      // /instruments/search is a plain substring regex sorted alphabetically
      // by name, NOT by relevance — its "first" result can be only loosely
      // (or not at all) related to the query, e.g. if the scraped name was
      // itself a weak fallback (extractInstrumentNameFromTitle in
      // siteAdapters.js). Only trust a non-exact match's assetClass when the
      // query is genuinely a substring of its symbol/name or vice versa —
      // otherwise fall through to the hint-or-Equity default below rather
      // than risk mislabeling the asset class off an unrelated instrument.
      const related =
        exact || matches.find((m) => norm(m.symbol).includes(target) || norm(m.name).includes(target) || target.includes(norm(m.symbol)));
      if (related) return { name: related.name || trimmed, assetClass: related.assetClass || fallbackAssetClass, issuer: related.issuer, confident: true };
    }
  } catch {
    // Search is a best-effort enrichment step (asset-class lookup) — a
    // failure here shouldn't block showing a verdict at all, it just falls
    // back to the page-derived hint (or plain Equity, the overwhelmingly
    // common case on Angel One's order screen, if there wasn't one).
  }
  return { name: trimmed, assetClass: fallbackAssetClass, confident };
}

async function handleGetFitVerdict({ instrumentName, amount, assetClassHint }) {
  if (!amount || amount <= 0) return { ok: false, reason: "NO_AMOUNT" };
  const [{ holdings, scoreBreakdown, me }, instrument] = await Promise.all([
    loadPortfolioSnapshot(),
    resolveInstrument(instrumentName, assetClassHint),
  ]);

  const adapted = holdings.map(adaptHolding);
  const riskProfile = me?.preferences?.risk || "Balanced";
  const extra = {
    name: instrument.issuer || instrument.name,
    assetClass: instrument.assetClass,
    segment: undefined, // filled in by buildFitVerdict via ASSET_CLASS_LABELS[assetClass]
    amount,
  };
  extra.segment = ASSET_CLASS_LABELS[instrument.assetClass] || instrument.assetClass;

  const verdict = buildFitVerdict({ holdings: adapted, scoreBreakdown, riskProfile, extra, assetClassConfident: instrument.confident });
  return { ok: true, verdict, instrument };
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "LOGIN": {
      const user = await diveApi.login(msg.identifier, msg.password);
      invalidateCache();
      await chrome.storage.local.set({ [STORAGE_KEYS.userEmail]: user.email });
      return { ok: true, user };
    }
    case "LOGOUT": {
      await diveApi.logout();
      invalidateCache();
      return { ok: true };
    }
    case "GET_STATUS": {
      const token = await diveApi.getAccessToken();
      const stored = await chrome.storage.local.get([STORAGE_KEYS.userEmail, STORAGE_KEYS.apiBase]);
      let loggedIn = !!token;
      if (loggedIn) {
        // A token string sitting in storage isn't proof it still works —
        // access tokens are short-lived (15 min), so without this check the
        // popup could keep saying "Connected" for a while after expiry,
        // until whatever the next order-page request happened to be. This
        // costs one cheap /auth/me call (and self-heals via diveApi's own
        // refresh-or-clear logic) each time the popup is opened.
        loggedIn = await diveApi
          .getMe()
          .then(() => true)
          .catch(() => false);
      }
      return { ok: true, loggedIn, email: stored[STORAGE_KEYS.userEmail] || null, apiBase: await diveApi.getApiBase() };
    }
    case "SET_API_BASE": {
      await chrome.storage.local.set({ [STORAGE_KEYS.apiBase]: msg.apiBase });
      invalidateCache();
      return { ok: true };
    }
    case "GET_FIT_VERDICT":
      return handleGetFitVerdict(msg);
    default:
      return { ok: false, reason: "UNKNOWN_MESSAGE_TYPE" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, reason: err?.body?.error || "ERROR", message: err?.message || String(err) }));
  return true; // keep the message channel open for the async response
});
